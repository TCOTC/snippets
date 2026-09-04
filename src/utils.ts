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
 * 判断是否是 Mac（原生代码 app/src/protyle/util/compatibility.ts ）
 * @returns 是否是 Mac
 */
export const isMac = (): boolean => {
    return navigator.platform.toUpperCase().indexOf("MAC") > -1;
};

/**
 * 获取快捷键显示文本（原生代码 app/src/protyle/util/compatibility.ts updateHotkeyTip() ）
 * @param hotkey 快捷键
 * @returns 快捷键显示文本
 */
export const getHotkeyDisplayText = (hotkey: string): string => {
    if (isMac()) {
        return hotkey;
    }

    const KEY_MAP = new Map(Object.entries({
        "⌘": "Ctrl",
        "⌃": "Ctrl",
        "⇧": "Shift",
        "⌥": "Alt",
        "⇥": "Tab",
        "⌫": "Backspace",
        "⌦": "Delete",
        "↩": "Enter",
    }));

    const keys = [];

    if ((hotkey.indexOf("⌘") > -1 || hotkey.indexOf("⌃") > -1)) keys.push(KEY_MAP.get("⌘"));
    if (hotkey.indexOf("⇧") > -1) keys.push(KEY_MAP.get("⇧"));
    if (hotkey.indexOf("⌥") > -1) keys.push(KEY_MAP.get("⌥"));

    // 不能去最后一个，需匹配 F2
    // noinspection RegExpSingleCharAlternation
    const lastKey = hotkey.replace(/⌘|⇧|⌥|⌃/g, "");
    if (lastKey) {
        keys.push(KEY_MAP.get(lastKey) || lastKey);
    }

    return keys.join("+");
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