// CodeMirror 6 编辑器工厂（扩展配置/视图创建的纯函数，参数由调用方传入）
import {closeBrackets, closeBracketsKeymap} from "@codemirror/autocomplete"; // autocompletion, completionKeymap
import {defaultKeymap, history, historyKeymap, indentWithTab} from "@codemirror/commands";
import {javascript} from "@codemirror/lang-javascript";
import {css} from "@codemirror/lang-css";
import {highlightSelectionMatches, searchKeymap} from "@codemirror/search";
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
        if (SiyuanCodeTabSpaces && typeof SiyuanCodeTabSpaces === "number" && SiyuanCodeTabSpaces >= 0) {
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
export function createEditorExtensions(theme: any, language: string, indentUnitText: string, i18n: SnippetsEditorI18n) {
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

    // 将编辑器实例存储到 DOM 元素上，以便后续主题切换时能够找到
    (view.dom as any).cmView = view;

    return view;
}
