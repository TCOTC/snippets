// 代码片段导入导出
// 职责：导出全部代码片段为 JSON（经 /api/export/exportResources 导出 zip 并去随机前缀后 saveExportFile 下载）；
// 从本地文件（json/zip）导入——zip 上传解压后递归定位 json；校验、ID 去重、覆盖前备份、整表替换写库，
// 落库成功后经 SnippetManager.applyImportedSnippets 立即应用并广播到其他窗口（见 snippet-manager.ts）。
import {saveExportFile, showMessage} from "siyuan";
import {isValidCssSnippetContent, snippetTitle} from "../domain/snippet";
import {planImport} from "../domain/import-plan";
import type {ImportMode} from "../domain/import-plan";
import {escapeHtml, fetchPostPromise, genNewSnippetId, getFile, putFile, renameFile} from "../utils";
import type PluginSnippets from "../index";
import type {Snippet} from "../types";

const TEMP_PLUGIN_PATH = "/temp/plugin-snippets/"; // 插件临时文件路径
const TEMP_EXPORT_PATH = "/temp/export/";          // 导入导出临时文件路径

/**
 * 导入导出服务
 */
export class ImportExportService {
    private readonly plugin: PluginSnippets;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
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
                this.plugin.showErrorMessage(this.plugin.i18n.getSnippetsListFailed);
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
            const fileName = `${this.plugin.i18n.snippet} ${timestamp}.json`;

            // 调用 API 导出代码片段文件
            const exportResponse = await fetchPostPromise("/api/export/exportResources", {
                paths: ["data/snippets/conf.json"],
                name: fileName
            });
            if (exportResponse.code !== 0) {
                this.plugin.console.error("exportSnippets: Failed to export resources", exportResponse);
                this.plugin.showErrorMessage(`Export failed: ${exportResponse.msg}`);
                return;
            }

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
            this.plugin.console.error("exportSnippets: Failed to export snippets: ", error);
            this.plugin.showErrorMessage(this.plugin.i18n.exportSnippetsFailed + ": " + error.message);
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

                        // 上传 zip 文件（putFile 内容参数支持 File，无需额外二进制分支）
                        const uploadResp = await putFile(zipPath, file);
                        if (!uploadResp || uploadResp.code !== 0) {
                            throw new Error(`${this.plugin.i18n.uploadImportFileFailed} [${uploadResp?.code}: ${uploadResp?.msg}]`);
                        }

                        // 解压 zip 文件
                        const unzipResp = await fetchPostPromise("/api/archive/unzip", { path: unzipDir, zipPath });
                        if (!unzipResp || unzipResp.code !== 0) {
                            throw new Error(`${this.plugin.i18n.unzipFailed} [${unzipResp?.code}: ${unzipResp?.msg}]`);
                        }

                        // 在解压目录查找 json 文件（可能还多一层文件夹）
                        const jsonFilePath = await this.findJsonFileRecursive(unzipDir);
                        if (!jsonFilePath) {
                            throw new Error(this.plugin.i18n.noValidJsonFileFound);
                        }

                        // 读取服务器上的 json 文件文本
                        const getResp = await getFile(jsonFilePath);
                        if (getResp && getResp.code) {
                            throw new Error(`${this.plugin.i18n.readUnzippedJsonFileFailed} [${getResp.code}: ${getResp.msg}]`);
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
                        throw new Error(this.plugin.i18n.importFileContentEmpty);
                    }

                    // 尝试解析 JSON，如果失败则提示用户
                    let importData;
                    try {
                        importData = JSON.parse(importText);
                    } catch (parseError) {
                        throw new Error(this.plugin.i18n.importFileNotValidJson);
                    }

                    // 验证导入数据格式
                    if (!(await this.validateImportDataWithReport(importData))) {
                        return;
                    }

                    // 获取当前代码片段列表
                    const currentSnippets = await this.plugin.snippetManager.getSnippetsList();
                    if (!currentSnippets) {
                        this.plugin.showErrorMessage(this.plugin.i18n.getSnippetsListFailed);
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

                    // 落库 → 应用并广播 → 成功消息（失败时 saveSnippetsList 已自行弹错）
                    const successMessage = overwrite
                        ? this.plugin.i18n.importSnippetsOverwriteSuccess
                        : this.plugin.i18n.importSnippetsAppendSuccess;
                    await this.commitImport(newSnippetsList, successMessage);

                } catch (error) {
                    this.plugin.console.error("importSnippets: Failed to import snippets", error);
                    this.plugin.showErrorMessage(this.plugin.i18n.importSnippetsFailed + ": " + error.message);
                } finally {
                    // 清理文件输入元素
                    document.body.removeChild(input);
                }
            });

            // 添加到 DOM 并触发文件选择
            document.body.appendChild(input);
            input.click();

        } catch (error) {
            this.plugin.console.error("importSnippets: Failed to create file input", error);
            this.plugin.showErrorMessage(this.plugin.i18n.importSnippetsFailed + ": " + error.message);
        }
    }

    /**
     * 以三模式导入已就绪的片段数据（Gist 导入等数据源公共入口）
     * 语义与文档 docs/gist-sync.md 5.4 一致；本地文件导入（importSnippets）保持原有追加/覆盖语义不动。
     * @param importData 导入片段（映射层已保证均携带 id 且 enabled 就绪）
     * @param mode merge（同 ID 更新）/ overwrite（全表替换，先备份）/ fork（全部重生成新增）
     * @returns 成功返回 { addedCount, updatedCount }；失败返回 false（错误已提示）
     */
    async importSnippetsFromData(importData: Snippet[], mode: ImportMode): Promise<{addedCount: number; updatedCount: number} | false> {
        try {
            if (!(await this.validateImportDataWithReport(importData))) {
                return false;
            }
            const currentSnippets = await this.plugin.snippetManager.getSnippetsList();
            if (!currentSnippets) {
                this.plugin.showErrorMessage(this.plugin.i18n.getSnippetsListFailed);
                return false;
            }
            // merge 会改动本地既有片段、overwrite 会整表替换，均先备份；fork 纯新增不备份
            if (mode !== "fork") {
                await this.createBackup(currentSnippets);
            }
            const plan = planImport(currentSnippets, importData, mode, () => genNewSnippetId(this.plugin.snippetsList));
            // 成功消息由调用方（如 Gist 导入对话框）组装展示，此处只落库与广播
            const committed = await this.commitImport(plan.list, "");
            return committed ? {addedCount: plan.addedCount, updatedCount: plan.updatedCount} : false;
        } catch (error) {
            this.plugin.console.error("importSnippetsFromData: Failed to import snippets", error);
            this.plugin.showErrorMessage(this.plugin.i18n.importSnippetsFailed + ": " + error.message);
            return false;
        }
    }

    /**
     * 校验导入数据格式并按失败原因分类提示（本地文件导入与 Gist 导入共用）
     * @param data 导入的数据
     * @returns 是否通过校验（未通过时已弹错误提示）
     */
    private async validateImportDataWithReport(data: any): Promise<boolean> {
        if (!this.validateImportData(data)) {
            // 优先定位 CSS 内容违规（与思源内核安全校验同判据），否则给通用格式提示
            const invalidCssSnippets = this.findInvalidCssSnippets(data);
            if (invalidCssSnippets.length > 0) {
                // 报错消息经 innerHTML 渲染（思源 showMessage），且片段名可能回退到内容前 200 字
                // （内容本身含违规标签），整条消息先转义再展示
                this.plugin.showErrorMessage(escapeHtml(this.plugin.i18n.invalidCssSnippetContent + ": " + invalidCssSnippets.map((snippet) => snippetTitle(snippet)).join(", ")));
            } else {
                this.plugin.showErrorMessage(this.plugin.i18n.importSnippetsInvalidFormat);
            }
            return false;
        }
        return true;
    }

    /**
     * 落库并应用导入结果（保存失败时 saveSnippetsList 已自行弹错，返回 false；成功后
     * 经 SnippetManager.applyImportedSnippets 更新 Store、对齐注入元素、广播其他窗口）
     * @param newSnippetsList 待落库列表
     * @param successMessage 成功消息文案（为空则不弹成功消息，由调用方组装）
     * @returns 是否成功
     */
    private async commitImport(newSnippetsList: Snippet[], successMessage: string): Promise<boolean> {
        try {
            await this.plugin.snippetManager.saveSnippetsList(newSnippetsList);
        } catch {
            return false;
        }
        await this.plugin.snippetManager.applyImportedSnippets(newSnippetsList);
        if (successMessage) {
            showMessage(this.plugin.displayName + ": " + successMessage, 3000, "info");
        }
        return true;
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

        // 适配思源内核 CSS 片段安全校验：内容含 </style 或 <script 的 CSS 片段无法落库，
        // 导入时按同一判据拦截（validateImportData 返回 false，错误定位见 findInvalidCssSnippets）
        if (snippet.type === "css" && !isValidCssSnippetContent(snippet.content)) {
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
     * 找出导入数据中内容违反思源内核 CSS 片段安全校验的片段
     * （结构非法的条目已被 validateImportData 拦截，此处仅作防御性遍历以给出可定位提示）
     * @param data 导入数据（可能结构非法）
     * @returns 违规的 CSS 片段列表
     */
    private findInvalidCssSnippets(data: any): Snippet[] {
        if (!Array.isArray(data)) return [];
        return data.filter((snippet: any) =>
            snippet && typeof snippet === "object" &&
            snippet.type === "css" &&
            typeof snippet.content === "string" &&
            !isValidCssSnippetContent(snippet.content)
        );
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
                this.plugin.console.error("createBackup: Failed to create backup file", response);
                this.plugin.showErrorMessage(`${this.plugin.i18n.backupCreateFailed}: ${response.msg}`);
                return;
            }

            this.plugin.console.log("createBackup: Backup created successfully", backupPath);

        } catch (error) {
            this.plugin.console.error("createBackup: Failed to create backup", error);
            this.plugin.showErrorMessage(this.plugin.i18n.backupCreateFailed + ": " + error.message);
        }
    }

    /**
     * 处理导入的代码片段
     * @param importedSnippets 导入的代码片段数组
     * @returns 处理后的代码片段数组
     */
    private processImportedSnippets(importedSnippets: Snippet[]): Snippet[] {
        // 冲突集合 = 当前工作空间已有 ID ∪ 本文件内已处理过的 ID（含新生成的），确保两两不重复
        const currentIds = new Set(this.plugin.snippetsList.map(s => s.id));

        return importedSnippets.map(snippet => {
            // ID 缺失或与现有/文件内前序片段重复时，重新生成并回填冲突集合
            // （否则同一文件内相同 ID 的第二条不会换 ID，落库后重复 ID 会互相覆盖注入元素/菜单操作错乱）
            if (!snippet.id || currentIds.has(snippet.id)) {
                let newId = genNewSnippetId(this.plugin.snippetsList);
                while (currentIds.has(newId)) {
                    newId = genNewSnippetId(this.plugin.snippetsList);
                }
                snippet.id = newId;
            }
            currentIds.add(snippet.id);

            return snippet;
        });
    }

    /**
     * 递归查找 JSON 文件的辅助方法
     */
    private async findJsonFileRecursive(dir: string): Promise<string | null> {
        // 读取目录内容
        const listResp = await fetchPostPromise("/api/file/readDir", { path: dir });
        if (!listResp || listResp.code !== 0) {
            this.plugin.console.error("findJsonFileRecursive: readDir failed", listResp);
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
