// 顶栏菜单拖拽排序交互
// 职责：代码片段菜单项/分组头拖拽排序（桌面鼠标 + 移动端长按触摸）：幽灵元素跟随、容器边缘滚动、
// 落点高亮、排序执行（自拉最新列表 → Store 移动 / 分组归属调整 → DOM 顺序更新 → 落库 → 跨窗口广播）。
// 分组视图下既支持片段项拖拽（组内/跨组/移入移出未分组），也支持分组头拖拽（组间排序，
// “未分组”作为 id 固定为 default 的占位分组一起参与组序，见 domain/snippet-groups.ts）。
// 菜单列表容器经 plugin.menuView.menuItems 访问（拖拽只在菜单打开期间发生，menuItems 必然已就位）。
import {Constants} from "siyuan";
import type PluginSnippets from "../index";
import {
    assignSnippetToGroup,
    cloneGroups,
    isUngroupedGroup,
    moveGroup,
    moveSnippetWithinGroup,
    SnippetGroup,
    UNGROUPED_GROUP_ID,
    unassignSnippetFromGroup,
} from "../domain/snippet-groups";

/** 位移超过该值（像素）才视为拖拽开始 */
const DRAG_START_THRESHOLD_PX = 3;
/** 拖拽中原片段透明度 */
const DRAG_ITEM_OPACITY = "0.38";
/** 长按该时长（毫秒）后进入拖拽（移动端） */
const TOUCH_LONG_PRESS_MS = 500;
/** 拖拽结束后延迟清理状态标志的时长（毫秒） */
const DRAG_STATE_CLEANUP_MS = 50;
/** 拖拽落点高亮类选择器 */
const DRAGOVER_CLASS_SELECTOR = ".dragover__top, .dragover__bottom";

/**
 * 顶栏菜单拖拽排序交互
 * 拖拽状态（isDragging/dragCleanupTimer）为本类内部状态；菜单点击处理（SnippetsMenu.menuClickHandler）
 * 经本类的 isDragging/clearDragState 判断"拖拽回到原位后忽略点击"。
 */
export class MenuDragSort {
    private readonly plugin: PluginSnippets;

    /**
     * 拖拽状态标志位，用于防止拖拽回到原位后触发点击事件、防止移动端无法划动菜单列表（判断是否应该阻止默认行为）
     * （SnippetsMenu.menuClickHandler 读取，故公开）
     */
    isDragging = false;

    /**
     * 拖拽清理定时器，用于在拖拽结束后清理标志位
     */
    private dragCleanupTimer: number | null = null;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 清理拖拽状态，延迟清理以确保不会影响正常的点击操作
     * （SnippetsMenu.menuClickHandler 调用，故公开）
     */
    clearDragState() {
        // 清除之前的定时器
        if (this.dragCleanupTimer) {
            clearTimeout(this.dragCleanupTimer);
        }

        // 延迟 50ms 清理拖拽状态，确保点击事件已经处理完毕
        this.dragCleanupTimer = window.setTimeout(() => {
            this.isDragging = false;
            this.dragCleanupTimer = null;
        }, DRAG_STATE_CLEANUP_MS);
    }

    /**
     * 创建拖拽幽灵元素
     * @param item 原始拖拽项
     * @returns 幽灵元素
     */
    private createDragGhost(item: HTMLElement): HTMLElement {
        const itemRect = item.getBoundingClientRect();
        const ghostElement = item.cloneNode(true) as HTMLElement;
        ghostElement.setAttribute("id", "dragGhost");

        // 移除不需要的子元素，只保留名称元素（片段项 .jcsm-snippet-name 或组头 .jcsm-group-name）
        Array.from(ghostElement.children).forEach(child => {
            if (child instanceof HTMLElement && (child.classList.contains("jcsm-snippet-name") || child.classList.contains("jcsm-group-name"))) {
                // 确保名称子元素不会出现滚动条
                child.style.overflow = "hidden";
                child.style.textOverflow = "ellipsis";
            } else {
                // 移除其他子元素
                child.remove();
            }
        });

        ghostElement.setAttribute("style", `
            position: fixed;
            z-index: 999997;
            overflow: hidden;
            width: ${itemRect.width}px;
            height: ${itemRect.height}px;
            pointer-events: none;
        `);

        return ghostElement;
    }

    /**
     * 处理拖拽滚动
     * @param clientY 当前 Y 坐标
     * @param contentRect 容器矩形
     * @param dragContainer 拖拽容器
     */
    private handleDragScroll(clientY: number, contentRect: DOMRect, dragContainer: HTMLElement): void {
        if (clientY < contentRect.top + Constants.SIZE_SCROLL_TB || clientY > contentRect.bottom - Constants.SIZE_SCROLL_TB) {
            dragContainer.scroll({
                top: dragContainer.scrollTop + (clientY < contentRect.top + Constants.SIZE_SCROLL_TB ? -Constants.SIZE_SCROLL_STEP : Constants.SIZE_SCROLL_STEP),
                behavior: "smooth"
            });
        }
    }

    /**
     * 给目标元素叠加"落在此元素上/下半"的高亮（片段项与分组头复用）
     * @param selectItem 目标元素
     * @param clientY 当前 Y 坐标
     * @returns 目标元素
     */
    private applyTopBottomHighlight(selectItem: HTMLElement, clientY: number): HTMLElement {
        const selectRect = selectItem.getBoundingClientRect();
        const dragHeight = selectRect.height * 0.5;
        if (clientY > selectRect.bottom - dragHeight) {
            selectItem.classList.add("dragover__bottom");
        } else if (clientY < selectRect.top + dragHeight) {
            selectItem.classList.add("dragover__top");
        }
        return selectItem;
    }

    /**
     * 更新拖拽样式
     * @param moveEvent 移动事件
     * @param dragContainer 拖拽容器
     * @param item 原始拖拽项（片段项或组头）
     * @param contentRect 容器矩形
     * @returns 目标拖拽项
     */
    private updateDragStyles(moveEvent: MouseEvent | TouchEvent, dragContainer: HTMLElement, item: HTMLElement, contentRect: DOMRect): HTMLElement | null {
        // 清除所有拖拽样式
        this.clearDragStyles(dragContainer);

        // 获取当前坐标
        let clientX: number, clientY: number;
        if (moveEvent instanceof MouseEvent) {
            clientX = moveEvent.clientX;
            clientY = moveEvent.clientY;
        } else {
            const touch = moveEvent.touches[0];
            clientX = touch.clientX;
            clientY = touch.clientY;
        }

        // 检查是否在拖拽容器外
        if (clientY < contentRect.top || clientY > contentRect.bottom || clientX < contentRect.left || clientX > contentRect.right) {
            return null;
        }

        // 查找目标拖拽项
        let targetElement: Element | null;
        if (moveEvent instanceof MouseEvent) {
            targetElement = moveEvent.target as Element;
        } else {
            // 对于触摸事件，使用 elementFromPoint 查找元素
            targetElement = document.elementFromPoint(clientX, clientY);
        }

        const grouped = this.plugin.menuView.isGroupedView();
        const sourceIsHeader = item.classList.contains("jcsm-group-header");

        if (grouped && sourceIsHeader) {
            // 组头拖拽（组间排序）：目标必须是另一组头（真实组或未分组占位头），指示插在其上/下
            const targetHeader = targetElement?.closest(".jcsm-group-header") as HTMLElement | null;
            if (!targetHeader || targetHeader === item) {
                return null;
            }
            return this.applyTopBottomHighlight(targetHeader, clientY);
        }

        if (grouped) {
            // 片段拖拽：悬停组头/未分组头整行高亮，作为"移入该组/移入未分组"的目标
            const groupHeader = targetElement?.closest(".jcsm-group-header") as HTMLElement | null;
            if (groupHeader) {
                groupHeader.classList.add("dragover__group");
                return groupHeader;
            }
        }

        // 查找目标拖拽项（分组视图仅成员片段行可作为片段排序目标）
        const selectItem = (grouped
            ? targetElement?.closest(".jcsm-snippet-item[data-id]")
            : targetElement?.closest(".jcsm-snippet-item")) as HTMLElement;
        if (!selectItem || selectItem === item) {
            return null;
        }

        return this.applyTopBottomHighlight(selectItem, clientY);
    }

    /**
     * 执行拖拽排序逻辑（分组视图且拖拽涉及分组区段时走分组归属/组内排序，否则为平铺数组排序）
     * @param item 原始拖拽项
     * @param selectItem 目标拖拽项
     * @returns 是否真的发生了位置变化
     */
    private async executeDragSort(item: HTMLElement, selectItem: HTMLElement | null): Promise<boolean> {
        // 某类型尚无用户分组时该类型为平铺渲染（无分组区段），此时按平铺数组排序处理
        const inGroupSection = !!item.closest(".jcsm-group-section") || !!selectItem?.closest(".jcsm-group-section");
        if (this.plugin.menuView.isGroupedView() && inGroupSection) {
            return this.executeGroupedDragSort(item, selectItem);
        }

        const itemId = item.dataset.id;
        const itemType = item.dataset.type;
        if (!selectItem) return false;
        const selectItemId = selectItem.dataset.id;
        const selectItemType = selectItem.dataset.type;
        // classList.contains 恒返回 boolean，无需再判 undefined
        const isTop = selectItem.classList.contains("dragover__top");

        if (!itemId || !itemType || !selectItemId || !selectItemType || itemId === selectItemId) {
            return false;
        }

        // 获取最新代码片段列表（失败时中止排序，getSnippetsList 已弹错误提示）
        if (!(await this.plugin.snippetManager.refreshSnippetsList())) {
            return false;
        }

        // 从 Store 移动（含 CSS/JS 分区跨界修正），位置没有变化则不做后续 DOM 更新与广播
        const hasPositionChanged = this.plugin.snippetStore.move(itemId, selectItemId, isTop);
        if (!hasPositionChanged) {
            return false;
        }

        // 更新 DOM 顺序
        if (isTop) {
            selectItem.before(item);
        } else {
            selectItem.after(item);
        }

        // 保存新的排序顺序
        // 需要等 getSnippetsList() 调用的 API 执行完毕之后才推送更新，其他窗口需要用到代码片段的最新数据
        void await this.plugin.snippetManager.saveSnippetsList(this.plugin.snippetsList);

        // 广播排序到其他窗口
        this.plugin.syncService?.broadcast({type: "snippets_sort"});

        return true;
    }

    /**
     * 分组视图下的拖拽执行
     * - 拖拽源是分组头（含未分组占位头）→ 组间排序（moveGroup，未分组作为 default 占位一起参与）；
     * - 拖拽源是片段项 → 组内排序 / 跨组移入 / 拖到组头移入该组 / 拖到未分组移出组。
     * 归属只改分组映射文件（不改内核片段记录结构）；未分组内的数组序变动才触发片段列表落库与广播。
     * @param item 原始拖拽项（组头或片段项）
     * @param selectItem 目标拖拽项（组头或片段项）
     * @returns 是否真的发生了变更
     */
    private async executeGroupedDragSort(item: HTMLElement, selectItem: HTMLElement | null): Promise<boolean> {
        if (!selectItem || selectItem === item) return false;
        const isTop = selectItem.classList.contains("dragover__top");

        // 获取最新片段列表并对账分组缓存（孤儿 id 剔除）
        if (!(await this.plugin.snippetManager.refreshSnippetsList())) return false;
        await this.plugin.snippetGroupStore.load(this.plugin.snippetsList);
        const groups = cloneGroups(this.plugin.snippetGroupStore.groups);

        // 类型取自目标/源所在区段（组头与片段都在同类型区段内）
        const section = (item.closest(".jcsm-group-section") ?? selectItem.closest(".jcsm-group-section")) as HTMLElement;
        const snippetType = (section?.dataset.snippetType ?? "css") as "css" | "js";

        const sourceIsHeader = item.classList.contains("jcsm-group-header");
        if (sourceIsHeader) {
            return this.moveGroupByDrag(item, selectItem, snippetType, isTop, groups);
        }
        return this.moveSnippetInGrouped(item, selectItem, isTop, groups);
    }

    /**
     * 分组头拖拽排序（组间排序；真实分组与未分组占位都可作为源/目标）
     * @param item 组头源
     * @param selectItem 目标组头
     * @param snippetType 片段类型
     * @param isTop 是否插到目标上方
     * @param groups 已对账的分组缓存
     * @returns 是否真的发生了位置变化
     */
    private async moveGroupByDrag(item: HTMLElement, selectItem: HTMLElement, snippetType: "css" | "js", isTop: boolean, groups: SnippetGroup[]): Promise<boolean> {
        const groupId = item.dataset.groupId;
        const targetGroupId = selectItem.dataset.groupId;
        if (!groupId || !targetGroupId || groupId === targetGroupId) return false;

        const before = JSON.stringify(groups);
        const next = moveGroup(groups, snippetType, groupId, targetGroupId, isTop);
        if (JSON.stringify(next) === before) return false;

        this.plugin.snippetGroupStore.groups = next;
        await this.plugin.snippetGroupStore.save();
        this.plugin.menuView.initSnippetsContainer();
        return true;
    }

    /**
     * 片段项拖拽（组内排序 / 跨组移入 / 组头移入 / 未分组移出与排序）
     * @param item 片段行源
     * @param selectItem 目标（组头或片段行）
     * @param isTop 是否插到目标片段上方（片段行目标时）
     * @param groups 已对账的分组缓存
     * @returns 是否真的发生了变更
     */
    private async moveSnippetInGrouped(item: HTMLElement, selectItem: HTMLElement, isTop: boolean, groups: SnippetGroup[]): Promise<boolean> {
        const itemId = item.dataset.id;
        if (!itemId) return false;

        // 片段当前是否在某个真实分组中（未分组占位不算，恒空）
        const inRealGroup = groups.some(group => !isUngroupedGroup(group) && group.snippetIds.includes(itemId));

        // 目标为组头：真实组头 → 移入该组（追加组尾）；未分组头 → 移出所在组
        if (selectItem.classList.contains("jcsm-group-header")) {
            const targetGroupId = selectItem.dataset.groupId;
            if (targetGroupId === undefined) return false;
            let next = groups;
            if (targetGroupId === UNGROUPED_GROUP_ID) {
                if (!inRealGroup) return false; // 已在未分组，无变化
                next = unassignSnippetFromGroup(groups, itemId);
            } else {
                next = assignSnippetToGroup(groups, targetGroupId, itemId);
            }
            return this.commitGroupChange(next, groups);
        }

        // 目标为成员片段行：按其所在区段归属处理
        const targetSection = selectItem.closest(".jcsm-group-section") as HTMLElement;
        const targetMemberId = selectItem.dataset.id;
        if (!targetSection || !targetMemberId || targetMemberId === itemId) return false;
        const targetGroupId = targetSection.dataset.groupId;
        const targetIsRealGroup = !!targetGroupId && targetGroupId !== UNGROUPED_GROUP_ID;

        let next = groups;
        let arrayChanged = false;
        if (targetIsRealGroup) {
            // 目标在真实分组内：改归属（assign 自动从原组迁移）后按目标片段位置组内排序
            next = assignSnippetToGroup(groups, targetGroupId!, itemId);
            next = moveSnippetWithinGroup(next, targetGroupId!, itemId, targetMemberId, isTop);
            return this.commitGroupChange(next, groups);
        }

        // 目标在未分组区段内：先把片段移出真实组，再按目标片段调整全局数组序（未分组排序源）
        if (inRealGroup) {
            next = unassignSnippetFromGroup(groups, itemId);
        }
        arrayChanged = this.plugin.snippetStore.move(itemId, targetMemberId, isTop);
        if (arrayChanged) {
            void await this.plugin.snippetManager.saveSnippetsList(this.plugin.snippetsList);
            this.plugin.syncService?.broadcast({type: "snippets_sort"});
        }
        if (JSON.stringify(next) === JSON.stringify(groups) && !arrayChanged) {
            return false;
        }
        if (JSON.stringify(next) !== JSON.stringify(groups)) {
            this.plugin.snippetGroupStore.groups = next;
            await this.plugin.snippetGroupStore.save();
        }
        this.plugin.menuView.initSnippetsContainer();
        return true;
    }

    /**
     * 分组归属/组序变更后落盘并重建（与上一次快照相同则视为无变更）
     * @param next 变更后的分组集合
     * @param previous 变更前快照
     * @returns 是否发生了变更
     */
    private async commitGroupChange(next: SnippetGroup[], previous: SnippetGroup[]): Promise<boolean> {
        if (JSON.stringify(next) === JSON.stringify(previous)) {
            return false;
        }
        this.plugin.snippetGroupStore.groups = next;
        await this.plugin.snippetGroupStore.save();
        this.plugin.menuView.initSnippetsContainer();
        return true;
    }

    /**
     * 清除容器内全部拖拽落点高亮样式
     * @param dragContainer 拖拽容器
     */
    private clearDragStyles(dragContainer: HTMLElement): void {
        dragContainer.querySelectorAll(DRAGOVER_CLASS_SELECTOR).forEach(item => {
            item.classList.remove("dragover__top", "dragover__bottom");
        });
        dragContainer.querySelectorAll(".jcsm-group-header.dragover__group").forEach(item => {
            item.classList.remove("dragover__group");
        });
    }

    /**
     * 结束拖拽并执行排序（mouseup/touchend 共用收尾）
     */
    private async endDragAndSort(ghostElement: HTMLElement | undefined, item: HTMLElement, dragContainer: HTMLElement, selectItem: HTMLElement | null) {
        ghostElement?.remove();
        item.style.opacity = "";

        if (!selectItem) {
            selectItem = dragContainer.querySelector(DRAGOVER_CLASS_SELECTOR);
        }

        // 执行拖拽排序
        const hasPositionChanged = await this.executeDragSort(item, selectItem);

        // 如果拖拽回到原位，保持拖拽状态并延迟清理，阻止随后的点击事件；否则立即清除
        if (!hasPositionChanged) {
            this.clearDragState();
        } else {
            this.isDragging = false;
        }

        this.clearDragStyles(dragContainer);
    }

    /**
     * 菜单鼠标按下事件处理（用于桌面端拖拽排序，由菜单 open 绑定）
     * @param event 鼠标事件
     */
    handleMenuMousedown(event: MouseEvent) {
        if (this.plugin.config.snippetSortType !== "customSort") {
            return;
        }

        const target = event.target as HTMLElement;
        const grouped = this.plugin.menuView.isGroupedView();
        // 分组视图下组头（含未分组占位头）也可作为拖拽源（组间排序）；片段项仍为成员行
        const item = grouped
            ? ((target.closest(".jcsm-group-header") ?? target.closest(".jcsm-snippet-item[data-id]")) as HTMLElement | null)
            : (target.closest(".jcsm-snippet-item") as HTMLElement | null);
        if (!item) {
            return;
        }

        this.isDragging = false;

        const documentSelf = document;
        documentSelf.ondragstart = () => false;
        let ghostElement: HTMLElement;
        let selectItem: HTMLElement | null = null;

        // 获取拖拽容器（代码片段列表容器）
        const dragContainer = this.plugin.menuView.menuItems.querySelector(".jcsm-snippets-container") as HTMLElement;
        if (!dragContainer) {
            return;
        }

        const contentRect = dragContainer.getBoundingClientRect();

        documentSelf.onmousemove = (moveEvent: MouseEvent) => {
            if (Math.abs(moveEvent.clientY - event.clientY) < DRAG_START_THRESHOLD_PX && Math.abs(moveEvent.clientX - event.clientX) < DRAG_START_THRESHOLD_PX) {
                // 移动距离小于阈值时，不进行拖拽
                return;
            }

            moveEvent.preventDefault();
            moveEvent.stopPropagation();

            // 标记开始拖拽
            this.isDragging = true;

            if (!ghostElement) {
                item.style.opacity = DRAG_ITEM_OPACITY;
                ghostElement = this.createDragGhost(item);
                document.body.appendChild(ghostElement);
            }

            // 更新幽灵元素位置
            ghostElement.style.top = moveEvent.clientY + "px";
            ghostElement.style.left = moveEvent.clientX + "px";

            // 处理拖拽滚动
            this.handleDragScroll(moveEvent.clientY, contentRect, dragContainer);

            // 更新拖拽样式并获取目标项
            selectItem = this.updateDragStyles(moveEvent, dragContainer, item, contentRect);
        };

        documentSelf.onmouseup = async () => {
            documentSelf.onmousemove = null;
            documentSelf.onmouseup = null;
            documentSelf.ondragstart = null;

            await this.endDragAndSort(ghostElement, item, dragContainer, selectItem);
        };
    }

    /**
     * 菜单触摸开始事件处理（用于移动端拖拽排序，由菜单 open 绑定）
     * @param event 触摸事件
     */
    handleMenuTouchstart(event: TouchEvent) {
        if (this.plugin.config.snippetSortType !== "customSort") {
            return;
        }

        const target = event.target as HTMLElement;
        const grouped = this.plugin.menuView.isGroupedView();
        // 分组视图下组头（含未分组占位头）也可作为拖拽源（组间排序）；片段项仍为成员行
        const item = grouped
            ? ((target.closest(".jcsm-group-header") ?? target.closest(".jcsm-snippet-item[data-id]")) as HTMLElement | null)
            : (target.closest(".jcsm-snippet-item") as HTMLElement | null);
        if (!item) {
            return;
        }

        this.isDragging = false;

        // 触摸开始时不阻止默认行为，只有在开始拖拽时才阻止

        const documentSelf = document;
        let ghostElement: HTMLElement;
        let selectItem: HTMLElement | null = null;
        let startTouch: Touch;
        let longPressTimer: number;
        let hasMoved = false;

        // 获取拖拽容器（代码片段列表容器）
        const dragContainer = this.plugin.menuView.menuItems.querySelector(".jcsm-snippets-container") as HTMLElement;
        if (!dragContainer) {
            return;
        }

        const contentRect = dragContainer.getBoundingClientRect();

        // 触摸开始
        if (event.touches.length === 1) {
            startTouch = event.touches[0];
        } else {
            return;
        }

        // 长按定时器，500ms 后开始拖拽
        longPressTimer = window.setTimeout(() => {
            if (!hasMoved) {
                this.isDragging = true; // 标记开始拖拽
                ghostElement = this.createDragGhost(item);
                document.body.appendChild(ghostElement);
                // 设置幽灵元素初始位置为当前触摸位置
                ghostElement.style.top = startTouch.clientY + "px";
                ghostElement.style.left = startTouch.clientX + "px";
                item.style.opacity = DRAG_ITEM_OPACITY;
            }
        }, TOUCH_LONG_PRESS_MS);

        // 触摸移动事件
        const touchmoveHandler = (moveEvent: TouchEvent) => {
            if (moveEvent.touches.length !== 1) return;

            const currentTouch = moveEvent.touches[0];
            const deltaX = Math.abs(currentTouch.clientX - startTouch.clientX);
            const deltaY = Math.abs(currentTouch.clientY - startTouch.clientY);

            // 如果已经移动了，标记为已移动状态
            if (deltaX > DRAG_START_THRESHOLD_PX || deltaY > DRAG_START_THRESHOLD_PX) {
                hasMoved = true;
                // 如果已经移动了，清除长按定时器，不进行拖拽
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = 0;
                }
                // 如果还没开始拖拽，允许正常滚动
                if (!this.isDragging) {
                    return;
                }
            }

            // 只有在拖拽状态下才阻止默认行为
            if (this.isDragging) {
                moveEvent.preventDefault();

                // 更新幽灵元素位置
                ghostElement.style.top = currentTouch.clientY + "px";
                ghostElement.style.left = currentTouch.clientX + "px";

                // 处理拖拽滚动
                this.handleDragScroll(currentTouch.clientY, contentRect, dragContainer);

                // 更新拖拽样式并获取目标项
                selectItem = this.updateDragStyles(moveEvent, dragContainer, item, contentRect);
            }
        };

        // 触摸结束事件
        const touchendHandler = async (endEvent: TouchEvent) => {
            // 清除长按定时器
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = 0;
            }

            // 移除触摸事件监听
            documentSelf.removeEventListener("touchmove", touchmoveHandler);
            documentSelf.removeEventListener("touchend", touchendHandler);

            // 只有在拖拽状态下才阻止默认行为
            if (this.isDragging) {
                endEvent.preventDefault();
                await this.endDragAndSort(ghostElement, item, dragContainer, selectItem);
            }
        };

        // 添加触摸事件监听
        documentSelf.addEventListener("touchmove", touchmoveHandler, { passive: false });
        documentSelf.addEventListener("touchend", touchendHandler, { passive: false });
    }
}
