// services/snippet-groups.ts 单测（node 环境）
// 覆盖：load 对账 + 补齐未分组占位；save 存在真实分组时写文件；
//       没有任何真实分组（含仅剩占位）时删除分组文件并清空缓存。
import {beforeEach, describe, expect, it, vi} from "vitest";
import type PluginSnippets from "../index";
import type {Snippet, SnippetType} from "../types";
import {PLUGIN_GROUPS_STORAGE_NAME, SnippetGroupStore} from "./snippet-groups";
import {UNGROUPED_GROUP_ID} from "../domain/snippet-groups";

const makeSnippet = (id: string, type: SnippetType): Snippet => ({id, name: id, type, content: "x", enabled: true});

/** 构造仅含分组存储所需方法的插件替身 */
const createPlugin = (stored: any = "") => {
    const plugin = {
        // loadData 语义：拉取后写入 plugin.data[storageName]
        loadData: vi.fn(async (storageName: string) => {
            (plugin.data as Record<string, any>)[storageName] = stored;
        }),
        saveData: vi.fn(async () => ({code: 0, msg: ""})),
        removeData: vi.fn(async () => ({code: 0, msg: "", data: null})),
        data: {} as Record<string, any>,
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
    } as unknown as PluginSnippets;
    return plugin;
};

describe("SnippetGroupStore", () => {
    let plugin: PluginSnippets;
    let store: SnippetGroupStore;

    beforeEach(() => {
        plugin = createPlugin([]);
        store = new SnippetGroupStore(plugin);
    });

    describe("load", () => {
        it("对账权威片段列表并补齐未分组占位", async () => {
            const stored = [
                {id: "g1", type: "css", name: "样式", snippetIds: ["c1", "gone"]},
            ];
            plugin = createPlugin(stored);
            store = new SnippetGroupStore(plugin);

            await store.load([makeSnippet("c1", "css")]);
            // 孤儿 gone 被剔除；补齐 default 占位
            expect(store.groups.map(group => group.id)).toEqual(["g1", UNGROUPED_GROUP_ID]);
            expect(store.groups[0].snippetIds).toEqual(["c1"]);
        });

        it("文件不存在/损坏时回退空", async () => {
            plugin = createPlugin("");
            store = new SnippetGroupStore(plugin);
            await store.load([makeSnippet("c1", "css")]);
            expect(store.groups).toEqual([]);
        });
    });

    describe("save", () => {
        it("存在真实分组时写入分组文件", async () => {
            store.groups = [
                {id: "g1", type: "css", name: "样式", snippetIds: ["c1"]},
                {id: UNGROUPED_GROUP_ID, type: "css", name: "", snippetIds: []},
            ];
            await store.save();
            expect(plugin.saveData).toHaveBeenCalledWith(PLUGIN_GROUPS_STORAGE_NAME, store.groups);
            expect(plugin.removeData).not.toHaveBeenCalled();
        });

        it("没有任何真实分组时删除分组文件并清空缓存", async () => {
            store.groups = [];
            await store.save();
            expect(plugin.removeData).toHaveBeenCalledWith(PLUGIN_GROUPS_STORAGE_NAME);
            expect(plugin.saveData).not.toHaveBeenCalled();
            expect(store.groups).toEqual([]);
        });

        it("仅剩未分组占位时也视为无分组并删除文件", async () => {
            store.groups = [{id: UNGROUPED_GROUP_ID, type: "css", name: "", snippetIds: []}];
            await store.save();
            expect(plugin.removeData).toHaveBeenCalledWith(PLUGIN_GROUPS_STORAGE_NAME);
            expect(plugin.saveData).not.toHaveBeenCalled();
            expect(store.groups).toEqual([]);
        });

        it("删除失败（如只读）时保持缓存为空且不抛错", async () => {
            vi.mocked(plugin.removeData).mockRejectedValue({code: 403, msg: "Readonly mode"});
            store.groups = [];
            await expect(store.save()).resolves.toBeUndefined();
            expect(store.groups).toEqual([]);
        });
    });
});
