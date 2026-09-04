// domain/snippet-store.ts 单测
// 覆盖：列表唯一写路径 replaceAll/remove/upsert/insertBefore/move，
//       重点验证 CSS 在前、JS 在后的分区保持与 move 的跨分区边界语义。
import {beforeEach, describe, expect, it, vi} from "vitest";
import type PluginSnippets from "../index";
import type {Snippet} from "../types";
import {SnippetStore} from "./snippet-store";

/**
 * 构造代码片段
 * @param id 片段 id
 * @param type 类型
 * @param name 名称（默认同 id）
 * @returns 代码片段
 */
const makeSnippet = (id: string, type: "css" | "js", name = id): Snippet =>
    ({id, name, type, content: "content", enabled: true});

/**
 * 构造最小插件替身（仅提供 SnippetStore 依赖的 snippetsList 与菜单计数刷新）
 */
const createFakePlugin = () => ({
    snippetsList: [] as Snippet[],
    menuView: {setMenuSnippetCount: vi.fn()},
}) as unknown as PluginSnippets;

describe("SnippetStore", () => {
    let plugin: PluginSnippets;
    let store: SnippetStore;
    /** 菜单计数刷新桩（断言变更是否触发） */
    let notifySpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        plugin = createFakePlugin();
        plugin.snippetsList = [
            makeSnippet("css-1", "css", "Alpha"),
            makeSnippet("css-2", "css", "Beta"),
            makeSnippet("js-1", "js", "Gamma"),
            makeSnippet("js-2", "js", "Delta"),
        ];
        notifySpy = (plugin.menuView as unknown as {setMenuSnippetCount: ReturnType<typeof vi.fn>}).setMenuSnippetCount;
        store = new SnippetStore(plugin);
        notifySpy.mockClear();
    });

    describe("replaceAll", () => {
        it("整表替换并刷新菜单计数", () => {
            const next = [makeSnippet("js-9", "js")];
            store.replaceAll(next);
            expect(plugin.snippetsList).toBe(next);
            expect(notifySpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("remove", () => {
        it("删除存在的片段并刷新计数", () => {
            store.remove("css-1");
            expect(plugin.snippetsList.map(s => s.id)).toEqual(["css-2", "js-1", "js-2"]);
            expect(notifySpy).toHaveBeenCalledTimes(1);
        });

        it("片段不存在时不改动列表（保持原引用）也不刷新计数", () => {
            const original = plugin.snippetsList;
            store.remove("not-exist");
            expect(plugin.snippetsList).toBe(original);
            expect(notifySpy).not.toHaveBeenCalled();
        });
    });

    describe("upsert", () => {
        it("新增 CSS 片段插入到开头", () => {
            store.upsert(makeSnippet("css-new", "css"));
            expect(plugin.snippetsList.map(s => s.id)).toEqual(["css-new", "css-1", "css-2", "js-1", "js-2"]);
            expect(notifySpy).toHaveBeenCalledTimes(1);
        });

        it("新增 JS 片段插入到首个 JS 之前（保持分区）", () => {
            store.upsert(makeSnippet("js-new", "js"));
            expect(plugin.snippetsList.map(s => s.id)).toEqual(["css-1", "css-2", "js-new", "js-1", "js-2"]);
            expect(notifySpy).toHaveBeenCalledTimes(1);
        });

        it("无 JS 片段时新增 JS 追加到末尾", () => {
            plugin.snippetsList = [makeSnippet("css-1", "css")];
            store.upsert(makeSnippet("js-new", "js"));
            expect(plugin.snippetsList.map(s => s.id)).toEqual(["css-1", "js-new"]);
        });

        it("同 ID 片段整体替换且保持原位置", () => {
            store.upsert(makeSnippet("css-2", "css", "Beta 改"));
            const ids = plugin.snippetsList.map(s => s.id);
            expect(ids).toEqual(["css-1", "css-2", "js-1", "js-2"]);
            expect(plugin.snippetsList[1].name).toBe("Beta 改");
            expect(notifySpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("insertBefore", () => {
        it("锚点存在时插入到锚点之前", () => {
            store.insertBefore(makeSnippet("css-new", "css"), "css-2");
            expect(plugin.snippetsList.map(s => s.id)).toEqual(["css-1", "css-new", "css-2", "js-1", "js-2"]);
            expect(notifySpy).toHaveBeenCalledTimes(1);
        });

        it("锚点缺失时回退为按分区新增（upsert 语义）", () => {
            store.insertBefore(makeSnippet("js-new", "js"), "not-exist");
            // 走 upsert：JS 插到首个 JS 前
            expect(plugin.snippetsList.map(s => s.id)).toEqual(["css-1", "css-2", "js-new", "js-1", "js-2"]);
            expect(notifySpy).toHaveBeenCalledTimes(1);
        });
    });

    describe("move", () => {
        it("同区内向下移动（isTop=false）", () => {
            const moved = store.move("css-1", "css-2", false);
            expect(moved).toBe(true);
            expect(plugin.snippetsList.map(s => s.id)).toEqual(["css-2", "css-1", "js-1", "js-2"]);
            expect(notifySpy).toHaveBeenCalledTimes(1);
        });

        it("同区内向上移动（isTop=true）", () => {
            const moved = store.move("css-2", "css-1", true);
            expect(moved).toBe(true);
            expect(plugin.snippetsList.map(s => s.id)).toEqual(["css-2", "css-1", "js-1", "js-2"]);
            expect(notifySpy).toHaveBeenCalledTimes(1);
        });

        it("移动到自身位置视为无变化，返回 false 且不刷新计数", () => {
            const moved = store.move("css-1", "css-1", true);
            expect(moved).toBe(false);
            expect(notifySpy).not.toHaveBeenCalled();
        });

        it("目标片段不存在时返回 false", () => {
            const moved = store.move("css-1", "not-exist", false);
            expect(moved).toBe(false);
            expect(notifySpy).not.toHaveBeenCalled();
        });

        it("跨分区（CSS 拖到 JS 后）落位到 CSS 分区末尾", () => {
            // 移除 css-1 后源分区仍剩 css-2/css-3 两个同类可承接；分区保持 → 移到最后一个 CSS 之后
            plugin.snippetsList = [
                makeSnippet("css-1", "css"),
                makeSnippet("css-2", "css"),
                makeSnippet("css-3", "css"),
                makeSnippet("js-1", "js"),
            ];
            const moved = store.move("css-1", "js-1", false);
            expect(moved).toBe(true);
            expect(plugin.snippetsList.map(s => s.id)).toEqual(["css-2", "css-3", "css-1", "js-1"]);
            expect(notifySpy).toHaveBeenCalledTimes(1);
        });

        it("跨分区（JS 拖到 CSS 前）落位到 JS 分区头部", () => {
            // 移除 js-3 后源分区仍剩 js-1/js-2 两个同类可承接；分区保持 → 移到首个 JS 之前
            plugin.snippetsList = [
                makeSnippet("css-1", "css"),
                makeSnippet("js-1", "js"),
                makeSnippet("js-2", "js"),
                makeSnippet("js-3", "js"),
            ];
            const moved = store.move("js-3", "css-1", true);
            expect(moved).toBe(true);
            expect(plugin.snippetsList.map(s => s.id)).toEqual(["css-1", "js-3", "js-1", "js-2"]);
            expect(notifySpy).toHaveBeenCalledTimes(1);
        });

        it("跨分区且移除后源分区仅剩一个同类项时恢复原位并返回 false", () => {
            // 两个 CSS 中移走 css-1 后只剩 css-2：无第二个同类承接 → 原位不变
            plugin.snippetsList = [
                makeSnippet("css-1", "css"),
                makeSnippet("css-2", "css"),
                makeSnippet("js-1", "js"),
                makeSnippet("js-2", "js"),
            ];
            const moved = store.move("css-1", "js-2", false);
            expect(moved).toBe(false);
            expect(plugin.snippetsList.map(s => s.id)).toEqual(["css-1", "css-2", "js-1", "js-2"]);
            expect(notifySpy).not.toHaveBeenCalled();
        });
    });
});
