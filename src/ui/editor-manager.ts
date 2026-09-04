// 代码片段编辑对话框的 CodeMirror 编辑器
// 编辑器工厂纯函数（getEditorIndentUnit/createEditorExtensions/createCodeMirrorEditor，参数由调用方传入）
// 与 EditorManager（主题模式监听启停、已打开编辑器随主题/配置更新与重建）同本模块；
// 主题监听 observer 为实例字段：插件重载时 onunload 必停监听、重载后由 checkAndManageThemeWatch 按 DOM 现状自启。
import {closeBrackets, closeBracketsKeymap} from "@codemirror/autocomplete";
import {defaultKeymap, history, historyKeymap, indentWithTab} from "@codemirror/commands";
import {javascript} from "@codemirror/lang-javascript";
import {css} from "@codemirror/lang-css";
import {highlightSelectionMatches, searchKeymap} from "@codemirror/search";
import type {Extension} from "@codemirror/state";
import {EditorState} from "@codemirror/state";
import {vscodeDark, vscodeLight} from "@uiw/codemirror-theme-vscode";
import {
    bracketMatching,
    defaultHighlightStyle,
    foldGutter,
    foldKeymap,
    indentOnInput,
    indentUnit,
    syntaxHighlighting
} from "@codemirror/language";
import {
    crosshairCursor,
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    placeholder,
    rectangularSelection
} from "@codemirror/view";
import type PluginSnippets from "../index";
import {SNIPPET_DIALOG_SELECTOR} from "../utils";

/**
 * 编辑器扩展所需的插件 i18n 文案（取 codeSnippetJS/codeSnippetCSS 等键）
 * 使用 Record 类型别名以兼容插件基类 i18n 的 Record<string, string> 类型
 */
export type SnippetsEditorI18n = Record<string, string>;

/**
 * 获取编辑器缩进单位
 * @param indentUnitConfig 插件配置 editorIndentUnit（tab1/space4/followSiyuan 等）
 * @returns 缩进单位字符串
 */
export function getEditorIndentUnit(indentUnitConfig: string): string {
    if (indentUnitConfig.startsWith("tab")) {
        // 制表符配置
        const tabCount = parseInt(indentUnitConfig.replace("tab", ""));
        return "\t".repeat(tabCount);
    } else if (indentUnitConfig.startsWith("space")) {
        // 空格配置
        const spaceCount = parseInt(indentUnitConfig.replace("space", ""));
        return " ".repeat(spaceCount);
    } else {
        // indentUnitConfig === "followSiyuan" 或者 indentUnitConfig 是其他值
        const SiyuanCodeTabSpaces = window.siyuan.config.editor.codeTabSpaces;
        // 注意不能对 SiyuanCodeTabSpaces 做真值判断：思源 codeTabSpaces 为 0 表示“使用制表符缩进”，
        // 0 是 falsy，用 `0 && ...` 会把它挡在门外而误落两空格兜底
        if (typeof SiyuanCodeTabSpaces === "number" && SiyuanCodeTabSpaces >= 0) {
            // 跟随思源设置
            return SiyuanCodeTabSpaces === 0 ? "\t" : " ".repeat(SiyuanCodeTabSpaces);
        } else {
            // 默认缩进单位为两个空格
            return " ".repeat(2);
        }
    }
}

/**
 * 创建编辑器扩展配置（i18n/缩进单位由调用方传入，保持工厂纯函数）
 * @param theme 主题配置
 * @param language 语言类型（css | js）
 * @param indentUnitText 缩进单位字符串（由 getEditorIndentUnit 解析）
 * @param i18n 插件 i18n 文案
 * @returns 编辑器扩展数组
 */
export function createEditorExtensions(theme: Extension, language: string, indentUnitText: string, i18n: SnippetsEditorI18n) {
    // 根据语言类型设置占位符
    const placeholderText = language === "js" ? i18n.codeSnippetJS : i18n.codeSnippetCSS;
    // 根据语言类型选择相应的语言支持
    const languageSupport = language === "js" ? javascript() : css();

    return [
        // 显示行号
        lineNumbers(),
        // 标记特殊字符（不可打印或其他令人困惑的字符）
        highlightSpecialChars(),
        // 占位符
        placeholder(placeholderText),
        // 启用撤销/重做历史记录
        history(),
        // 显示代码折叠图标
        foldGutter(),
        // 绘制文本选择区域
        drawSelection(),
        // 显示拖拽光标（从其他地方拖入编辑器）
        dropCursor(),
        // 允许多重选择
        EditorState.allowMultipleSelections.of(true),
        // 输入时自动缩进
        indentOnInput(),
        // 启用语法高亮，使用默认高亮样式
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        // 高亮匹配的括号
        bracketMatching(),
        // 自动闭合括号
        closeBrackets(),
        // 启用自动完成功能
        // TODO考虑: 默认的补全关键词太少了，还不如没有。等之后再手工添加补全关键词
        // autocompletion(),
        // 启用矩形选择模式
        rectangularSelection(),
        // 显示十字光标
        crosshairCursor(),
        // 高亮当前活动行
        highlightActiveLine(),
        // 高亮所有匹配的选中文本
        highlightSelectionMatches(),
        // 设置缩进单位
        indentUnit.of(indentUnitText),
        // 配置快捷键映射
        keymap.of([
            // 括号闭合快捷键
            ...closeBracketsKeymap,
            // 默认快捷键（复制、粘贴、删除等）
            ...defaultKeymap,
            // 搜索快捷键
            ...searchKeymap,
            // 历史记录快捷键（撤销、重做）
            ...historyKeymap,
            // 代码折叠快捷键
            ...foldKeymap,
            // 自动完成快捷键
            // ...completionKeymap,
            // Tab 键缩进快捷键
            indentWithTab,
        ]),
        // 启用语言支持
        languageSupport,
        // 应用主题
        theme,
    ];
}

/**
 * 创建代码片段编辑器（缩进配置/i18n 由调用方传入，保持工厂纯函数）
 * @param container 容器元素
 * @param content 初始内容
 * @param language 语言类型（css | js）
 * @param indentUnitConfig 插件配置 editorIndentUnit（tab1/space4/followSiyuan 等）
 * @param i18n 插件 i18n 文案
 * @returns 编辑器视图
 */
export function createCodeMirrorEditor(container: HTMLElement, content: string, language: string, indentUnitConfig: string, i18n: SnippetsEditorI18n): EditorView {
    const theme = window.siyuan.config.appearance.mode === 0 ? vscodeLight : vscodeDark;
    const indentUnitText = getEditorIndentUnit(indentUnitConfig);

    // 创建编辑器状态
    const state = EditorState.create({
        doc: content,
        extensions: createEditorExtensions(theme, language, indentUnitText, i18n),
    });

    // 创建编辑器视图
    const view = new EditorView({
        state,
        parent: container
    });

    // 将编辑器实例存储到 DOM 元素上，以便后续主题切换/按元素关闭时取回（见 getEditorView）
    Object.assign(view.dom, { cmView: view });

    return view;
}

/**
 * 取回挂在 .cm-editor 元素上的 CodeMirror 实例（createCodeMirrorEditor 创建时经 Object.assign 挂载）
 * @param element .cm-editor 元素（可能为 null）
 * @returns 编辑器视图（未挂载时为 undefined）
 */
export const getEditorView = (element: Element | null): EditorView | undefined =>
    (element as (Element & { cmView?: EditorView }) | null)?.cmView;


/**
 * 编辑器对话框生命周期管理
 * - 主题模式监听：存在打开中的代码片段编辑对话框时监听 :root 的 data-theme-mode 变化，
 *   模式切换后更新所有已打开编辑器主题；无对话框时停止监听。
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
        return document.querySelectorAll(SNIPPET_DIALOG_SELECTOR).length > 0;
    }

    /**
     * 自动重新加载界面（JS 代码片段变更后重载才能生效）
     * 需同时满足：配置开启自动重载 && 已标记需要重载（isReloadUIRequired）&& 无打开的编辑对话框（避免丢失未保存内容）。
     * 调用点：菜单关闭回调、编辑对话框保存、文件监听 JS 移除（file-watch removeAll/removeFileWatchElement）。
     */
    maybeAutoReloadUI() {
        if (this.plugin.config.autoReloadUIAfterModifyJS && this.plugin.isReloadUIRequired && !this.hasEditorDialogsOpen()) {
            this.plugin.postReloadUI();
        }
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
        const snippetDialogs = document.querySelectorAll(SNIPPET_DIALOG_SELECTOR);
        snippetDialogs.forEach((dialogElement) => {
            const contentContainer = dialogElement.querySelector(".jcsm-dialog-content") as HTMLElement;
            if (!contentContainer) return;

            // 查找现有的 CodeMirror 编辑器 DOM 元素
            const existingEditorElement = contentContainer.querySelector(".cm-editor");
            if (!existingEditorElement) return;

            // 获取当前编辑器实例 - 通过 DOM 元素查找对应的 EditorView
            const editorView = getEditorView(existingEditorElement);
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
                extensions: createEditorExtensions(newTheme, snippetType, getEditorIndentUnit(this.plugin.config.editorIndentUnit), this.plugin.i18n),
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
        createCodeMirrorEditor(contentContainer, currentContent, snippetType, this.plugin.config.editorIndentUnit, this.plugin.i18n);

        this.plugin.console.log(`recreateEditor: editor recreated: ${dialogElement}`);
    }

    /**
     * 移除全局 CodeMirror 样式（禁用插件时使用）
     * 编辑器在运行中可能向 document.head 注入含 .cm-content 的 style，禁用时清理之。
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
