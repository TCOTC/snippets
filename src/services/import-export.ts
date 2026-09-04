// 代码片段导入导出（原 index.ts「导出与导入功能」分节外迁，行为等价）
// 职责：导出全部代码片段为 JSON（经 /api/export/exportResources 导出 zip 并去随机前缀后 saveExportFile 下载）；
// 从本地文件（json/zip）导入——zip 上传解压后递归定位 json；校验、ID 去重、覆盖前备份、整表替换写库。
// 运行态依赖（列表读写/菜单刷新/日志/提示等）经 ImportExportHost 注入，由插件实例以箭头函数实时转发。
import {fetchPost, saveExportFile, showMessage} from "siyuan";
import {getFile, putFile, renameFile} from "./storage";
import type {Snippet, SnippetType} from "../types";

const TEMP_PLUGIN_PATH = "/temp/plugin-snippets/"; // 插件临时文件路径
const TEMP_EXPORT_PATH = "/temp/export/";          // 导入导出临时文件路径

/**
 * 导入导出所需的插件运行态（读取器/动作函数形式，调用时才取值或执行）
 */
export interface ImportExportHost {
    /** 插件日志器 */
    logger: {
        log(...args: any[]): void;
        error(...args: any[]): void;
    };
    /** 读取：插件显示名 */
    displayName: () => string;
    /** 读取：插件 i18n 文案 */
    i18n: () => any;
    /** 读取：当前菜单展示的代码片段类型 */
    snippetsType: () => SnippetType;
    /** 读取：当前代码片段列表（导入去重用） */
    snippetsList: () => Snippet[];
    /** 读取：顶栏菜单是否打开 */
    menuOpen: () => boolean;
    /** 动作：弹出错误消息 */
    showErrorMessage: (message: string, timeout?: number, id?: string) => void;
    /** 动作：生成新代码片段 ID */
    genNewSnippetId: () => string;
    /** 动作：拉取当前代码片段列表（失败返回 false） */
    getSnippetsList: () => Promise<Snippet[] | false>;
    /** 动作：保存代码片段列表到内核 */
    saveSnippetsList: (snippetsList: Snippet[]) => Promise<void>;
    /** 动作：整表替换到 Store（触发计数刷新等） */
    storeReplaceAll: (snippetsList: Snippet[]) => void;
    /** 动作：刷新菜单类型开关显示（菜单打开时） */
    refreshMenuSnippetsType: () => void;
}

/**
 * 导入导出服务（原 index.ts「导出与导入功能」分节外迁，行为等价）
 */
export class ImportExportService {
    private readonly host: ImportExportHost;

    constructor(host: ImportExportHost) {
        this.host = host;
    }

    /**
     * 导出所有代码片段为 JSON 文件
     */
    async exportSnippetsToFile() {
        // 方法名不能用 exportSnippets，会跟配置项定义冲突
        try {
            // 获取代码片段文件 data/snippets/conf.json
            const snippetsFile = await getFile("data/snippets/conf.json");
            if (!snippetsFile) {
                this.host.showErrorMessage(this.host.i18n().getSnippetsListFailed);
                return;
            }

            // 创建文件名，格式 `${this.i18n.snippet} 2025-08-07 10-00-00.json`
            // 手动拼接本地时间，确保格式统一且无非法字符
            const now = new Date();
            const pad = (n: number) => n.toString().padStart(2, "0");
            const year = now.getFullYear();
            const month = pad(now.getMonth() + 1);
            const day = pad(now.getDate());
            const hour = pad(now.getHours());
            const minute = pad(now.getMinutes());
            const second = pad(now.getSeconds());
            const timestamp = `${year}-${month}-${day} ${hour}-${minute}-${second}`;
            const fileName = `${this.host.i18n().snippet} ${timestamp}.json`;

            // 调用 API 导出代码片段文件
            const exportResponse = await new Promise<any>((resolve) => {
                fetchPost("/api/export/exportResources", {
                    paths: ["data/snippets/conf.json"],
                    name: fileName
                }, (response: any) => {
                    if (response.code !== 0) {
                        this.host.logger.error("exportSnippets: Failed to export resources", response);
                        this.host.showErrorMessage(`Export failed: ${response.msg}`);
                        return;
                    }
                    resolve(response);
                });
            });

            // exportResources 会在物理文件名前加随机 exportID（形如 temp/export/<hex>-代码片段 xx.json.zip）用于隔离临时导出目录。
            // 这里重命名为不含前缀的干净文件名，方便用户分享；zip 内部结构不变，不影响新旧版本导入兼容。
            const exportPath: string = exportResponse.data.path; // temp/export/<hex>-代码片段 xx.json.zip
            const exportDir = exportPath.substring(0, exportPath.lastIndexOf("/") + 1); // temp/export/
            const cleanExportFileName = fileName + ".zip"; // 代码片段 xx.json.zip
            const cleanExportPath = exportDir + cleanExportFileName;
            const renameResp = await renameFile(exportPath, cleanExportPath);
            if (!renameResp || renameResp.code !== 0) {
                throw new Error("Rename export file failed: " + (renameResp?.msg ?? renameResp?.code));
            }

            // 下载文件，由 saveExportFile 统一处理各端导出与提示（桌面端弹出另存为对话框，移动端调用原生保存，浏览器端触发下载）
            // exportResources 返回相对于工作空间的路径 temp/export/<name>，需转换为 /export/<name> 形式的 URL 路径
            // 以与思源内置导出 API 返回格式一致（见 kernel/model/export.go 中 exportSYZip 等的 "/export/" + url.PathEscape）
            // 否则移动端原生 saveExportFile 会因缺少前导 "/" 无法定位文件，报“文件不存在或为空”
            await saveExportFile("/export/" + encodeURIComponent(cleanExportFileName));
        } catch (error) {
            this.host.logger.error("exportSnippets: Failed to export snippets: ", error);
            this.host.showErrorMessage(this.host.i18n().exportSnippetsFailed + ": " + error.message);
        }
    }

    /**
     * 导入代码片段
     * @param overwrite 是否覆盖现有代码片段
     */
    async importSnippets(overwrite: boolean) {
        // 兼容导入 zip 和 json 文件两种情况，解压 zip 之后（有可能还有一层文件夹）还需要判断是否是 json 文件
        try {
            // 创建文件输入元素
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "*";
            input.style.display = "none";

            // 监听文件选择
            input.addEventListener("change", async (event) => {
                const file = (event.target as HTMLInputElement).files?.[0];
                if (!file) {
                    return;
                }

                const fileName = file.name || "";
                const ext = fileName.split(".").pop()?.toLowerCase();

                try {
                    let importText = "";

                    if (ext === "zip") {
                        // 处理 zip：上传到临时目录并解压，然后在解压目录自动寻找 json 文件
                        const uid = window.Lute?.NewNodeID ? window.Lute.NewNodeID() : (Date.now().toString(36));
                        const basePath = `${TEMP_EXPORT_PATH}import-${uid}`;
                        const zipPath = `${basePath}.zip`;
                        const unzipDir = `${basePath}/`;

                        // 上传 zip 文件
                        const uploadResp = await this.putBinaryFile(zipPath, file);
                        if (!uploadResp || uploadResp.code !== 0) {
                            throw new Error(`${this.host.i18n().uploadImportFileFailed} [${uploadResp?.code}: ${uploadResp?.msg}]`);
                        }

                        // 解压 zip 文件
                        const unzipResp = await new Promise<any>((resolve) => {
                            fetchPost("/api/archive/unzip", { path: unzipDir, zipPath }, (resp: any) => resolve(resp));
                        });
                        if (!unzipResp || unzipResp.code !== 0) {
                            throw new Error(`${this.host.i18n().unzipFailed} [${unzipResp?.code}: ${unzipResp?.msg}]`);
                        }

                        // 在解压目录查找 json 文件（可能还多一层文件夹）
                        const jsonFilePath = await this.findJsonFilePathInDir(unzipDir);
                        if (!jsonFilePath) {
                            throw new Error(this.host.i18n().noValidJsonFileFound);
                        }

                        // 读取服务器上的 json 文件文本
                        const getResp = await getFile(jsonFilePath);
                        if (getResp && getResp.code) {
                            throw new Error(`${this.host.i18n().readUnzippedJsonFileFailed} [${getResp.code}: ${getResp.msg}]`);
                        }

                        // 如果返回的是对象，直接转换为 JSON 字符串
                        if (typeof getResp === "object" && Array.isArray(getResp)) {
                            importText = JSON.stringify(getResp);
                        } else {
                            importText = (getResp as string) ?? "";
                        }
                    } else {
                        // 直接读取本地文件文本，然后验证是否为有效的 JSON
                        importText = await this.readFileAsText(file);
                    }

                    if (!importText) {
                        throw new Error(this.host.i18n().importFileContentEmpty);
                    }

                    // 尝试解析 JSON，如果失败则提示用户
                    let importData;
                    try {
                        importData = JSON.parse(importText);
                    } catch (parseError) {
                        throw new Error(this.host.i18n().importFileNotValidJson);
                    }

                    // 验证导入数据格式
                    if (!this.validateImportData(importData)) {
                        this.host.showErrorMessage(this.host.i18n().importSnippetsInvalidFormat);
                        return;
                    }

                    // 获取当前代码片段列表
                    const currentSnippets = await this.host.getSnippetsList();
                    if (!currentSnippets) {
                        this.host.showErrorMessage(this.host.i18n().getSnippetsListFailed);
                        return;
                    }

                    let newSnippetsList: Snippet[];

                    if (overwrite) {
                        // 覆盖模式：直接使用导入的代码片段
                        // 生成一份备份放到 temp 文件夹里
                        await this.createBackup(currentSnippets);
                        newSnippetsList = this.processImportedSnippets(importData);
                    } else {
                        // 追加模式：将导入的代码片段添加到现有列表前面
                        const processedImportedSnippets = this.processImportedSnippets(importData);
                        newSnippetsList = [...processedImportedSnippets, ...currentSnippets];
                    }

                    // 保存新的代码片段列表
                    void this.host.saveSnippetsList(newSnippetsList);
                    // 整表替换到 Store：计数由 SNIPPETS_CHANGED 事件统一刷新（菜单打开时）
                    this.host.storeReplaceAll(newSnippetsList);

                    // 更新菜单显示（类型开关状态等）
                    if (this.host.menuOpen()) {
                        this.host.refreshMenuSnippetsType();
                    }

                    // 显示成功消息
                    const successMessage = overwrite
                        ? this.host.i18n().importSnippetsOverwriteSuccess
                        : this.host.i18n().importSnippetsAppendSuccess;
                    showMessage(this.host.displayName() + ": " + successMessage, 3000, "info");

                } catch (error) {
                    this.host.logger.error("importSnippets: Failed to import snippets", error);
                    this.host.showErrorMessage(this.host.i18n().importSnippetsFailed + ": " + error.message);
                } finally {
                    // 清理文件输入元素
                    document.body.removeChild(input);
                }
            });

            // 添加到 DOM 并触发文件选择
            document.body.appendChild(input);
            input.click();

        } catch (error) {
            this.host.logger.error("importSnippets: Failed to create file input", error);
            this.host.showErrorMessage(this.host.i18n().importSnippetsFailed + ": " + error.message);
        }
    }

    /**
     * 读取文件内容为文本
     * @param file 文件对象
     * @returns 文件内容
     */
    private readFileAsText(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const result = event.target?.result as string;
                if (result) {
                    resolve(result);
                } else {
                    reject(new Error("Failed to read file"));
                }
            };
            reader.onerror = () => reject(new Error("Failed to read file"));
            reader.readAsText(file);
        });
    }

    /**
     * 验证导入数据格式
     * @param data 导入的数据
     * @returns 是否为有效格式
     */
    private validateImportData(data: any): boolean {
        // 检查基本结构，验证数组
        if (!Array.isArray(data)) {
            return false;
        }

        // 验证每个代码片段
        for (const snippet of data) {
            if (!this.validateSnippet(snippet)) {
                return false;
            }
        }

        return true;
    }

    /**
     * 验证单个代码片段格式
     * @param snippet 代码片段
     * @returns 是否为有效格式
     */
    private validateSnippet(snippet: any): boolean {
        // 检查必需字段
        if (!snippet || typeof snippet !== "object") {
            return false;
        }

        if (typeof snippet.name !== "string") {
            return false;
        }

        if (typeof snippet.content !== "string") {
            return false;
        }

        if (snippet.type !== "css" && snippet.type !== "js") {
            return false;
        }

        if (typeof snippet.enabled !== "boolean") {
            return false;
        }

        // noinspection RedundantIfStatementJS
        if (snippet.disabledInPublish && typeof snippet.disabledInPublish !== "boolean") {
            return false;
        }

        return true;
    }

    /**
     * 创建备份文件
     * @param snippets 要备份的代码片段列表
     */
    private async createBackup(snippets: Snippet[]): Promise<void> {
        try {
            // 生成备份文件名，格式：snippets_backup_2025-08-07_10-00-00.json
            const now = new Date();
            const pad = (n: number) => n.toString().padStart(2, "0");
            const year = now.getFullYear();
            const month = pad(now.getMonth() + 1);
            const day = pad(now.getDate());
            const hour = pad(now.getHours());
            const minute = pad(now.getMinutes());
            const second = pad(now.getSeconds());
            const timestamp = `${year}-${month}-${day}_${hour}-${minute}-${second}`;
            const backupFileName = `snippets_backup_${timestamp}.json`;

            // 备份文件路径
            const backupPath = `${TEMP_PLUGIN_PATH}${backupFileName}`;

            // 转换为 JSON 字符串
            const backupContent = JSON.stringify(snippets, null, 2);

            // 写入备份文件
            const response = await putFile(backupPath, backupContent);

            if (response.code !== 0) {
                this.host.logger.error("createBackup: Failed to create backup file", response);
                this.host.showErrorMessage(`${this.host.i18n().backupCreateFailed}: ${response.msg}`);
                return;
            }

            this.host.logger.log("createBackup: Backup created successfully", backupPath);

        } catch (error) {
            this.host.logger.error("createBackup: Failed to create backup", error);
            this.host.showErrorMessage(this.host.i18n().backupCreateFailed + ": " + error.message);
        }
    }

    /**
     * 处理导入的代码片段
     * @param importedSnippets 导入的代码片段数组
     * @returns 处理后的代码片段数组
     */
    private processImportedSnippets(importedSnippets: Snippet[]): Snippet[] {
        const currentIds = new Set(this.host.snippetsList().map(s => s.id));

        return importedSnippets.map(snippet => {
            // 如果 ID 重复，生成新的 ID
            if (snippet.id && currentIds.has(snippet.id)) {
                snippet.id = this.host.genNewSnippetId();
            } else if (!snippet.id) {
                // 如果没有 ID，生成新的 ID
                snippet.id = this.host.genNewSnippetId();
            }

            return snippet;
        });
    }

    // 上传二进制文件（用于 zip）
    private putBinaryFile(path: string, file: File): Promise<any> {
        if (!path || !file) {
            return Promise.reject({ code: 400, msg: "path or file is empty" });
        }
        const formData = new FormData();
        formData.append("path", path);
        formData.append("isDir", "false");
        formData.append("file", file);
        return new Promise((resolve) => {
            fetchPost("/api/file/putFile", formData, (response: any) => resolve(response));
        });
    }

    // 在解压目录中查找 json 文件，递归查找所有子文件夹
    private async findJsonFilePathInDir(dir: string): Promise<string | null> {
        return this.findJsonFileRecursive(dir);
    }

    // 递归查找 JSON 文件的辅助方法
    private async findJsonFileRecursive(dir: string): Promise<string | null> {
        // 读取目录内容
        const listResp = await new Promise<any>((resolve) => {
            fetchPost("/api/file/readDir", { path: dir }, (resp: any) => resolve(resp));
        });
        if (!listResp || listResp.code !== 0) {
            this.host.logger.error("findJsonFileRecursive: readDir failed", listResp);
            return null;
        }
        const items = Array.isArray(listResp.data) ? listResp.data : [];

        // 先查找当前目录中的所有文件
        const files = items.filter((it: any) => !it.isDir && it.name);
        for (const file of files) {
            const filePath = file.path || (dir.replace(/\/$/, "") + "/" + file.name);

            try {
                const fileContent = await getFile(filePath);

                if (fileContent && !fileContent.code) {
                    // 如果已经是对象，直接验证是否为数组
                    if (typeof fileContent === "object" && Array.isArray(fileContent)) {
                        return filePath;
                    }

                    // 如果是字符串，尝试解析为 JSON
                    if (typeof fileContent === "string") {
                        JSON.parse(fileContent);
                        return filePath;
                    }
                }
            } catch (error) {
                // 不是有效的 JSON，继续查找下一个文件
            }
        }

        // 递归查找所有子文件夹
        const subDirs = items.filter((it: any) => it.isDir === true);
        for (const subDir of subDirs) {
            const subDirPath = subDir.path || (dir.replace(/\/$/, "") + "/" + subDir.name);

            const result = await this.findJsonFileRecursive(subDirPath);
            if (result) {
                return result;
            }
        }

        return null;
    }
}
