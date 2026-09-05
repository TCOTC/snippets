// siyuan 运行时 mock（vitest.config.ts alias "siyuan" → 本文件）
// 思源宿主在插件运行时注入 siyuan 模块，单测环境以本桩替代：
// - 函数级桩（fetchPost 等）为 vi.fn，测试内经 vi.mocked 控制行为与断言调用；
// - 类桩（Plugin/Setting/Dialog 等）保持可实例化并登记构造，供服务装配类测试使用；
// - 新增需要 import "siyuan" 的测试时，在此补充对应导出（保持与 siyuan.d.ts 同名同形）。
import {vi} from "vitest";
import type {SettingItem} from "../../src/types";

// HTTP API（fetchPost 回调形，见 src/utils.ts fetchPostPromise 封装）
export const fetchPost = vi.fn();
export const fetchSyncPost = vi.fn();
export const fetchGet = vi.fn();

// 消息提示 API（feedback/config-service 使用）
export const showMessage = vi.fn();
export const hideMessage = vi.fn();
export const confirm = vi.fn();

// 导出下载（import-export 使用）
export const saveExportFile = vi.fn(async () => undefined);

// 原生设置跳转（setting-dialog 使用）
export const openSetting = vi.fn(() => undefined);

// 平台工具（menu.ts 使用）
export const platformUtils = {
    isMobile: () => false,
    isTouchDevice: () => false,
    isMac: () => false,
};

/**
 * Menu 桩：提供菜单容器 element 与基础状态字段（menu.ts 使用）
 */
export class Menu {
    element: HTMLElement;
    isOpen = false;

    constructor() {
        this.element = document.createElement("div");
        this.element.id = "commonMenu";
    }
}

// 环境探测
export const getFrontend = vi.fn(() => "desktop");
export const getBackend = vi.fn(() => "windows");

// 常量（取值与思源 petal/src/constants.ts 对齐；仅收录测试与源码断言会用到的键，
// 新增用例需要其他常量时在此补充）
export const Constants = {
    SIYUAN_APPID: "siyuan",
    TIMEOUT_OPENDIALOG: 50,
    TIMEOUT_DBLCLICK: 200,
    SIZE_SCROLL_TB: 40,
    SIZE_SCROLL_STEP: 30,
    SIYUAN_CONTEXT_MENU: "siyuan-context-menu",
    DIALOG_CONFIRM: "dialog-confirm",
};

// 类桩：可实例化、可 spy 构造次数与原型方法
export class Plugin {
    loadData = vi.fn(async () => "");
    saveData = vi.fn(async () => undefined);
    removeData = vi.fn(async () => undefined);
    i18n: Record<string, string> = {};
    eventBus = {on: vi.fn(), off: vi.fn(), emit: vi.fn()};
}

export class Setting {
    addItem = vi.fn();
    items: SettingItem[] = [];
}

/**
 * Dialog 桩：将构造选项的 content HTML 挂到 element 上，使
 * dialog.element.querySelector(".b3-dialog__content") 等选择器可直接用于装配断言
 */
export class Dialog {
    element: HTMLElement;
    destroy = vi.fn();
    options: {title?: string; content?: string; width?: string; height?: string};

    constructor(options: {title?: string; content?: string; width?: string; height?: string} = {}) {
        this.options = options;
        this.element = document.createElement("div");
        // 与原生 Dialog 一致：最外层带 b3-dialog--open 与 data-key，内部嵌套 .b3-dialog 容器
        // （closeByElement 依赖 dialogElement.querySelector(".b3-dialog") 的 style）
        this.element.className = "b3-dialog b3-dialog--open";
        if (options.content) {
            this.element.innerHTML = options.content;
        }
        // 原生结构为 .b3-dialog > .b3-dialog__container（snippets-dialog 多编辑器模式依赖它定位容器）
        const inner = document.createElement("div");
        inner.className = "b3-dialog";
        this.element.appendChild(inner);
        const container = document.createElement("div");
        container.className = "b3-dialog__container";
        inner.appendChild(container);
        // 原生 Dialog 构造即把 element 挂到 document.body（setting-dialog/snippets-dialog 依赖）
        if (typeof document !== "undefined") {
            document.body.appendChild(this.element);
        }
    }
}
