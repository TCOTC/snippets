// 顶栏菜单拖拽排序交互（原 src/ui/menu.ts SnippetsMenu 拖拽组外迁，行为等价）
// 职责：代码片段菜单项拖拽排序（桌面鼠标 + 移动端长按触摸）：幽灵元素跟随、容器边缘滚动、落点高亮、
// 排序执行（自拉最新列表 → Store 移动 → DOM 顺序更新 → 落库 → 跨窗口广播）。
// 简洁化：不设 Host——直接持有 PluginSnippets 实例（import type 避免运行时循环依赖），
// 菜单列表容器经 plugin.menuView.menuItems 访问（拖拽只在菜单打开期间发生，menuItems 必然已就位）。
import {Constants} from "siyuan";
import type PluginSnippets from "../index";

/**
 * 顶栏菜单拖拽排序交互（原 SnippetsMenu 拖拽组外迁，行为等价）
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
        }, 50);
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

        // 移除不需要的子元素，只保留 .jcsm-snippet-name
        Array.from(ghostElement.children).forEach(child => {
            if (child instanceof HTMLElement && child.classList.contains("jcsm-snippet-name")) {
                // 确保 .jcsm-snippet-name 子元素不会出现滚动条
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
     * 更新拖拽样式
     * @param moveEvent 移动事件
     * @param dragContainer 拖拽容器
     * @param item 原始拖拽项
     * @param contentRect 容器矩形
     * @returns 目标拖拽项
     */
    private updateDragStyles(moveEvent: MouseEvent | TouchEvent, dragContainer: HTMLElement, item: HTMLElement, contentRect: DOMRect): HTMLElement | null {
        // 清除所有拖拽样式
        dragContainer.querySelectorAll(".dragover__top, .dragover__bottom").forEach(item => {
            item.classList.remove("dragover__top", "dragover__bottom");
        });

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

        const selectItem = targetElement?.closest(".jcsm-snippet-item") as HTMLElement;
        if (!selectItem || selectItem === item) {
            return null;
        }

        // 添加拖拽样式
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
     * 执行拖拽排序逻辑
     * @param item 原始拖拽项
     * @param selectItem 目标拖拽项
     * @returns 是否真的发生了位置变化
     */
    private async executeDragSort(item: HTMLElement, selectItem: HTMLElement | null): Promise<boolean> {
        const itemId = item.dataset.id;
        const itemType = item.dataset.type;
        if (!selectItem) return false;
        const selectItemId = selectItem.dataset.id;
        const selectItemType = selectItem.dataset.type;
        const isTop = selectItem.classList.contains("dragover__top");
        if (isTop === undefined) return false;

        if (!itemId || !itemType || !selectItemId || !selectItemType || itemId === selectItemId) {
            return false;
        }

        // 获取最新代码片段列表
        const snippetsList = await this.plugin.snippetManager.getSnippetsList();
        if (snippetsList) {
            this.plugin.snippetsList = snippetsList;
        } else {
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
     * 菜单鼠标按下事件处理（用于桌面端拖拽排序；原 SnippetsMenu.menuMousedownHandler 外迁，由菜单 open 绑定）
     * @param event 鼠标事件
     */
    handleMenuMousedown(event: MouseEvent) {
        if (this.plugin.snippetSortType !== "customSort") {
            return;
        }

        const target = event.target as HTMLElement;
        const item = target.closest(".jcsm-snippet-item") as HTMLElement;
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
            if (Math.abs(moveEvent.clientY - event.clientY) < 3 && Math.abs(moveEvent.clientX - event.clientX) < 3) {
                // 移动距离小于 3px 时，不进行拖拽
                return;
            }

            moveEvent.preventDefault();
            moveEvent.stopPropagation();

            // 标记开始拖拽
            this.isDragging = true;

            if (!ghostElement) {
                item.style.opacity = "0.38";
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
            documentSelf.onselectstart = null;
            documentSelf.onselect = null;

            ghostElement?.remove();
            item.style.opacity = "";

            if (!selectItem) {
                selectItem = dragContainer.querySelector(".dragover__top, .dragover__bottom");
            }

            // 执行拖拽排序
            const hasPositionChanged = await this.executeDragSort(item, selectItem);

            // 如果拖拽回到原位，设置标志位阻止点击事件
            if (this.isDragging && !hasPositionChanged) {
                // 保持拖拽状态，阻止点击事件，延迟清理
                this.clearDragState();
            } else {
                this.isDragging = false; // 立即清除拖拽状态
            }

            // 清除所有拖拽样式
            dragContainer.querySelectorAll(".dragover__top, .dragover__bottom").forEach(item => {
                item.classList.remove("dragover__top", "dragover__bottom");
            });
        };
    }

    /**
     * 菜单触摸开始事件处理（用于移动端拖拽排序；原 SnippetsMenu.menuTouchstartHandler 外迁，由菜单 open 绑定）
     * @param event 触摸事件
     */
    handleMenuTouchstart(event: TouchEvent) {
        if (this.plugin.snippetSortType !== "customSort") {
            return;
        }

        const target = event.target as HTMLElement;
        const item = target.closest(".jcsm-snippet-item") as HTMLElement;
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
                item.style.opacity = "0.38";
            }
        }, 500);

        // 触摸移动事件
        const touchmoveHandler = (moveEvent: TouchEvent) => {
            if (moveEvent.touches.length !== 1) return;

            const currentTouch = moveEvent.touches[0];
            const deltaX = Math.abs(currentTouch.clientX - startTouch.clientX);
            const deltaY = Math.abs(currentTouch.clientY - startTouch.clientY);

            // 如果已经移动了，标记为已移动状态
            if (deltaX > 3 || deltaY > 3) {
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

                // 清理拖拽状态
                ghostElement?.remove();
                item.style.opacity = "";

                if (!selectItem) {
                    selectItem = dragContainer.querySelector(".dragover__top, .dragover__bottom");
                }

                // 执行拖拽排序
                const hasPositionChanged = await this.executeDragSort(item, selectItem);

                // 如果拖拽回到原位，设置标志位阻止点击事件
                if (!hasPositionChanged) {
                    // 保持拖拽状态，阻止点击事件，延迟清理
                    this.clearDragState();
                } else {
                    this.isDragging = false; // 立即清除拖拽状态
                }

                // 清除所有拖拽样式
                dragContainer.querySelectorAll(".dragover__top, .dragover__bottom").forEach(item => {
                    item.classList.remove("dragover__top", "dragover__bottom");
                });
            }
        };

        // 添加触摸事件监听
        documentSelf.addEventListener("touchmove", touchmoveHandler, { passive: false });
        documentSelf.addEventListener("touchend", touchendHandler, { passive: false });
    }
}
