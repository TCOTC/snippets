// 文件夹代码片段监听（原 index.ts「文件监听功能」分节外迁，行为等价）
// 职责：监听 data 下指定文件夹中的 .css/.js 文件——初始加载、周期轮询差异、增删改应用/移除注入元素、
// 路径/间隔/开关变化处理；JS 文件移除时按 autoReloadUIAfterModifyJS 提示并可自动重载界面。
// 简洁化：不设 Host——直接持有 PluginSnippets 实例（import type 避免运行时循环依赖），
// 经插件侧已 public 化的配置镜像（fileWatch*/autoReloadUIAfterModifyJS/isReloadUIRequired）与服务直连。
import {fetchPost} from "siyuan";
import {isValidJavaScriptCode} from "../domain/snippet";
import {genNewSnippetId} from "../utils";
import {getFile} from "./storage";
import type PluginSnippets from "../index";
import type {FileState} from "../types";

/**
 * 文件夹代码片段监听服务（原 index.ts「文件监听功能」分节外迁，行为等价）
 * 监听状态（已加载文件状态表、轮询定时器 ID）为本服务内部状态，随实例生命周期启停。
 */
export class FileWatchService {
    private readonly plugin: PluginSnippets;

    /**
     * 文件监听状态（文件路径 -> 文件状态）
     */
    private fileWatchFileStates: Map<string, FileState> = new Map();

    /**
     * 文件监听定时器 ID
     */
    private fileWatchIntervalId: number | null = null;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 启动文件监听
     */
    start() {
        if (this.plugin.fileWatchEnabled === "disabled") {
            return;
        }

        // 停止现有的监听
        this.stop();

        // 清理所有旧的文件监听元素
        this.removeAllFileWatchElements();

        // 初始化文件状态
        this.fileWatchFileStates = new Map();

        // 初始加载现有文件
        void this.loadExistingFiles();

        // 只有在启用模式下才设置定时器进行持续监听
        if (this.plugin.fileWatchEnabled === "enabled") {
            this.fileWatchIntervalId = window.setInterval(() => {
                void this.checkFileChanges();
            }, this.plugin.fileWatchInterval * 1000);
        }
    }

    /**
     * 停止文件监听
     */
    stop() {
        if (this.fileWatchIntervalId) {
            window.clearInterval(this.fileWatchIntervalId);
            this.fileWatchIntervalId = null;
            this.plugin.console.log("stopFileWatch: File watch stopped");
        }

        // 只有在禁用模式下才移除所有文件监听元素
        if (this.plugin.fileWatchEnabled === "disabled") {
            this.removeAllFileWatchElements();
        }
    }

    /**
     * 处理文件监听路径变化
     */
    async handlePathChange() {
        if (this.plugin.fileWatchEnabled === "disabled") {
            return;
        }

        this.plugin.console.log("handleFileWatchPathChange: Path changed, reloading files");

        // 清理所有旧的文件监听元素
        this.removeAllFileWatchElements();

        // 重新初始化文件状态
        this.fileWatchFileStates = new Map();

        // 重新加载现有文件
        await this.loadExistingFiles();
    }

    /**
     * 处理文件监听间隔变化
     */
    handleIntervalChange() {
        if (this.plugin.fileWatchEnabled !== "enabled") {
            return;
        }

        this.plugin.console.log("handleFileWatchIntervalChange: Interval changed, updating timer");

        // 清除现有的定时器
        if (this.fileWatchIntervalId) {
            window.clearInterval(this.fileWatchIntervalId);
        }

        // 重新设置定时器
        this.fileWatchIntervalId = window.setInterval(() => {
            void this.checkFileChanges();
        }, this.plugin.fileWatchInterval * 1000);
    }

    /**
     * 初始加载现有文件
     */
    private async loadExistingFiles() {
        try {
            const folderPath = this.plugin.fileWatchPath;
            if (!folderPath) {
                this.plugin.console.warn("loadExistingFiles: Folder path is empty");
                return;
            }

            // 获取文件夹中的文件列表
            const files = await this.getFolderFiles(folderPath);
            if (!files || files.length === 0) {
                this.plugin.console.log("loadExistingFiles: No watchable files found in folder");
                return;
            }

            this.plugin.console.log("loadExistingFiles: Start loading existing files", files.length, "files");

            // 加载每个文件
            for (const file of files) {
                await this.loadSingleFile(file);
            }

            this.plugin.console.log("loadExistingFiles: Existing files loading completed");

        } catch (error) {
            if (error.message && error.message.includes("system cannot find the file specified")) {
                // 检查是否是路径无效的错误
                this.plugin.console.warn("loadExistingFiles: Invalid folder path, stopping file watch");
                this.plugin.showErrorMessage(this.plugin.i18n.fileWatchInvalidPath + ": " + this.plugin.fileWatchPath, 0);
                this.stop();
                return;
            } else if (error.message && error.message.includes("filename, directory name, or volume label syntax is incorrect")) {
                // 检查是否是绝对路径无效的错误
                this.plugin.console.warn("loadExistingFiles: Invalid folder path, stopping file watch");
                this.plugin.showErrorMessage(this.plugin.i18n.fileWatchNoSupportAbsPath + ": " + this.plugin.fileWatchPath, 0);
                this.stop();
                return;
            }

            this.plugin.console.error("loadExistingFiles: Failed to load existing files", error);
            this.plugin.showErrorMessage(this.plugin.i18n.fileWatchError + ": " + error.message);
        }
    }

    /**
     * 加载单个文件
     * @param filePath 文件路径
     */
    private async loadSingleFile(filePath: string) {
        try {
            // 检查文件路径是否有效
            if (!filePath || filePath === "undefined") {
                return;
            }

            // 获取文件信息
            const response = await getFile(filePath);

            // 检查响应格式
            let currentModified = 0;
            let currentContent = "";

            if (typeof response === "string") {
                // 如果响应是字符串，说明直接返回了文件内容
                currentContent = response;
            } else if (response && typeof response === "object") {
                // 如果响应是对象，检查是否有 code 字段
                if (response.code !== undefined) {
                    if (response.code !== 0) {
                        return;
                    }

                    if (!response.data) {
                        return;
                    }

                    currentModified = response.data.modified || 0;
                    currentContent = response.data.content || "";
                } else {
                    // 如果响应对象没有 code 字段，可能直接是文件数据
                    currentModified = response.modified || 0;
                    currentContent = response.content || "";
                }
            } else {
                return;
            }

            // 记录文件状态
            this.fileWatchFileStates.set(filePath, {
                path: filePath,
                lastModified: currentModified,
                content: currentContent
            });

            // 应用文件内容
            await this.applyFileChange(filePath, currentContent);

            this.plugin.console.log("loadSingleFile: File loaded successfully", filePath);

        } catch (error) {
            if (error.message && error.message.includes("The system cannot find the file specified")) {
                // 检查是否是路径无效的错误
                this.plugin.console.warn("loadSingleFile: Invalid file path", filePath);
                return;
            } else if (error.message && error.message.includes("filename, directory name, or volume label syntax is incorrect")) {
                // 检查是否是绝对路径无效的错误
                this.plugin.console.warn("loadSingleFile: Invalid absolute file path", filePath);
                return;
            }

            this.plugin.console.error("loadSingleFile: Failed to load file", filePath, error);
        }
    }

    /**
     * 移除所有文件监听元素
     */
    private removeAllFileWatchElements() {
        const watchElements = document.querySelectorAll('[id^="snippetCssJcsmWatch"], [id^="snippetJsJcsmWatch"]');
        let hasJSRemoved = false;

        watchElements.forEach(element => {
            // 检查是否是 JS 文件被移除
            if (element.id.startsWith("snippetJsJcsmWatch") &&
                element.textContent &&
                isValidJavaScriptCode(element.textContent)) {
                hasJSRemoved = true;
            }
            element.remove();
        });

        // 如果有 JS 文件被移除，弹出提示
        if (hasJSRemoved) {
            this.plugin.showNotification("reloadUIAfterModifyJS", 4000);
            void this.plugin.menuView.setReloadUIButtonBreathing();
            // 自动重新加载界面（与 removeFileWatchElement 方法保持一致）
            if (this.plugin.autoReloadUIAfterModifyJS && this.plugin.isReloadUIRequired && !document.querySelector(".b3-dialog--open[data-key='jcsm-snippet-dialog']")) {
                this.plugin.postReloadUI();
            }
        }

        this.plugin.console.log("removeAllFileWatchElements: Removed file watch elements:", watchElements.length);
    }

    /**
     * 检查文件变化
     */
    private async checkFileChanges() {
        try {
            const folderPath = this.plugin.fileWatchPath;

            if (!folderPath) {
                this.plugin.console.warn("checkFileChanges: folder path is empty");
                return;
            }

            // 获取文件夹中的文件列表
            const files = await this.getFolderFiles(folderPath);
            // 检查已删除的文件
            const currentFilePaths = new Set(files || []);
            const watchedFilePaths = Array.from(this.fileWatchFileStates.keys());
            for (const watchedFilePath of watchedFilePaths) {
                if (!currentFilePaths.has(watchedFilePath)) {
                    // 文件已被删除，移除对应的元素和状态
                    void this.removeFileWatchElement(watchedFilePath);
                    this.fileWatchFileStates.delete(watchedFilePath);
                    this.plugin.console.log("checkFileChanges: File deleted", watchedFilePath);
                }
            }

            if (!files || files.length === 0) {
                return;
            }

            // 检查每个文件的变化
            for (const file of files) {
                await this.checkSingleFileChange(file);
            }

        } catch (error) {
            if (error.message && error.message.includes("The system cannot find the file specified")) {
                // 检查是否是路径无效的错误
                this.plugin.console.warn("checkFileChanges: Invalid folder path, stopping file watch");
                this.plugin.showErrorMessage(this.plugin.i18n.fileWatchInvalidPath + ": " + this.plugin.fileWatchPath, 0);
                this.stop();
                return;
            } else if (error.message && error.message.includes("filename, directory name, or volume label syntax is incorrect")) {
                // 检查是否是绝对路径无效的错误
                this.plugin.console.warn("checkFileChanges: Invalid absolute path, stopping file watch");
                this.plugin.showErrorMessage(this.plugin.i18n.fileWatchNoSupportAbsPath + ": " + this.plugin.fileWatchPath, 0);
                this.stop();
                return;
            }

            this.plugin.console.error("checkFileChanges: Failed to check file changes", error);
            this.plugin.showErrorMessage(this.plugin.i18n.fileWatchError + ": " + error.message);
        }
    }

    /**
     * 获取文件夹中的文件列表
     * @param folderPath 文件夹路径
     * @returns 文件列表
     */
    private async getFolderFiles(folderPath: string): Promise<string[]> {
        try {
            const response = await new Promise<any>((resolve) => {
                fetchPost("/api/file/readDir", { path: folderPath }, (response: any) => {
                    resolve(response);
                });
            });

            if (response.code !== 0) {
                throw new Error(response.msg || this.plugin.i18n.readFolderFailed);
            }

            const files: string[] = [];
            if (response.data && Array.isArray(response.data)) {
                for (const item of response.data) {
                    // 检查文件路径是否存在且有效
                    if (item.isDir === false &&
                        item.name &&
                        (item.name.endsWith(".css") || item.name.endsWith(".js"))) {

                        // 构建文件路径：如果 item.path 不存在，则使用文件夹路径 + 文件名
                        let filePath = item.path;
                        if (!filePath && item.name) {
                            filePath = `${folderPath}/${item.name}`;
                        }

                        if (filePath) {
                            files.push(filePath);
                        }
                    }
                }
            }

            return files;
        } catch (error) {
            if (error.message && error.message.includes("The system cannot find the file specified")) {
                // 检查是否是路径无效的错误
                this.plugin.console.warn("getFolderFiles: Invalid folder path", folderPath);
                throw error; // 重新抛出错误，让上层方法处理
            } else if (error.message && error.message.includes("filename, directory name, or volume label syntax is incorrect")) {
                // 检查是否是绝对路径无效的错误
                this.plugin.console.warn("getFolderFiles: Invalid absolute path", folderPath);
                throw error; // 重新抛出错误，让上层方法处理
            }

            this.plugin.console.error("getFolderFiles: Failed to get folder file list", error);
            throw error;
        }
    }

    /**
     * 检查单个文件的变化
     * @param filePath 文件路径
     */
    private async checkSingleFileChange(filePath: string) {
        try {
            // 检查文件路径是否有效
            if (!filePath || filePath === "undefined") {
                return;
            }

            // 获取文件信息
            const response = await getFile(filePath);

            // 检查响应格式
            let currentModified = 0;
            let currentContent = "";

            if (typeof response === "string") {
                // 如果响应是字符串，说明直接返回了文件内容
                currentContent = response;
            } else if (response && typeof response === "object") {
                // 如果响应是对象，检查是否有 code 字段
                if (response.code !== undefined) {
                    if (response.code !== 0) {
                        return;
                    }

                    if (!response.data) {
                        return;
                    }

                    currentModified = response.data.modified || 0;
                    currentContent = response.data.content || "";
                } else {
                    // 如果响应对象没有 code 字段，可能直接是文件数据
                    currentModified = response.modified || 0;
                    currentContent = response.content || "";
                }
            } else {
                return;
            }

            // 获取之前的文件状态
            const previousState = this.fileWatchFileStates.get(filePath);

            if (!previousState) {
                // 新文件，记录状态并应用文件内容
                this.fileWatchFileStates.set(filePath, {
                    path: filePath,
                    lastModified: currentModified,
                    content: currentContent
                });

                // 应用新文件内容
                await this.applyFileChange(filePath, currentContent);
                this.plugin.console.log("checkSingleFileChange: New file added", filePath);
                return;
            }

            // 检查文件是否有变化
            if (previousState.lastModified !== currentModified || previousState.content !== currentContent) {
                // 获取文件扩展名
                const fileName = filePath.split("/").pop() || "";
                const fileExtension = fileName.split(".").pop()?.toLowerCase();

                if (fileExtension === "js") {
                    // 对于 JS 文件，特殊处理变化
                    // 检查是否是文件被删除后重新添加的情况
                    const encodedFilePath = encodeURIComponent(filePath);
                    const existingElement = document.querySelector(`[data-file-path="${encodedFilePath}"]`);
                    if (!existingElement) {
                        // 元素不存在，说明是重新添加的情况，需要重新应用
                        this.fileWatchFileStates.set(filePath, {
                            path: filePath,
                            lastModified: currentModified,
                            content: currentContent
                        });

                        await this.applyFileChange(filePath, currentContent);
                        this.plugin.console.log("checkSingleFileChange: JS file re-added", filePath);
                    } else {
                        // 元素存在，说明是中途变更
                        if (this.plugin.autoReloadUIAfterModifyJS) {
                            // 如果启用了自动重新加载 JS 后修改界面，则处理中途变更
                            this.plugin.console.log("checkSingleFileChange: JS file modified during runtime, reapplying", filePath);

                            // 更新文件状态并重新应用
                            this.fileWatchFileStates.set(filePath, {
                                path: filePath,
                                lastModified: currentModified,
                                content: currentContent
                            });

                            // 应用文件内容
                            await this.applyFileChange(filePath, currentContent);
                        } else {
                            // 如果未启用自动重新加载，则忽略中途变更
                            this.plugin.console.log("checkSingleFileChange: JS file modified during runtime, ignoring (autoReloadUIAfterModifyJS disabled)", filePath);
                            // 更新文件状态但不重新应用
                            this.fileWatchFileStates.set(filePath, {
                                path: filePath,
                                lastModified: currentModified,
                                content: currentContent
                            });
                        }
                    }
                } else {
                    // 对于非 JS 文件，保持原有逻辑
                    this.fileWatchFileStates.set(filePath, {
                        path: filePath,
                        lastModified: currentModified,
                        content: currentContent
                    });

                    // 应用文件变化
                    await this.applyFileChange(filePath, currentContent);
                }
            }
        } catch (error) {
            if (error.message && error.message.includes("The system cannot find the file specified")) {
                // 检查是否是路径无效的错误
                this.plugin.console.warn("checkSingleFileChange: Invalid file path", filePath);
                // 移除无效文件的状态
                this.fileWatchFileStates.delete(filePath);
                return;
            } else if (error.message && error.message.includes("filename, directory name, or volume label syntax is incorrect")) {
                // 检查是否是绝对路径无效的错误
                this.plugin.console.warn("checkSingleFileChange: Invalid absolute file path", filePath);
                // 移除无效文件的状态
                this.fileWatchFileStates.delete(filePath);
                return;
            }

            this.plugin.console.error("checkSingleFileChange: Failed to check file change", filePath, error);
        }
    }

    /**
     * 应用文件变化
     * @param filePath 文件路径
     * @param content 文件内容
     */
    private async applyFileChange(filePath: string, content: string) {
        try {
            const fileName = filePath.split("/").pop() || "";
            const fileExtension = fileName.split(".").pop()?.toLowerCase();

            if (fileExtension === "css") {
                // 应用 CSS 文件
                await this.applyCSSFile(filePath, content);
            } else if (fileExtension === "js") {
                // 应用 JS 文件
                await this.applyJSFile(filePath, content);
            }

        } catch (error) {
            this.plugin.console.error("applyFileChange: Failed to apply file change", filePath, error);
        }
    }

    /**
     * 应用 CSS 文件 - 直接添加样式元素
     * @param filePath 文件路径
     * @param content 文件内容
     */
    private async applyCSSFile(filePath: string, content: string) {
        try {
            // 移除已存在的同名文件监听元素
            void this.removeFileWatchElement(filePath);

            // 创建新的样式元素
            const styleElement = document.createElement("style");
            styleElement.id = `snippetCssJcsmWatch${genNewSnippetId(this.plugin.snippetsList)}`;
            styleElement.setAttribute("data-file-path", encodeURIComponent(filePath));
            styleElement.textContent = content;

            // 添加到 head 中
            document.head.appendChild(styleElement);

            this.plugin.console.log("applyCSSFile: Added file watch style element", filePath);

        } catch (error) {
            this.plugin.console.error("applyCSSFile: Failed to apply CSS file", filePath, error);
        }
    }

    /**
     * 应用 JS 文件 - 直接添加脚本元素
     * @param filePath 文件路径
     * @param content 文件内容
     */
    private async applyJSFile(filePath: string, content: string) {
        try {
            if (!isValidJavaScriptCode(content)) {
                // 不应用无效的 JS 代码
                this.plugin.console.warn("applyJSFile: Invalid JS code", filePath);
                return;
            }

            // 移除已存在的同名文件监听元素
            void this.removeFileWatchElement(filePath);

            // 创建新的脚本元素
            const scriptElement = document.createElement("script");
            scriptElement.type = "text/javascript";
            scriptElement.id = `snippetJsJcsmWatch${genNewSnippetId(this.plugin.snippetsList)}`;
            scriptElement.setAttribute("data-file-path", encodeURIComponent(filePath));
            scriptElement.textContent = content;

            // 添加到 head 中
            document.head.appendChild(scriptElement);

            this.plugin.console.log("applyJSFile: Added file watch script element", filePath);

        } catch (error) {
            this.plugin.console.error("applyJSFile: Failed to apply JS file", filePath, error);
        }
    }

    /**
     * 移除文件监听元素
     * @param filePath 文件路径
     */
    private async removeFileWatchElement(filePath: string) {
        const existingElement = document.querySelector(`[data-file-path="${encodeURIComponent(filePath)}"]`);
        if (existingElement) {
            // 检查是否是有效的 JS 文件被移除
            const fileName = filePath.split("/").pop() || "";
            const fileExtension = fileName.split(".").pop()?.toLowerCase();

            if (fileExtension === "js" && existingElement.textContent && isValidJavaScriptCode(existingElement.textContent)) {
                // JS 代码片段元素被移除需要弹出消息提示
                this.plugin.showNotification("reloadUIAfterModifyJS", 2000);
                // 高亮菜单上的重新加载界面按钮
                await this.plugin.menuView.setReloadUIButtonBreathing();
                // 自动重新加载界面
                if (this.plugin.autoReloadUIAfterModifyJS && this.plugin.isReloadUIRequired && !document.querySelector(".b3-dialog--open[data-key='jcsm-snippet-dialog']")) {
                    this.plugin.postReloadUI();
                }
                this.plugin.console.log("removeFileWatchElement: JS file removed, UI reload required", filePath);
            } else {
                this.plugin.console.log("removeFileWatchElement: Removed file watch element", filePath);
            }

            existingElement.remove();
        }
    }
}
