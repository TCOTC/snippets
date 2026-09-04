// ui/menu-drag-sort.ts MenuDragSort 单测
// 覆盖：非 customSort 早退、非片段项早退、容器缺失早退、桌面鼠标拖拽成功（落库/广播/置位清理）、
//       拖拽回原位（move false）与自拉失败时不广播并延迟清理状态。
// 依赖 jsdom DOM（menuItems 容器 + 片段项）与 Constants mock；容器/项的 getBoundingClientRect 以桩固定。
// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type PluginSnippets from "../index";
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
        menuView: {menuItems: undefined as unknown as HTMLElement},
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
});
