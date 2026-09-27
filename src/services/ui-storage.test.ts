// services/ui-storage.ts 单测（node 环境）
// 覆盖：load 拉取单键完整 JSON 并写入折叠/类型缓存（含非法值忽略）、saveGroupCollapsed /
//       saveSnippetsType 整体落库（保留对方字段）、clear 移除单键；fetchPost 载荷正确，失败时静默。
import {beforeEach, describe, expect, it, vi} from "vitest";
import {fetchPost} from "siyuan";
import type PluginSnippets from "../index";
import {SnippetUiStorage, UI_STATE_LOCAL_KEY} from "./ui-storage";

/** fetchPostPromise 以回调形分发，这里按 URL 分派存储请求响应 */
const mockLocalStorageFetch = (handler: (url: string, body: any) => { code: number; data?: any }) => {
    vi.mocked(fetchPost).mockImplementation(((_url: string, _body: unknown, callback?: (response: any) => void) => {
        const response = handler(_url, _body);
        callback?.(response);
        return undefined;
    }) as never);
};

const createPlugin = () => ({
    console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
} as unknown as PluginSnippets);

describe("SnippetUiStorage", () => {
    let plugin: PluginSnippets;
    let service: SnippetUiStorage;

    beforeEach(() => {
        plugin = createPlugin();
        service = new SnippetUiStorage(plugin);
        vi.mocked(fetchPost).mockReset();
    });

    it("load：单键读取返回该键值并写入缓存", async () => {
        const calls: Array<{url: string; body: any}> = [];
        mockLocalStorageFetch((url, body) => {
            calls.push({url, body});
            // getLocalStorageVal 直接把值放 data
            return { code: 0, data: { groupCollapsed: { "css.g1": true }, snippetsType: "js" } };
        });

        await service.load();
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("/api/storage/getLocalStorageVal");
        expect(calls[0].body.key).toBe(UI_STATE_LOCAL_KEY);
        expect(service.groupCollapsed).toEqual({ "css.g1": true });
        expect(service.snippetsType).toBe("js");
    });

    it("load：值缺失/非法类型忽略、缺省时保留现状", async () => {
        service.snippetsType = "css";
        mockLocalStorageFetch(() => ({ code: 0, data: { groupCollapsed: null, snippetsType: "weird" } }));
        await service.load();
        expect(service.groupCollapsed).toEqual({});
        expect(service.snippetsType).toBe("css"); // 非法值不覆盖
    });

    it("load：请求异常时静默且不覆盖现状", async () => {
        service.groupCollapsed = { "js.g1": true };
        service.snippetsType = "css";
        // 回调返回空响应（data 缺省）：服务应静默保留缓存，不抛错
        vi.mocked(fetchPost).mockImplementation(((_url: string, _body: unknown, callback?: (response: any) => void) => {
            callback?.({ code: -1, msg: "readonly" });
            return undefined;
        }) as never);
        await expect(service.load()).resolves.toBeUndefined();
        expect(service.groupCollapsed).toEqual({ "js.g1": true });
        expect(service.snippetsType).toBe("css");
    });

    it("saveGroupCollapsed：写入折叠并整体落库（保留类型字段）", async () => {
        const calls: Array<{url: string; body: any}> = [];
        mockLocalStorageFetch((url, body) => { calls.push({url, body}); return { code: 0 }; });
        service.snippetsType = "js";

        await service.saveGroupCollapsed({ "css.g1": true });
        expect(calls[0].url).toBe("/api/storage/setLocalStorageVal");
        expect(calls[0].body).toEqual({ key: UI_STATE_LOCAL_KEY, val: { groupCollapsed: { "css.g1": true }, snippetsType: "js" } });
        expect(service.groupCollapsed).toEqual({ "css.g1": true });
    });

    it("saveSnippetsType：写入上次类型并整体落库（保留折叠字段）", async () => {
        const calls: Array<{url: string; body: any}> = [];
        mockLocalStorageFetch((url, body) => { calls.push({url, body}); return { code: 0 }; });
        service.groupCollapsed = { "css.g1": true };

        await service.saveSnippetsType("js");
        expect(calls[0].url).toBe("/api/storage/setLocalStorageVal");
        expect(calls[0].body).toEqual({ key: UI_STATE_LOCAL_KEY, val: { groupCollapsed: { "css.g1": true }, snippetsType: "js" } });
        expect(service.snippetsType).toBe("js");
    });

    it("clear：移除单键（卸载用）", async () => {
        const calls: Array<{url: string; body: any}> = [];
        mockLocalStorageFetch((url, body) => { calls.push({url, body}); return { code: 0 }; });

        await service.clear();
        expect(calls[0].url).toBe("/api/storage/removeLocalStorageVal");
        expect(calls[0].body).toEqual({ key: UI_STATE_LOCAL_KEY });
    });

    it("写入异常时静默且已更新内存缓存", async () => {
        vi.mocked(fetchPost).mockImplementation(((_url: string, _body: unknown, callback?: (response: any) => void) => {
            callback?.({ code: -1, msg: "readonly" });
            return undefined;
        }) as never);
        await expect(service.saveGroupCollapsed({ "css.g1": true })).resolves.toBeUndefined();
        expect(service.groupCollapsed).toEqual({ "css.g1": true });
    });
});
