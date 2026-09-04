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

// 环境探测
export const getFrontend = vi.fn(() => "desktop");
export const getBackend = vi.fn(() => "windows");

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

export class Dialog {
    id = "";
    destroy = vi.fn();
}
