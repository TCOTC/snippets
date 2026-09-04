import type {Snippet} from "./types";

/**
 * 判断 Promise 是否已成功完成
 * @param promise Promise<any> 要判断的 Promise 对象
 * @returns Promise<boolean> 返回一个 Promise，resolve 的值为 true 表示已 fulfilled，false 表示未 fulfilled 或被 reject。
 */
export const isPromiseFulfilled = async (promise: Promise<any>): Promise<boolean> => {
    // 检查是否是 Promise 对象
    if (!(promise instanceof Promise)) {
        return false;
    }
    try {
        await promise;
        // fulfilled 状态
        return true;
    } catch (e) {
        // rejected 状态
        return false;
    }
};

/**
 * 隐藏 tooltip（原生代码 app/src/dialog/tooltip.ts ）
 */
export const hideTooltip = () => {
    document.getElementById("tooltip")!.classList.add("fn__none");
};

/**
 * 显示元素 tooltip
 * @param element 元素
 */
export const showElementTooltip = (element: HTMLElement) => {
    // 让元素触发 mouseover 事件，bubbles: true 启用冒泡，以激活原生的监听器，然后执行原生的 showTooltip()（原生代码 app/src/dialog/tooltip.ts ）
    element.dispatchEvent(new Event("mouseover", { bubbles: true }));
};

/**
 * 判断当前激活元素是否为输入框（input 或 textarea）
 * @returns 是否为输入框
 */
export const isInputElementActive = (): boolean => {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    const tagName = activeElement.tagName.toLowerCase();
    const type = activeElement.getAttribute("type");
    // 忽略按钮元素
    return (tagName === "input" && type !== "checkbox") || tagName === "textarea";
};

/**
 * 将 HTML 字符串转换为元素
 * @param html HTML 字符串
 * @returns 元素
 */
export const htmlToElement = (html: string): HTMLElement => {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.firstChild as HTMLElement;
};

/**
 * 使对话框或菜单元素显示在最上层（设置 zIndex）
 * @param element 元素
 */
export const moveElementToTop = (element: HTMLElement) => {
    if (!element) return;

    let maxZIndex = 0;
    // 查找所有打开的代码片段编辑对话框和菜单，如果 zIndex 不是最大的才增加
    const allElements = document.querySelectorAll(".b3-dialog--open[data-key='jcsm-snippet-dialog'], #commonMenu[data-name='PluginSnippets']");
    allElements.forEach((el: HTMLElement) => {
        const zIndex = Number(el.style.zIndex);
        if (zIndex > maxZIndex) {
            maxZIndex = zIndex;
        }
    });
    const dialogZIndex = Number(element.style.zIndex);
    if (dialogZIndex < maxZIndex) {
        element.style.zIndex = (++window.siyuan.zIndex).toString();
    }
};

/**
 * 生成新的代码片段 ID（与现有代码片段列表去重）
 * @param snippetsList 现有代码片段列表
 * @returns 新的代码片段 ID
 */
export const genNewSnippetId = (snippetsList: Snippet[]): string => {
    let newId = window.Lute.NewNodeID();
    while (snippetsList.find((s: Snippet) => s.id === newId)) {
        newId = window.Lute.NewNodeID();
    }
    return newId;
};

/**
 * 判断是否正在预览代码片段（开启了 CSS 实时预览且打开了对应的编辑对话框）
 * @param snippetId 代码片段 ID
 * @param snippetType 代码片段类型
 * @param realTimePreview 是否启用实时预览
 * @returns 是否正在预览
 */
export const isPreviewingSnippet = (snippetId: string, snippetType: string, realTimePreview: boolean): boolean =>
    snippetType === "css" && realTimePreview && !!document.querySelector(`.b3-dialog--open[data-key="jcsm-snippet-dialog"][data-snippet-id="${snippetId}"]`);