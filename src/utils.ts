// 工具函数与思源文件 API 封装（无状态函数；原 storage.ts 已并入本模块）
import {fetchPost} from "siyuan";
import type {Dialog} from "siyuan";
import type {Snippet} from "./types";

/**
 * 插件名（通知消息 id / 快捷键键名前缀用，全库单源定义）
 */
export const PLUGIN_NAME = "snippets";

/** 代码片段编辑对话框的 data-key 值（元素标记 setAttribute 与 dataset.key 判定共用） */
export const SNIPPET_DIALOG_DATA_KEY = "jcsm-snippet-dialog";

/** 打开的代码片段编辑对话框基选择器（按片段 ID / 类型 / 是否存在 data-snippet-id 的变体基于它拼接） */
export const SNIPPET_DIALOG_SELECTOR = `.b3-dialog--open[data-key="${SNIPPET_DIALOG_DATA_KEY}"]`;

/**
 * 等待写操作 Promise 并归一化失败态（参考内核响应 { code, msg } 同形）
 * 写 API（saveData/removeData/持久化等）在只读模式/插件已销毁等场景会 reject；
 * 此处统一捕获 reject 并归一为 { code: 非 0, msg }，调用方只需检查 code 是否为 0。
 * @param promise 写操作 Promise（resolve 内核响应，reject 错误对象/响应）
 * @returns 归一化响应：成功为原响应（code 为 0）；失败为 { code: 非 0, msg }
 */
export const settleWriteResponse = async (promise: Promise<any>): Promise<{ code: number; msg: string }> => {
    try {
        return await promise;
    } catch (error: any) {
        // 与内核响应同形，便于统一按 code !== 0 判断；错误对象无 code 时记为 -1
        return { code: error?.code ?? -1, msg: error?.msg ?? error?.message ?? String(error) };
    }
};

/**
 * 将 Dialog 实例挂到其元素上（原生 Dialog 未提供按元素取实例；
 * 挂载后 closeByElement 可按元素取回以覆写 destroy/读取 id 等）
 * @param element 对话框元素（dialog.element）
 * @param dialog Dialog 实例
 */
export const attachDialogObject = (element: HTMLElement, dialog: Dialog) => {
    (element as HTMLElement & { dialogObject?: Dialog }).dialogObject = dialog;
};

/**
 * 取回挂在对话框元素上的 Dialog 实例（见 attachDialogObject）
 * @param element 对话框元素
 * @returns Dialog 实例（未挂载时为 undefined）
 */
export const getDialogObject = (element: HTMLElement): Dialog | undefined =>
    (element as HTMLElement & { dialogObject?: Dialog }).dialogObject;

/**
 * 对话框级键盘动作处理器（按 key 执行 Esc/Enter 对应的关闭/确认动作）
 * 供全局键盘协调器（SnippetsMenu.globalKeyDownHandler）在焦点不在对话框内时直接路由调用，
 * 避免把按键合成 click 事件中转（click 处理器保持纯鼠标语义）；焦点在对话框内时由其自身
 * 元素 keydown 监听器处理，两者只走其一。
 * @param key 按键标识（KeyboardEvent.key）
 */
export type DialogKeyHandler = (key: string) => void;

/**
 * 对话框键盘动作登记表（WeakMap：对话框元素随关闭移除后条目自动回收，无需显式清理）
 */
const dialogKeyHandlers = new WeakMap<HTMLElement, DialogKeyHandler>();

/**
 * 登记对话框级键盘动作（打开对话框时调用；Esc/Enter 之外的按键由调用方自行忽略）
 * @param element 对话框元素（dialog.element）
 * @param handler 键盘动作处理器
 */
export const setDialogKeyHandler = (element: HTMLElement, handler: DialogKeyHandler) => {
    dialogKeyHandlers.set(element, handler);
};

/**
 * 取回对话框级键盘动作处理器（未登记时为 undefined）
 * @param element 对话框元素
 * @returns 键盘动作处理器
 */
export const getDialogKeyHandler = (element: HTMLElement): DialogKeyHandler | undefined =>
    dialogKeyHandlers.get(element);

/**
 * 当前焦点是否为对话框内的按钮
 * 用于回车键处理：焦点在按钮上时交还浏览器默认行为触发该按钮的 click（对应按钮的鼠标路径处理），
 * 而不是执行对话框的默认确认动作——与思源原生 confirm 对话框的 Enter 语义一致
 * （app/src/boot/globalEvent/keydown.ts：activeElement 为对话框内按钮时直接 click 它）。
 * @param element 对话框元素（dialog.element）
 * @returns 焦点是否在对话框内的按钮上
 */
export const isDialogButtonFocused = (element: HTMLElement): boolean => {
    const activeElement = document.activeElement;
    return activeElement instanceof HTMLButtonElement && element.contains(activeElement);
};

/**
 * 生成代码片段开关 input 的 HTML（菜单项与编辑对话框共用同一模板，仅 class 前缀差异）
 * @param type 开关类型：snippetSwitch（启用）/ publishSwitch（发布服务中显示）
 * @param checked 是否勾选（publishSwitch 为 !disabledInPublish）
 * @param extraClass 附加在 b3-switch 前的 class（菜单项带 "jcsm-switch "，编辑对话框不带）
 * @param ariaLabel publishSwitch 的无障碍标签（snippetSwitch 无）
 * @param hidden 是否隐藏（publishSwitch 随“显示发布开关”配置，snippetSwitch 恒显示）
 * @returns 开关 input 的 HTML
 */
export const genSnippetSwitchHtml = (type: "snippetSwitch" | "publishSwitch", checked: boolean, extraClass: string, ariaLabel: string | undefined = undefined, hidden = false): string =>
    `<input data-type="${type}" class="${extraClass}b3-switch fn__flex-center${type === "publishSwitch" ? " ariaLabel" : ""}${hidden ? " fn__none" : ""}"${type === "publishSwitch" ? ` aria-label="${ariaLabel}" data-position="north"` : ""} type="checkbox"${checked ? " checked" : ""}>`;

/**
 * 隐藏 tooltip（参考原生代码 app/src/dialog/tooltip.ts ）
 */
export const hideTooltip = () => {
    document.getElementById("tooltip")?.classList.add("fn__none");
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
 * HTML 转义（用于把动态纯文本安全拼入 innerHTML 消息等场景）
 * @param text 纯文本
 * @returns 转义后的 HTML 文本
 */
export const escapeHtml = (text: string): string =>
    text.replace(/[&<>"']/g, (char) =>
        char === "&" ? "&amp;" :
        char === "<" ? "&lt;" :
        char === ">" ? "&gt;" :
        char === "\"" ? "&quot;" : "&#39;"
    );

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
    const allElements = document.querySelectorAll(`${SNIPPET_DIALOG_SELECTOR}, #commonMenu[data-name='PluginSnippets']`);
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

// ================================ 文件 API 封装（原 src/services/storage.ts） ================================

/**
 * fetchPost 回调形式转 Promise（统一封装：resolve 内核响应对象，错误提示由调用方按 code 处理）
 * @param url 请求地址
 * @param body 请求体（对象或 FormData；无请求体时可省略）
 * @returns Promise<any> 内核响应
 */
export const fetchPostPromise = (url: string, body?: any): Promise<any> =>
    new Promise((resolve) => {
        fetchPost(url, body, (response: any) => resolve(response));
    });

/**
 * 读取文件（原生代码 app/src/plugin/Plugin.ts getFile 方法）
 * @param path 文件路径
 * @returns Promise<any> 返回原始响应，由调用方处理 code/msg/data
 */
export const getFile = (path: string): Promise<any> =>
    // 解决 400 parses request failed 问题，fetchPost 需要传递对象而不是 JSON 字符串
    fetchPostPromise("/api/file/getFile", { path });

/**
 * 写入文件，返回 Promise
 * @param path 文件路径
 * @param content 文件内容（字符串文本或已构造的 File，zip 等二进制上传直接传 File）
 * @returns Promise<any>
 */
export const putFile = (path: string, content: string | File): Promise<any> => {
    if (!path || !content) {
        return Promise.reject({ code: 400, msg: "path or content is empty" });
    }

    const formData = new FormData();
    formData.append("path", path);
    formData.append("isDir", "false");
    formData.append("file", typeof content === "string"
        ? new File([content], path.split("/").pop() ?? "", { type: "text/plain" })
        : content);

    return fetchPostPromise("/api/file/putFile", formData);
};

/**
 * 重命名文件（内核 /api/file/renameFile）
 * @param path 原文件路径（相对工作空间）
 * @param newPath 新文件路径（相对工作空间）
 * @returns Promise<any> 返回原始响应，由调用方处理 code/msg
 */
export const renameFile = (path: string, newPath: string): Promise<any> =>
    fetchPostPromise("/api/file/renameFile", { path, newPath });

/**
 * 判断是否正在预览代码片段（开启了 CSS 实时预览且打开了对应的编辑对话框）
 * @param snippetId 代码片段 ID
 * @param snippetType 代码片段类型
 * @param realTimePreview 是否启用实时预览
 * @returns 是否正在预览
 */
export const isPreviewingSnippet = (snippetId: string, snippetType: string, realTimePreview: boolean): boolean =>
    snippetType === "css" && realTimePreview && !!document.querySelector(`${SNIPPET_DIALOG_SELECTOR}[data-snippet-id="${snippetId}"]`);