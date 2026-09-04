// 代码片段编辑对话框的编辑器生命周期管理（原 index.ts 外迁）
// 职责：主题模式监听（对话框打开时启停）、已打开编辑器随主题/配置更新、编辑器重建。
// 简洁化：不设 Host——直接持有 PluginSnippets 实例（import type 避免运行时循环依赖），
// console/editorIndentUnit/i18n 经插件实例读取（调用时才取值，保证拿到实时配置/i18n）。
// jcsm 收敛（阶段 6）：observer 原挂 window.siyuan.jcsm.themeObserver，改为实例字段——
// 插件重载时 onunload 必停监听、重载后由 checkAndManageThemeWatch 按 DOM 现状自启，无需跨 reload 仓库。
import {EditorState} from "@codemirror/state";
import {vscodeDark, vscodeLight} from "@uiw/codemirror-theme-vscode";
import type {EditorView} from "@codemirror/view";
import {createCodeMirrorEditor, createEditorExtensions, getEditorIndentUnit} from "./codemirror";
import type PluginSnippets from "../index";

/**
 * 编辑器对话框生命周期管理（原 index.ts 对应私有方法外迁，行为等价）
 * - 主题模式监听：存在打开中的代码片段编辑对话框时监听 :root 的 data-theme-mode 变化，
 *   模式切换后更新所有已打开编辑器主题；无对话框时停止监听。observer 为实例字段，
 *   插件重载后随 DOM 现状自启（与既有 dialog 一并由 checkAndManageThemeWatch 管理）。
 * - updateAllEditorConfigs / recreateEditor：供设置项变更（缩进单位）与主题切换时刷新已打开编辑器。
 */
export class EditorManager {
    private readonly plugin: PluginSnippets;

    /**
     * 主题模式监听器（观察 :root 的 data-theme-mode 属性变化）
     */
    private themeModeObserver: MutationObserver | null = null;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 启动主题模式监听
     */
    startThemeModeWatch() {
        // 如果已经启动了监听，则不重复启动
        if (this.themeModeObserver) return;

        // 存储上一次的主题模式，用于比较是否有变化
        let lastThemeMode = window.siyuan.config.appearance.mode;

        // 使用 MutationObserver 监听 :root 元素的 data-theme-mode 属性变化
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === "attributes" && mutation.attributeName === "data-theme-mode") {
                    this.plugin.console.log("themeModeChangeHandler: mutation", mutation);

                    // 检查主题模式是否有变化
                    const currentThemeMode = window.siyuan.config.appearance.mode;
                    if (currentThemeMode !== lastThemeMode) {
                        this.plugin.console.log(`Theme mode changed: ${lastThemeMode} -> ${currentThemeMode}`);
                        lastThemeMode = currentThemeMode;

                        // 更新所有打开的代码片段编辑对话框中的编辑器主题
                        this.updateAllEditorConfigs("theme");
                    }
                }
            });
        });

        // 开始监听 :root 元素的属性变化
        const rootElement = document.querySelector(":root");
        if (rootElement) {
            observer.observe(rootElement, {
                attributes: true,
                attributeFilter: ["data-theme-mode"]
            });

            // 记录到实例字段
            this.themeModeObserver = observer;

            this.plugin.console.log("startThemeModeWatch: theme mode watch started");
        }
    }

    /**
     * 停止主题模式监听
     */
    stopThemeModeWatch() {
        if (this.themeModeObserver) {
            this.themeModeObserver.disconnect();
            this.themeModeObserver = null;
            this.plugin.console.log("stopThemeModeWatch: theme mode watch stopped");
        }
    }

    /**
     * 检查是否有编辑器对话框打开
     * @returns 是否存在打开的编辑器对话框
     */
    hasEditorDialogsOpen(): boolean {
        return document.querySelectorAll('.b3-dialog--open[data-key="jcsm-snippet-dialog"]').length > 0;
    }

    /**
     * 检查并管理主题模式监听状态
     * @param isOpen 是否正在打开编辑器对话框
     */
    checkAndManageThemeWatch(isOpen = false) {
        const hasDialog = isOpen || this.hasEditorDialogsOpen();
        const hasObserver = !!this.themeModeObserver;
        this.plugin.console.log("checkAndManageThemeWatch: hasDialog", hasDialog, ", hasObserver", hasObserver);

        if (hasDialog && !hasObserver) {
            // 有对话框但没有监听器，启动监听
            this.startThemeModeWatch();
        } else if (!hasDialog && hasObserver) {
            // 没有对话框但有监听器，停止监听
            this.stopThemeModeWatch();
        }
        // 不关心其他情况
    }

    /**
     * 更新所有打开的代码片段编辑对话框中的编辑器配置
     * @param reason 更新原因，用于日志记录
     */
    updateAllEditorConfigs(reason = "config") {
        // 获取所有打开的代码片段编辑对话框
        const snippetDialogs = document.querySelectorAll('.b3-dialog--open[data-key="jcsm-snippet-dialog"]');
        snippetDialogs.forEach((dialogElement) => {
            const contentContainer = dialogElement.querySelector(".jcsm-dialog-content") as HTMLElement;
            if (!contentContainer) return;

            // 查找现有的 CodeMirror 编辑器 DOM 元素
            const existingEditorElement = contentContainer.querySelector(".cm-editor");
            if (!existingEditorElement) return;

            // 获取当前编辑器实例 - 通过 DOM 元素查找对应的 EditorView
            const editorView = (existingEditorElement as any).cmView as EditorView;
            if (!editorView) {
                this.plugin.console.warn("updateAllEditorConfigs: editorView not found, recreating editor:", reason);
                this.recreateEditor(dialogElement, contentContainer);
                return;
            }

            // 获取当前主题模式
            const currentThemeMode = window.siyuan.config.appearance.mode;
            const newTheme = currentThemeMode === 0 ? vscodeLight : vscodeDark;

            // 获取当前编辑器状态
            const currentState = editorView.state;

            // 创建新的编辑器状态，保留文档内容和选择状态
            const snippetType = dialogElement.getAttribute("data-snippet-type") || "css";
            const newState = EditorState.create({
                doc: currentState.doc,
                extensions: createEditorExtensions(newTheme, snippetType, getEditorIndentUnit(this.plugin.editorIndentUnit), this.plugin.i18n),
            });

            // 更新编辑器状态，保留滚动位置和光标位置
            editorView.setState(newState);

            this.plugin.console.log("updateAllEditorConfigs: editor:", reason, "updated:", dialogElement);
        });
    }

    /**
     * 重新创建编辑器（当无法找到 EditorView 实例时使用）
     * @param dialogElement 对话框元素
     * @param contentContainer 内容容器
     */
    recreateEditor(dialogElement: Element, contentContainer: HTMLElement) {
        this.plugin.console.log("recreateEditor: dialogElement", dialogElement, ", contentContainer", contentContainer);
        // 获取当前编辑器内容
        const existingEditorElement = contentContainer.querySelector(".cm-editor");
        if (!existingEditorElement) return;

        const codeLines = existingEditorElement.querySelectorAll(".cm-line");
        let currentContent = "";
        if (codeLines.length > 0) {
            // 从 CodeMirror 的 DOM 结构中提取文本内容
            currentContent = Array.from(codeLines)
                .map(line => line.textContent || "")
                .join("\n");
        } else {
            this.plugin.console.error("recreateEditor: no code lines found, return");
            return;
        }

        const snippetType = dialogElement.getAttribute("data-snippet-type") || "css";

        // 清空容器
        contentContainer.innerHTML = "";

        // 重新创建编辑器
        createCodeMirrorEditor(contentContainer, currentContent, snippetType, this.plugin.editorIndentUnit, this.plugin.i18n);

        this.plugin.console.log(`recreateEditor: editor recreated: ${dialogElement}`);
    }

    /**
     * 移除全局 CodeMirror 样式（原 index.ts uninstall 内联块外迁，行为等价；卸载插件时使用）
     * 编辑器在运行中可能向 document.head 注入含 .cm-content 的 style，卸载时清理之。
     */
    cleanupEditorStyles() {
        const styleElements = Array.from(document.head.querySelectorAll("style")) as HTMLStyleElement[];
        for (const styleElement of styleElements) {
            if (styleElement.textContent?.includes(".cm-content")) {
                styleElement.remove();
                break;
            }
        }
    }
}
