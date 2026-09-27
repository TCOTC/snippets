// ui/menu-drag-sort.ts MenuDragSort 单测
// 覆盖：非 customSort 早退、非片段项早退、容器缺失早退、桌面鼠标拖拽成功（落库/广播/置位清理）、
//       拖拽回原位（move false）与自拉失败时不广播并延迟清理状态。
// 依赖 jsdom DOM（menuItems 容器 + 片段项）与 Constants mock；容器/项的 getBoundingClientRect 以桩固定。
// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type PluginSnippets from "../index";
import type {SnippetGroup} from "../domain/snippet-groups";
import {MenuDragSort} from "./menu-drag-sort";

/** 构造拖拽测试环境 */
const setup = (options: {sortType?: string; refreshResult?: boolean; moveResult?: boolean} = {}) => {
    const {
        sortType = "customSort",
        refreshResult = true,
        moveResult = true,
    } = options;

    const broadcast = vi.fn();
    const plugin = {
        config: {snippetSortType: sortType},
        menuView: {menuItems: undefined as unknown as HTMLElement, isGroupedView: () => false},
        snippetManager: {
            refreshSnippetsList: vi.fn(async () => refreshResult),
            saveSnippetsList: vi.fn(async () => undefined),
        },
        snippetStore: {move: vi.fn(() => moveResult)},
        syncService: {broadcast},
    } as unknown as PluginSnippets;

    // 菜单容器：menuItems 为外层容器，内含 .jcsm-snippets-container（含两个片段项）
    const menuItemsEl = document.createElement("div");
    const container = document.createElement("div");
    container.className = "jcsm-snippets-container";
    container.innerHTML = `
        <div class="jcsm-snippet-item" data-id="css-1" data-type="css"><span class="jcsm-snippet-name">CSS</span></div>
        <div class="jcsm-snippet-item" data-id="js-1" data-type="js"><span class="jcsm-snippet-name">JS</span></div>
    `;
    menuItemsEl.appendChild(container);
    const selectItem = container.children[0] as HTMLElement;
    const item = container.children[1] as HTMLElement;

    // 固定布局矩形：容器覆盖 (top:-100, bottom:200) 范围
    container.getBoundingClientRect = () => ({top: -100, bottom: 200, left: -100, right: 300, width: 400, height: 300, x: -100, y: -100, toJSON: () => ({})}) as DOMRect;
    selectItem.getBoundingClientRect = () => ({top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({})}) as DOMRect;
    item.getBoundingClientRect = () => ({top: 0, bottom: 40, left: 0, right: 200, width: 200, height: 40, x: 0, y: 0, toJSON: () => ({})}) as DOMRect;

    plugin.menuView.menuItems = menuItemsEl;

    const dragSort = new MenuDragSort(plugin);
    return {dragSort, plugin, container, item, selectItem, broadcast};
};

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** 触发一次完整桌面拖拽：mousedown → 位移 mousemove → mouseup */
const dragTo = async (dragSort: MenuDragSort, selectItem: HTMLElement, from = {x: 10, y: 10}, to = {x: 80, y: 80}) => {
    const downEvent = new MouseEvent("mousedown", {clientX: from.x, clientY: from.y, bubbles: true});
    const item = selectItem.parentElement!.children[1] as HTMLElement;
    Object.defineProperty(downEvent, "target", {value: item});
    dragSort.handleMenuMousedown(downEvent);
    // mousemove 必须为真 MouseEvent（实现内以 instanceof 区分鼠标/触摸）；指向 selectItem 下半区 → dragover__bottom
    const moveEvent = new MouseEvent("mousemove", {clientX: to.x, clientY: to.y, bubbles: true});
    Object.defineProperty(moveEvent, "target", {value: selectItem});
    (document as unknown as {onmousemove: ((e: MouseEvent) => void) | null}).onmousemove?.(moveEvent);
    await (document as unknown as {onmouseup: (() => Promise<void>) | null}).onmouseup?.();
};

describe("MenuDragSort", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        document.ondragstart = null;
        (document as unknown as {onmousemove: unknown}).onmousemove = null;
        (document as unknown as {onmouseup: unknown}).onmouseup = null;
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("拖拽前置条件", () => {
        it("非 customSort 排序模式不启动拖拽（不注册 mousemove）", () => {
            const {dragSort} = setup({sortType: "fileNameASC"});
            dragSort.handleMenuMousedown({target: document.createElement("div")} as unknown as MouseEvent);
            expect((document as unknown as {onmousemove: unknown}).onmousemove).toBeNull();
            expect(dragSort.isDragging).toBe(false);
        });

        it("按下目标不是片段项时不启动拖拽", () => {
            const {dragSort, container} = setup();
            const blank = document.createElement("div");
            container.appendChild(blank);
            dragSort.handleMenuMousedown({target: blank, clientX: 0, clientY: 0} as unknown as MouseEvent);
            expect((document as unknown as {onmousemove: unknown}).onmousemove).toBeNull();
        });

        it("菜单容器缺失时不启动拖拽", () => {
            const {dragSort, plugin} = setup();
            (plugin.menuView as unknown as {menuItems: HTMLElement}).menuItems = document.createElement("div"); // 无 .jcsm-snippets-container
            const item = document.createElement("div");
            item.className = "jcsm-snippet-item";
            dragSort.handleMenuMousedown({target: item} as unknown as MouseEvent);
            expect((document as unknown as {onmousemove: unknown}).onmousemove).toBeNull();
        });
    });

    describe("拖拽排序执行", () => {
        it("移动到目标片段并完成排序：Store 移动 + 落库 + 广播", async () => {
            const {dragSort, plugin, item, selectItem, broadcast} = setup();
            const container = item.parentElement!;
            await dragTo(dragSort, selectItem);

            expect(plugin.snippetStore.move).toHaveBeenCalledWith("js-1", "css-1", false);
            expect(plugin.snippetManager.saveSnippetsList).toHaveBeenCalled();
            expect(broadcast).toHaveBeenCalledWith({type: "snippets_sort"});
            // 落点高亮已清除
            expect(container.querySelector(".dragover__top, .dragover__bottom")).toBeNull();
            expect(dragSort.isDragging).toBe(false);
        });

        it("Store 判定位置未变化时不广播，并延迟清理拖拽状态", async () => {
            const {dragSort, plugin, selectItem, broadcast} = setup({moveResult: false});
            await dragTo(dragSort, selectItem);
            expect(plugin.snippetStore.move).toHaveBeenCalled();
            expect(broadcast).not.toHaveBeenCalled();
            // clearDragState：50ms 后才复位拖拽状态
            expect(dragSort.isDragging).toBe(true);
            await wait(60);
            expect(dragSort.isDragging).toBe(false);
            expect((document as unknown as {onmousemove: unknown}).onmousemove).toBeNull();
        });

        it("自拉列表失败时中止排序不广播", async () => {
            const {dragSort, plugin, selectItem, broadcast} = setup({refreshResult: false});
            await dragTo(dragSort, selectItem);
            expect(plugin.snippetManager.refreshSnippetsList).toHaveBeenCalled();
            expect(plugin.snippetStore.move).not.toHaveBeenCalled();
            expect(broadcast).not.toHaveBeenCalled();
            // 结束拖拽后同样延迟复位
            await wait(60);
            expect(dragSort.isDragging).toBe(false);
        });
    });

    describe("分组视图拖拽归属", () => {
        /** 构造分组视图 DOM 与插件替身（executeGroupedDragSort 直接调用） */
        const buildGroupedEnv = (groups: SnippetGroup[]) => {
            const store = {
                groups: groups.map(g => ({...g, snippetIds: [...g.snippetIds]})),
                load: vi.fn(async () => undefined),
                save: vi.fn(async () => undefined),
            };
            const broadcast = vi.fn();
            const plugin = {
                config: {snippetSortType: "customSort"},
                snippetsList: [],
                menuView: {
                    isGroupedView: () => true,
                    initSnippetsContainer: vi.fn(),
                    menuItems: document.createElement("div"),
                },
                snippetGroupStore: store,
                snippetManager: {
                    refreshSnippetsList: vi.fn(async () => true),
                    saveSnippetsList: vi.fn(async () => undefined),
                },
                snippetStore: {move: vi.fn(() => false)},
                syncService: {broadcast},
            } as unknown as PluginSnippets;
            const dragSort = new MenuDragSort(plugin);

            const root = document.createElement("div");
            // CSS 分组 g1 区段
            const grpSection = document.createElement("section");
            grpSection.className = "jcsm-group-section";
            grpSection.dataset.snippetType = "css";
            grpSection.dataset.groupId = "g1";
            const grpHeader = document.createElement("div");
            grpHeader.className = "jcsm-group-header";
            grpHeader.dataset.groupId = "g1";
            grpSection.appendChild(grpHeader);
            // CSS 未分组区段（占位分组 id 固定为 default）
            const ungrpSection = document.createElement("section");
            ungrpSection.className = "jcsm-group-section";
            ungrpSection.dataset.snippetType = "css";
            ungrpSection.dataset.groupId = "default";
            ungrpSection.dataset.ungrouped = "true";
            const ungrpHeader = document.createElement("div");
            ungrpHeader.className = "jcsm-group-header";
            ungrpHeader.dataset.groupId = "default";
            ungrpHeader.dataset.ungrouped = "true";
            ungrpSection.appendChild(ungrpHeader);
            root.append(grpSection, ungrpSection);
            document.body.appendChild(root);

            const member = (id: string, section: HTMLElement) => {
                const el = document.createElement("div");
                el.className = "jcsm-snippet-item b3-menu__item";
                el.dataset.id = id;
                el.dataset.type = "css";
                section.appendChild(el);
                return el;
            };
            return {dragSort, plugin, store, grpSection, grpHeader, ungrpSection, ungrpHeader, member};
        };

        afterEach(() => {
            document.body.innerHTML = "";
        });

        it("未分组片段拖到组头：移入该组并落盘保存", async () => {
            const {dragSort, plugin, store, grpHeader, ungrpSection, member} = buildGroupedEnv([{id: "g1", type: "css", name: "样式组", snippetIds: []}]);
            const item = member("u1", ungrpSection);

            const changed = await (dragSort as unknown as {executeGroupedDragSort: (i: HTMLElement, s: HTMLElement) => Promise<boolean>}).executeGroupedDragSort(item, grpHeader);
            expect(changed).toBe(true);
            expect(store.groups[0].snippetIds).toEqual(["u1"]);
            expect(store.save).toHaveBeenCalledTimes(1);
            expect(plugin.menuView.initSnippetsContainer).toHaveBeenCalled();
        });

        it("分组片段拖到未分组头：移出所在组（片段本身保留）", async () => {
            const {dragSort, plugin, store, ungrpHeader, member} = buildGroupedEnv([{id: "g1", type: "css", name: "样式组", snippetIds: ["c1"]}]);
            const item = member("c1", document.querySelector(".jcsm-group-section[data-group-id=\"g1\"]") as HTMLElement);
            const changed = await (dragSort as unknown as {executeGroupedDragSort: (i: HTMLElement, s: HTMLElement) => Promise<boolean>}).executeGroupedDragSort(item, ungrpHeader);
            expect(changed).toBe(true);
            expect(store.groups[0].snippetIds).toEqual([]);
            expect(store.save).toHaveBeenCalledTimes(1);
            expect(plugin.menuView.initSnippetsContainer).toHaveBeenCalled();
        });

        it("组内拖到目标片段上方：按目标位置重排该组 snippetIds", async () => {
            const {dragSort, plugin, store, grpSection, member} = buildGroupedEnv([{id: "g1", type: "css", name: "样式组", snippetIds: ["c2", "c1"]}]);
            const item = member("c1", grpSection);
            const target = member("c2", grpSection);
            target.classList.add("dragover__top"); // 落在目标片段上方
            const changed = await (dragSort as unknown as {executeGroupedDragSort: (i: HTMLElement, s: HTMLElement) => Promise<boolean>}).executeGroupedDragSort(item, target);
            expect(changed).toBe(true);
            expect(store.groups[0].snippetIds).toEqual(["c1", "c2"]);
            expect(store.save).toHaveBeenCalledTimes(1);
            expect(plugin.menuView.initSnippetsContainer).toHaveBeenCalled();
        });

        it("拖到自己所在分组组头：无实际变更不落盘", async () => {
            const {dragSort, store, grpHeader, member} = buildGroupedEnv([{id: "g1", type: "css", name: "样式组", snippetIds: ["c1"]}]);
            const item = member("c1", document.querySelector(".jcsm-group-section[data-group-id=\"g1\"]") as HTMLElement);
            const changed = await (dragSort as unknown as {executeGroupedDragSort: (i: HTMLElement, s: HTMLElement) => Promise<boolean>}).executeGroupedDragSort(item, grpHeader);
            expect(changed).toBe(false);
            expect(store.save).not.toHaveBeenCalled();
        });

        it("组头拖到另一组头上方：组间排序（moveGroup 落盘）", async () => {
            const {dragSort, plugin, store, grpHeader} = buildGroupedEnv([
                {id: "g1", type: "css", name: "g1", snippetIds: []},
                {id: "g2", type: "css", name: "g2", snippetIds: []},
            ]);
            // 构造第二个真实组 g2 的区段与组头
            const g2Section = document.createElement("section");
            g2Section.className = "jcsm-group-section";
            g2Section.dataset.snippetType = "css";
            g2Section.dataset.groupId = "g2";
            const g2Header = document.createElement("div");
            g2Header.className = "jcsm-group-header";
            g2Header.dataset.groupId = "g2";
            g2Section.appendChild(g2Header);
            document.body.appendChild(g2Section);

            grpHeader.classList.add("dragover__top");
            const changed = await (dragSort as unknown as {executeGroupedDragSort: (i: HTMLElement, s: HTMLElement) => Promise<boolean>}).executeGroupedDragSort(g2Header, grpHeader);
            expect(changed).toBe(true);
            expect(store.groups.filter(g => g.type === "css").map(g => g.id)).toEqual(["g2", "g1"]);
            expect(store.save).toHaveBeenCalledTimes(1);
            expect(plugin.menuView.initSnippetsContainer).toHaveBeenCalled();
        });

        it("未分组占位头拖到分组上方：占位移到该组前（未分组参与组间排序）", async () => {
            // store 需含 default 占位组才能被移动（真实环境由 withUngroupedAnchors 补齐）
            const {dragSort, plugin, store, ungrpHeader, grpHeader} = buildGroupedEnv([
                {id: "g1", type: "css", name: "样式组", snippetIds: []},
                {id: "default", type: "css", name: "", snippetIds: []},
            ]);
            grpHeader.classList.add("dragover__top");
            const changed = await (dragSort as unknown as {executeGroupedDragSort: (i: HTMLElement, s: HTMLElement) => Promise<boolean>}).executeGroupedDragSort(ungrpHeader, grpHeader);
            expect(changed).toBe(true);
            expect(store.groups.filter(g => g.type === "css").map(g => g.id)).toEqual(["default", "g1"]);
            expect(store.save).toHaveBeenCalledTimes(1);
            expect(plugin.menuView.initSnippetsContainer).toHaveBeenCalled();
        });
    });
});
