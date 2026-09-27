// 顶栏菜单 UI
// 职责：代码片段管理器顶栏按钮的创建与点击打开、菜单的打开/绘制/事件委托（含键盘）、CSS/JS 切换、搜索、呼吸动画、
// 菜单项生成与计数/选中/编辑按钮高亮、菜单位置、关闭回调（含自动重载界面联动）、拖拽排序（见 menu-drag-sort.ts）、
// 以及菜单 + 对话框的全局键盘协调（Esc/Enter/方向键按 zIndex 与开合状态分发）。
import {Menu, platformUtils} from "siyuan";
import {escapeHtml, genSnippetSwitchHtml, getDialogKeyHandler, hideTooltip, htmlToElement, isInputElementActive, moveElementToTop, PLUGIN_NAME, showElementTooltip, SNIPPET_DIALOG_SELECTOR} from "../utils";
import {filterSnippetsByKeyword, isSnippetsTypeEnabled, snippetTitle, sortSnippets} from "../domain/snippet";
import {
    addGroup,
    cloneGroups,
    findGroup,
    genNewGroupId,
    isUngroupedGroup,
    removeGroup,
    renameGroup,
    SnippetGroup,
    UNGROUPED_GROUP_ID,
    ungroupedSnippetIds,
    withUngroupedAnchors,
} from "../domain/snippet-groups";
import {MenuDragSort} from "./menu-drag-sort";
import type PluginSnippets from "../index";
import type {Snippet, SnippetType} from "../types";

/** 菜单当前选中项类名（方向键/回车定位用） */
const CURRENT_ITEM_CLASS = "b3-menu__item--current";

/** 滚动定位菜单项到可视区的最大重试次数（布局未稳定/分组刚展开时逐帧重试，防止停在可视区外） */
const SCROLL_TO_VISIBLE_MAX_RETRY = 8;

/**
 * 顶栏菜单管理器
 * 菜单状态（menu/menuItems/呼吸标志）为本类内部状态，拖拽交互与拖拽状态见 MenuDragSort（src/ui/menu-drag-sort.ts）；
 * 展示配置（snippetSearchType/snippetSortType/snippetOptionClickBehavior/show* 等）收敛在插件 config 对象
 * （src/config/config.ts），经 plugin.config 类型化读取；业务动作调用 plugin.snippetManager/plugin.snippetsDialog 等模块方法。
 */
export class SnippetsMenu {
    private readonly plugin: PluginSnippets;

    /**
     * 拖拽排序交互（桌面鼠标 + 移动端长按触摸，实现见 src/ui/menu-drag-sort.ts）
     */
    private readonly dragSort: MenuDragSort;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
        this.dragSort = new MenuDragSort(this.plugin);
    }

    /**
     * 顶栏菜单对象（关闭后为 undefined；打开期间的调用点均先经 new Menu 赋值或守卫）
     */
    menu: Menu | undefined;

    /**
     * 菜单列表容器 #commonMenu > .b3-menu__items
     */
    menuItems!: HTMLElement;

    /**
     * 顶栏按钮元素（原插件实例字段迁入本类——仅菜单模块创建/读取/移除，属菜单专属 DOM）
     */
    private topBarElement!: HTMLElement;

    /**
     * 是否为触摸设备（原插件实例字段迁入本类——仅本类 genMenuSnippetsItems 使用，
     * 构造时按设备能力一次性检测即可，无需经插件实例共享）
     */
    private readonly isTouchDevice = ("ontouchstart" in window) && navigator.maxTouchPoints > 1;

    /**
     * 移除顶栏按钮（schema onApply（topBarPosition 变更）使用；与 initTopBar 配合用于重建，如顶栏位置变更）
     */
    removeTopBarElement() {
        this.topBarElement?.remove();
    }

    /**
     * 关闭菜单（供插件生命周期等在需要时主动关闭；Menu 关闭会触发关闭回调）
     */
    close() {
        this.menu?.close();
    }

    /**
     * 注册顶栏按钮图标 symbol
     * iconJcsm 供顶栏按钮与设置项按钮引用（svg use），注册一次即可，须先于 initTopBar 调用。
     */
    initIcons() {
        this.plugin.addIcons(`
            <symbol id="iconJcsm" viewBox="0 0 32 32">
                <path d="M23.498 9.332c-0.256 0.256-0.415 0.611-0.415 1.002s0.159 0.745 0.415 1.002l4.665 4.665-4.665 4.665c-0.256 0.256-0.415 0.61-0.415 1.002s0.159 0.745 0.415 1.002v0c0.256 0.256 0.61 0.415 1.002 0.415s0.745-0.159 1.002-0.415l5.667-5.667c0.256-0.256 0.415-0.611 0.415-1.002s-0.158-0.745-0.415-1.002l-5.667-5.667c-0.256-0.256-0.61-0.415-1.002-0.415s-0.745 0.159-1.002 0.415v0z"></path>
                <path d="M7.5 8.917c-0.391 0-0.745 0.159-1.002 0.415l-5.667 5.667c-0.256 0.256-0.415 0.611-0.415 1.002s0.158 0.745 0.415 1.002l5.667 5.667c0.256 0.256 0.611 0.415 1.002 0.415s0.745-0.159 1.002-0.415v0c0.256-0.256 0.415-0.61 0.415-1.002s-0.159-0.745-0.415-1.002l-4.665-4.665 4.665-4.665c0.256-0.256 0.415-0.611 0.415-1.002s-0.159-0.745-0.415-1.002v0c-0.256-0.256-0.61-0.415-1.002-0.415v0z"></path>
                <path d="M19.965 3.314c-0.127-0.041-0.273-0.065-0.424-0.065-0.632 0-1.167 0.413-1.35 0.985l-0.003 0.010-7.083 22.667c-0.041 0.127-0.065 0.273-0.065 0.424 0 0.632 0.413 1.167 0.985 1.35l0.010 0.003c0.127 0.041 0.273 0.065 0.424 0.065 0.632 0 1.167-0.413 1.35-0.985l0.003-0.010 7.083-22.667c0.041-0.127 0.065-0.273 0.065-0.424 0-0.632-0.413-1.167-0.985-1.35l-0.010-0.003z"></path>
            </symbol>
        `);
    }

    /**
     * 通过命令名称获取用户自定义快捷键
     * @param command 命令名称
     * @returns 用户自定义快捷键
     */
    private getCustomKeymapByCommand(command: string): string {
        return window.siyuan.config.keymap.plugin?.[PLUGIN_NAME]?.[command]?.custom || "";
    }

    /**
     * 初始化顶栏按钮
     * 顶栏按钮即菜单入口：schema onApply（topBarPosition 变更）/生命周期装配均调用本方法。
     */
    async initTopBar() {
        const title = this.buildTitle(this.plugin.displayName, "openSnippetsManager");
        this.topBarElement = this.plugin.addTopBar({
            icon: "iconJcsm",
            title: title,
            position: this.plugin.config.topBarPosition || "right",
            callback: () => {
                this.openSnippetsManager();
            }
        });
    }

    /**
     * 拼接带快捷键提示的标题（桌面端命令配置了快捷键时附加快捷键；移动端不显示）
     * @param base 基础文案
     * @param command 命令 langKey（用于查询用户自定义快捷键）
     * @returns 完整标题
     */
    private buildTitle(base: string, command: string): string {
        const keymap = this.getCustomKeymapByCommand(command);
        return !this.plugin.isMobile && keymap ? base + " " + platformUtils.updateHotkeyTip(keymap) : base;
    }

    /**
     * 顶栏按钮点击/命令回调：打开代码片段管理器
     * 快捷键唤起菜单时，如果菜单已经打开，要先关闭再重新打开，所以直接执行就好，会自动关闭菜单再重开。
     */
    async openSnippetsManager() {
        if (this.plugin.snippetsDialog.getAllModalElements().length > 0) return;
        await this.open();
    }

    /**
     * 打开顶栏菜单
     */
    async open() {
        const menu = new Menu("PluginSnippets", () => {
            // 此处会在菜单被关闭（this.menu.close();）时执行
            this.closeMenuCallback();
        });
        this.menu = menu;

        // 如果菜单已存在，再次点击按钮就会移除菜单，此时直接返回
        if (menu.isOpen) {
            this.menu = undefined;
            if (!this.plugin.isMobile && this.topBarElement && this.topBarElement.matches(":hover")) {
                // 只有当鼠标悬停在顶栏按钮上时才显示 tooltip
                showElementTooltip(this.topBarElement);
            }
            return;
        }

        // 并发获取代码片段列表与视图偏好（折叠状态/上次类型）：
        // 片段列表失败时关闭菜单（getSnippetsList 已弹错误提示）；视图偏好读取失败不阻断
        this.plugin.console.log("openMenu: 获取代码片段列表");
        const refreshPromise = this.plugin.snippetManager.refreshSnippetsList();
        const uiStatePromise = this.plugin.uiStorage?.load().catch(() => undefined) ?? Promise.resolve(undefined);
        const [refreshed] = await Promise.all([refreshPromise, uiStatePromise]);
        if (!refreshed) {
            menu.close();
            this.menu = undefined;
            return;
        }

        // 存储中有上次切换的类型则覆盖当前类型（无记录时用配置默认 defaultSnippetsType）
        const storedType = this.plugin.uiStorage?.snippetsType;
        if (storedType === "css" || storedType === "js") {
            this.plugin.snippetsType = storedType;
        }

        // 以权威片段列表对账分组缓存（孤儿 id 剔除，见 domain/snippet-groups.ts reconcileGroups）
        await this.plugin.snippetGroupStore.load(this.plugin.snippetsList);

        // 插入菜单顶部
        this.menuItems = menu.element.querySelector(".b3-menu__items")!;
        const menuTop = document.createElement("div");
        menuTop.className = "jcsm-top-container fn__flex";
        // 选项卡的实现参考：https://codepen.io/havardob/pen/ExVaELV
        menuTop.innerHTML = `
<div class="jcsm-tabs">
    <input type="radio" id="jcsm-radio-css" data-snippet-type="css" name="jcsm-tabs"/>
    <label class="jcsm-tab" for="jcsm-radio-css">
        <span class="jcsm-tab-text">CSS</span>
        <span class="jcsm-tab-count jcsm-tab-count-css">0</span>
    </label>
    <input type="radio" id="jcsm-radio-js" data-snippet-type="js" name="jcsm-tabs"/>
    <label class="jcsm-tab" for="jcsm-radio-js">
        <span class="jcsm-tab-text" style="padding-left: .2em;">JS</span>
        <span class="jcsm-tab-count jcsm-tab-count-js">0</span>
    </label>
    <span class="jcsm-glider"></span>
</div>
<span class="fn__flex-1"></span>
<button class="block__icon block__icon--show fn__flex-center ariaLabel${this.plugin.config.snippetSearchType === 0 ? " fn__none" : ""}" data-type="search" data-position="north" aria-label="${this.plugin.i18n.search}"><svg><use xlink:href="#iconSearch"></use></svg></button>
<button class="block__icon block__icon--show fn__flex-center ariaLabel" data-type="config" data-position="north"><svg><use xlink:href="#iconSettings"></use></svg></button>
<button class="block__icon block__icon--show fn__flex-center ariaLabel${this.plugin.isReloadUIRequired ? " jcsm-breathing" : ""}" data-type="reload" data-position="north"><svg><use xlink:href="#iconRefresh"></use></svg></button>
<button class="block__icon block__icon--show fn__flex-center ariaLabel" data-type="group" data-position="north"><svg><use xlink:href="#iconGroups"></use></svg></button>
<button class="block__icon block__icon--show fn__flex-center ariaLabel" data-type="new" data-position="north"><svg><use xlink:href="#iconAdd"></use></svg></button>
<span class="fn__space"></span>
<input class="jcsm-switch jcsm-all-snippets-switch b3-switch fn__flex-center" type="checkbox">
        `;

        // TODO功能: 加一个全局的 publishSwitch 开关，批量修改代码片段的 disabledInPublish 字段

        const radio = menuTop.querySelector(`[data-snippet-type="${this.plugin.snippetsType}"]`) as HTMLInputElement;
        radio.checked = true;
        const settingsButton = menuTop.querySelector("button[data-type='config']") as HTMLButtonElement;
        settingsButton.setAttribute("aria-label", this.plugin.i18n.pluginConfig);
        const newSnippetButton = menuTop.querySelector("button[data-type='new']") as HTMLButtonElement;
        newSnippetButton.setAttribute("aria-label", this.plugin.i18n.add + " " + this.plugin.snippetsType.toUpperCase());
        const groupButton = menuTop.querySelector("button[data-type='group']") as HTMLButtonElement;
        groupButton.setAttribute("aria-label", this.plugin.i18n.groupNew);
        const reloadUIButton = menuTop.querySelector("button[data-type='reload']") as HTMLButtonElement;
        reloadUIButton.setAttribute("aria-label", this.buildTitle(this.plugin.i18n.reloadUI, "reloadUI"));

        this.menuItems.append(menuTop);

        // 插入搜索输入框
        const searchInputHtml = '<input class="jcsm-snippets-search b3-text-field fn__none" data-action="search" type="text">';
        this.menuItems.insertAdjacentHTML("beforeend", searchInputHtml);

        // 初始化代码片段列表容器
        this.initSnippetsContainer();

        this.setMenuSnippetCount();
        this.setMenuSnippetsType(this.plugin.snippetsType);
        this.setAllSnippetsEditButtonActive();

        // 事件监听
        this.plugin.addListener(menu.element, "click", this.menuClickHandler);
        this.plugin.addListener(menu.element, "mousedown", () => {
            // 点击菜单时要显示在最上层
            moveElementToTop(menu.element);
        });
        this.plugin.addListener(menu.element, "input", (event: InputEvent) => {
            const target = event.target as HTMLInputElement;
            if (target.tagName.toLowerCase() === "input" && target.dataset.action === "search") {
                // 筛选代码片段（过滤逻辑见 domain/snippet.ts filterSnippetsByKeyword）
                const filterSnippetsIds = filterSnippetsByKeyword(this.plugin.snippetsList, this.plugin.config.snippetSearchType, target.value);
                const snippetItems = this.menuItems.querySelectorAll(".jcsm-snippet-item");
                if (filterSnippetsIds) {
                    // 仅显示命中的片段
                    snippetItems.forEach((item: HTMLElement) => {
                        item.classList.toggle("fn__none", !filterSnippetsIds.includes(item.dataset.id!));
                    });
                } else {
                    // 禁用搜索或关键字为空时显示全部
                    snippetItems.forEach((item: HTMLElement) => {
                        item.classList.remove("fn__none");
                    });
                }

                if (!this.plugin.isMobile) {
                    // 设置当前选中项
                    this.setMenuSelection(this.plugin.snippetsType);
                }
            }
        });
        this.plugin.addListener(document.documentElement, "keydown", this.globalKeyDownHandler);
        // 添加鼠标事件监听（用于桌面端拖拽排序；拖拽交互实现见 src/ui/menu-drag-sort.ts MenuDragSort）
        this.plugin.addListener(menu.element, "mousedown", (event: MouseEvent) => {
            this.dragSort.handleMenuMousedown(event);
        });
        // 添加触摸事件监听（用于移动端拖拽排序）
        this.plugin.addListener(menu.element, "touchstart", (event: TouchEvent) => {
            this.dragSort.handleMenuTouchstart(event);
        }, { passive: true });

        // 弹出菜单
        if (this.plugin.isMobile) {
            menu.fullscreen();
        } else {
            this.setMenuPosition();
        }
    }

    /**
     * 初始化代码片段列表容器（供跨窗口排序同步/分组变更/配置热应用时重渲染菜单项列表，
     * 需在菜单已打开且有 menuItems 时调用；开启分组视图时按分组折叠树渲染，否则平铺渲染）
     */
    initSnippetsContainer() {
        const grouped = this.isGroupedView();
        // 插入代码片段列表容器
        const snippetsContainer = document.createElement("div");
        snippetsContainer.className = "jcsm-snippets-container" + (grouped ? " jcsm-grouped" : "");
        snippetsContainer.insertAdjacentHTML("beforeend", grouped ? this.genGroupedMenuHtml() : this.genMenuSnippetsItems());
        this.menuItems.querySelector(".jcsm-snippets-container")?.remove();
        this.menuItems.append(snippetsContainer);

        // 分组视图下片段被包进各自的组区段（.jcsm-group-items），不再是这两个按钮的兄弟节点，
        // 原有 CSS（同类型片段兄弟节点出现后隐藏按钮）不再生效，因此仅在某类型确实没有任何片段
        // 时才追加“添加第一个…”空态入口；平铺模式沿用旧逻辑（恒追加、由 CSS 按兄弟关系隐藏）
        if (!grouped || !this.plugin.snippetsList.some(snippet => snippet.type === "css")) {
            // “添加第一个 CSS 代码片段”的菜单项
            const newCssSnippetButton = htmlToElement(`<div class="jcsm-snippet-item b3-menu__item" data-type="new" data-snippet-type="css">${this.plugin.i18n.addFirstCSSSnippet}</div>`);
            snippetsContainer.appendChild(newCssSnippetButton);
        }
        if (!grouped || !this.plugin.snippetsList.some(snippet => snippet.type === "js")) {
            // “添加第一个 JS 代码片段”的菜单项
            const newJsSnippetButton = htmlToElement(`<div class="jcsm-snippet-item b3-menu__item" data-type="new" data-snippet-type="js">${this.plugin.i18n.addFirstJSSnippet}</div>`);
            snippetsContainer.appendChild(newJsSnippetButton);
        }
    }

    /**
     * 外部数据变更（内核 storage 推送 / 跨设备同步）后刷新已打开菜单。
     * 只要菜单项容器存在就重建，**不以 isGroupedView() 为门槛**：
     * 删除最后一个真实分组后 isGroupedView() 变为 false，若据此跳过重建会残留已分组的旧界面，
     * 导致其他前端实例看不到分组删除。initSnippetsContainer 内部会自行选择分组/平铺渲染。
     */
    refreshSnippetsContainerAfterExternalChange() {
        if (!this.menuItems) return;
        this.initSnippetsContainer();
    }

    /**
     * 设置菜单位置
     * @param isUpdate 是否仅更新菜单位置
     */
    setMenuPosition(isUpdate = false) {
        this.plugin.console.log("setMenuPosition: isUpdate =", isUpdate);
        const menu = this.menu;
        if (!menu) return;

        let rect = this.topBarElement.getBoundingClientRect();
        // 如果被隐藏，则使用更多按钮
        if (rect.width === 0) {
            rect = document.querySelector("#barMore")!.getBoundingClientRect();
        }
        if (rect.width === 0) {
            rect = document.querySelector("#barPlugins")!.getBoundingClientRect();
        }

        // this.topBarPosition 不存在的时候就默认为 right
        const dock = this.plugin.config.topBarPosition === "left" ? document.querySelector("#dockLeft") : document.querySelector("#dockRight");
        const dockRect = dock?.getBoundingClientRect();
        const dockWidth = ((dockRect?.width || 0) + 1).toString() + "px";

        if (!isUpdate) {
            menu.open({
                x: rect.right,
                y: rect.bottom + 1,
                isLeft: false,
            });
        }
        // 不要用鼠标位置、菜单要固定宽度，否则切换 CSS 和 JS 时，菜单可能会大幅抖动或者超出窗口边界
        menu.element.style.width = "min(400px, 90vw)";
        if (this.plugin.config.topBarPosition === "left") {
            menu.element.style.right = "";
            menu.element.style.left = dockWidth;
        } else {
            menu.element.style.right = dockWidth;
            menu.element.style.left = "";
        }

        // 顶栏按钮样式
        if (!this.plugin.isMobile && this.topBarElement) {
            this.topBarElement.classList.add("toolbar__item--active");
            // 移除 aria-label 属性，在菜单打开时不显示 tooltip
            this.topBarElement.removeAttribute("aria-label");
            hideTooltip();
        }
    }

    /**
     * 关闭顶栏菜单回调
     */
    private closeMenuCallback() {
        if (this.topBarElement) {
            // topBarElement 不存在时说明 isMobile 为 true，此时不需要修改顶栏按钮样式
            this.topBarElement.classList.remove("toolbar__item--active");
            // topBarCommand 有可能变，所以每次都重新获取
            this.topBarElement.setAttribute("aria-label", this.buildTitle(this.plugin.displayName, "openSnippetsManager"));
        }

        // 移除事件监听
        if (this.menu) {
            this.plugin.removeListener(this.menu.element);
            this.menu = undefined;
        }
        this.destroyGlobalKeyDownHandler();

        // 自动重新加载界面（无打开的编辑对话框时才重载，判断见 EditorManager.maybeAutoReloadUI）
        this.plugin.editorManager.maybeAutoReloadUI();
    }

    /**
     * 从菜单项向上查找最近的实际滚动容器（.jcsm-snippets-container 与它的祖先
     * .b3-menu__items 都声明了 overflow:auto，真正承接滚动的是被限高那一层；
     * 以 scrollHeight > clientHeight 判定谁真正需要/承载滚动，避免把 scrollTop 设给
     * 内容没超高、无法滚动的内层容器导致方向键滚动失效）。
     * @param element 起始元素（菜单项）
     * @returns 最近的实际可滚容器；无则返回 null
     */
    private findScrollableAncestor(element: HTMLElement): HTMLElement | null {
        const menuElement = this.menu?.element;
        let node: HTMLElement | null = element;
        while (node && node !== menuElement && node.parentElement) {
            // 只有内容确实超高（可滚）才作为候选滚动容器，避免把 scrollTop 赋给无滚动条的内层
            if (node.scrollHeight > node.clientHeight + 1) {
                const overflowY = getComputedStyle(node).overflowY;
                if (overflowY === "auto" || overflowY === "scroll") {
                    return node;
                }
            }
            node = node.parentElement;
        }
        return null;
    }

    /**
     * 滚动到指定的菜单项，确保其在滚动容器中可见
     * 滚动目标是“最近的实际可滚容器”（可能为 .jcsm-snippets-container 或 .b3-menu__items）；
     * 只做一次滚动定位：选中项是否可见由 selectMenuItem 的"先展开所在折叠分组"保证，
     * 展开完成后单帧位置即已就绪，无需对 scrollTop 做叠加重试（叠加会造成快速连按方向键
     * 时多条帧链累积滚动、把滚动条顶到尽头，导致容器看似无法滚动）。
     * @param menuItem 要滚动到的菜单项
     * @param retry 等待布局就绪的重试次数（仅位置未就绪时使用，不滚动）
     */
    private scrollToMenuItem(menuItem: HTMLElement, retry = 0) {
        // 找到真正可滚的容器；找不到（内容未超高、无需滚动）则回退片段列表容器并直接跳过
        const scrollContainer = this.findScrollableAncestor(menuItem) ?? this.menuItems.querySelector(".jcsm-snippets-container") as HTMLElement | null;
        if (!scrollContainer) return;

        // 使用 requestAnimationFrame 确保元素完全渲染后再获取位置信息
        requestAnimationFrame(() => {
            // 菜单已关闭或滚动容器已脱离文档时终止
            if (!this.menu || !scrollContainer.isConnected) return;

            const containerRect = scrollContainer.getBoundingClientRect();
            const itemRect = menuItem.getBoundingClientRect();

            // 位置信息尚未就绪（高度为 0，如所在分组刚展开、布局未排定）时稍后重试；
            // 此分支只等待、不滚动，不会叠加滚动
            if (containerRect.height === 0 || itemRect.height === 0) {
                if (retry < SCROLL_TO_VISIBLE_MAX_RETRY) {
                    requestAnimationFrame(() => this.scrollToMenuItem(menuItem, retry + 1));
                }
                return;
            }

            // 计算菜单项是否在可视区域内并滚动到位（一次到位，不叠加）
            const isAbove = itemRect.top < containerRect.top;
            const isBelow = itemRect.bottom > containerRect.bottom;

            if (isAbove) {
                // 菜单项在可视区域上方，滚动到菜单项顶部
                scrollContainer.scrollTop -= (containerRect.top - itemRect.top);
            } else if (isBelow) {
                // 菜单项在可视区域下方，滚动到菜单项底部
                scrollContainer.scrollTop += (itemRect.bottom - containerRect.bottom);
            }
        });
    }

    /**
     * 菜单键盘动作分发（全局键盘协调器在焦点位于 body 且菜单打开时直调，不再合成 click 事件中转）
     * @param key 按键标识（KeyboardEvent.key）
     */
    private handleMenuKey = async (key: string) => {
        if (key === "Escape") {
            // 按 Esc 关闭菜单
            this.menu?.close();
        } else if (key === "Enter") {
            // 按回车激活当前选中项：新建代码片段或切换其启用开关
            // 注意：必须精确定位 snippetSwitch——菜单项内 publishSwitch 排在其前，
            // 用 input[type='checkbox'] 会误切到发布服务开关
            const snippetElement = this.menuItems.querySelector(`.${CURRENT_ITEM_CLASS}`) as HTMLElement;
            const type = snippetElement?.dataset.type;
            if (!snippetElement) return;
            if (type === "new") {
                this.plugin.snippetManager.createSnippet();
                return;
            }
            const input = snippetElement.querySelector("input[data-type='snippetSwitch']") as HTMLInputElement;
            const snippet = await this.plugin.snippetManager.getSnippetById(snippetElement.dataset.id!);
            if (input && snippet) {
                input.checked = !input.checked;
                void this.plugin.snippetManager.toggleSnippet(snippet, input.checked);
            }
        } else if (key === "ArrowUp" || key === "ArrowDown") {
            // 按上下方向键循环切换代码片段选项
            // 获取当前代码片段类型的所有可见菜单项（排除带有 .fn__none 类的元素）
            const visibleMenuItems = Array.from(this.menuItems.querySelectorAll(`.jcsm-snippet-item[data-type="${this.plugin.snippetsType}"]:not(.fn__none)`)) as HTMLElement[];
            const currentMenuItem = this.menuItems.querySelector(`.${CURRENT_ITEM_CLASS}`) as HTMLElement;

            let nextMenuItem: HTMLElement | undefined;
            if (visibleMenuItems.length === 0) {
                // 没有可见代码片段时，选中新建按钮
                nextMenuItem = this.menuItems.querySelector(`.jcsm-snippet-item[data-type="new"][data-snippet-type="${this.plugin.snippetsType}"]`) as HTMLElement || undefined;
            } else if (visibleMenuItems.length === 1) {
                // 只有一个可见代码片段时，切换到该代码片段
                nextMenuItem = visibleMenuItems[0];
            } else {
                // 获取当前选中项在可见菜单项中的索引，如果没有选中项则设为 -1
                const currentIndex = currentMenuItem ? visibleMenuItems.indexOf(currentMenuItem) : -1;
                // 向上键循环上一个、向下键循环下一个
                const newIndex = key === "ArrowUp"
                    ? (currentIndex <= 0 ? visibleMenuItems.length - 1 : currentIndex - 1)
                    : (currentIndex >= visibleMenuItems.length - 1 ? 0 : currentIndex + 1);
                nextMenuItem = visibleMenuItems[newIndex];
            }
            if (nextMenuItem) {
                this.selectMenuItem(nextMenuItem);
            }
        } else if (key === "ArrowLeft" || key === "ArrowRight") {
            // 按左右方向键切换代码片段类型
            const newType = this.plugin.snippetsType === "css" ? "js" : "css";

            // 切换选项卡元素
            const newTypeRadio = this.menuItems.querySelector(`[data-snippet-type="${newType}"]`) as HTMLInputElement;
            if (newTypeRadio) {
                newTypeRadio.checked = true;
            }

            // 切换代码片段类型
            this.plugin.snippetsType = newType;
            this.setMenuSnippetsType(newType);
            // 持久化上次类型（供下次打开菜单恢复；经思源内核 localStorage，见 ui-storage.ts）
            void this.plugin.uiStorage?.saveSnippetsType(newType);
        }
    };

    /**
     * 菜单点击事件处理
     * @param event 鼠标事件
     */
    private menuClickHandler = async (event: MouseEvent) => {
        // 如果正在拖拽或拖拽回到原位，则不执行点击逻辑（拖拽状态与清理见 MenuDragSort）
        if (this.dragSort.isDragging) {
            this.plugin.console.log("menuClickHandler: During drag operation, ignore click events.");
            this.dragSort.clearDragState(); // 延迟清除拖拽状态
            return;
        }

        // 点击按钮之后默认会关闭整个菜单，这里需要阻止事件冒泡
        event.stopPropagation();
        // 不能阻止事件默认行为，否则点击 label 时无法切换 input 的选中状态
        // event.preventDefault();
        const target = event.target as HTMLElement;
        const tagName = target.tagName.toLowerCase();

        // 移除按钮上的焦点，避免后续回车还会触发按钮。但不移除搜索输入框的焦点，让用户可以正常输入
        if (tagName === "button") target.blur();

        // 点击顶部
        if (target.closest(".jcsm-top-container")) {
            this.clearMenuSelection();

            // 切换代码片段类型
            if (tagName === "input" && target.getAttribute("name") === "jcsm-tabs") {
                const type = target.dataset.snippetType;
                if (type === "css" || type === "js") {
                    this.plugin.snippetsType = type;
                    this.setMenuSnippetsType(type);
                    // 持久化上次类型（供下次打开菜单恢复；经思源内核 localStorage，见 ui-storage.ts）
                    void this.plugin.uiStorage?.saveSnippetsType(type);
                }
            }

            // 切换全局开关（snippetType 取当前菜单显示的类型）
            if (target.classList.contains("jcsm-all-snippets-switch")) {
                void this.plugin.snippetManager.globalToggleSnippet(this.plugin.snippetsType, (target as HTMLInputElement).checked);
            }

            // 点击顶部的按钮
            if (tagName === "button") {
                const type = target.dataset.type;
                if (type === "search") {
                    // 显示或隐藏搜索输入框
                    const searchInput = this.menuItems.querySelector("input[data-action='search']") as HTMLInputElement;
                    if (this.plugin.config.snippetSearchType !== 0 && searchInput) {
                        const isOpen = !searchInput.classList.contains("fn__none");
                        if (isOpen) {
                            // 隐藏搜索输入框
                            target.classList.remove("jcsm-active");
                            searchInput.classList.add("fn__none");
                            searchInput.value = "";
                            // 触发冒泡的 input 事件，清空搜索结果
                            searchInput.dispatchEvent(new Event("input", { bubbles: true }));
                        } else {
                            // 显示搜索输入框
                            target.classList.add("jcsm-active");
                            const placeholderText = this.plugin.config.snippetSearchType === 0 ? this.plugin.i18n.search :
                                this.plugin.i18n[["snippetSearchTypeName", "snippetSearchTypeContent", "snippetSearchTypeNameAndContent"][this.plugin.config.snippetSearchType - 1]];
                            searchInput.setAttribute("placeholder", placeholderText);
                            searchInput.classList.remove("fn__none");
                            searchInput.focus();
                        }
                    }
                } else if (type === "config") {
                    // 打开设置对话框
                    this.plugin.openSetting();
                } else if (type === "reload") {
                    // 重新加载界面（扫描打开的编辑对话框未保存变更并二次确认，见 SnippetsDialog.reloadUI）
                    this.plugin.snippetsDialog.reloadUI();
                } else if (type === "group") {
                    // 新建分组（归属当前分区类型；无分组时创建首个分组即进入分组视图）
                    this.addGroup();
                } else if (type === "new") {
                    // 新建代码片段
                    this.plugin.snippetManager.createSnippet();
                }
            }
        }

        // 分组视图下：组头折叠与组头"重命名/删除"按钮分发（点击组头非按钮区域则切换折叠）
        if (this.isGroupedView()) {
            const groupButton = target.closest("button[data-group-action]") as HTMLButtonElement | null;
            if (groupButton) {
                const action = groupButton.dataset.groupAction;
                const groupHeader = groupButton.closest(".jcsm-group-header") as HTMLElement | null;
                if (action === "rename" && groupHeader) {
                    this.renameGroup(groupHeader.dataset.groupId!);
                } else if (action === "delete" && groupHeader) {
                    this.deleteGroup(groupHeader.dataset.groupId!);
                }
                return;
            }
            const headerElement = target.closest(".jcsm-group-header") as HTMLElement | null;
            if (headerElement) {
                const section = headerElement.closest(".jcsm-group-section") as HTMLElement;
                this.toggleGroupSectionCollapsed(section);
                return;
            }
        }

        // 点击代码片段
        const snippetMenuItem = target.closest(".b3-menu__item") as HTMLElement;
        if (snippetMenuItem) {
            if (tagName === "button") {
                // 点击按钮不会改变代码片段的开关状态，所以直接从 snippetsList 中获取当前代码片段
                const snippet = await this.fetchSnippetForMenu(snippetMenuItem.dataset.id!);
                if (!snippet) return;

                const buttonType = target.dataset.type;
                if (buttonType === "duplicate") {
                    // 创建代码片段副本
                    void this.plugin.snippetManager.saveSnippet(snippet, true);
                } else if (buttonType === "edit") {
                    // 编辑代码片段，打开编辑对话框
                    void this.plugin.snippetsDialog.openEditDialog(snippet);
                    // TODO自定义页签: 编辑页签，等其他功能稳定之后再做
                } else if (buttonType === "delete") {
                    // 删除代码片段
                    this.plugin.snippetsDialog.openDeleteDialog(snippet.name, () => {
                        // 弹窗确定后删除代码片段
                        void this.plugin.snippetManager.deleteSnippet(snippet.id!, snippet.type);
                    }); // 取消后无操作
                } else {
                    // 点击到不知道哪里的按钮，显示错误信息
                    this.plugin.showErrorMessage(this.plugin.i18n.unknownButtonType);
                }
            } else if (tagName === "input") {
                // 点击开关
                const type = target.dataset.type;
                if (type === "snippetSwitch") {
                    const snippet = await this.plugin.snippetManager.getSnippetById(snippetMenuItem.dataset.id!);
                    if (snippet) {
                        void this.plugin.snippetManager.toggleSnippet(snippet, (target as HTMLInputElement).checked);
                    }
                } else if (type === "publishSwitch") {
                    const snippet = await this.plugin.snippetManager.getSnippetById(snippetMenuItem.dataset.id!);
                    if (snippet) {
                        void this.plugin.snippetManager.toggleSnippetPublish(snippet.id, !(target as HTMLInputElement).checked);
                    }
                }
            } else if (target.getAttribute("data-type") === "new") {
                // 点击“添加第一个代码片段”按钮，新建代码片段
                this.plugin.snippetManager.createSnippet();
            } else {
                // 点击代码片段的菜单项
                if (this.plugin.config.snippetOptionClickBehavior === 1) {
                    // 切换代码片段的开关状态
                    const snippetSwitchCheckBox = snippetMenuItem.querySelector("input[data-type='snippetSwitch']") as HTMLInputElement;
                    snippetSwitchCheckBox.checked = !snippetSwitchCheckBox.checked;
                    const snippet = await this.plugin.snippetManager.getSnippetById(snippetMenuItem.dataset.id!);
                    if (snippet) {
                        void this.plugin.snippetManager.toggleSnippet(snippet, snippetSwitchCheckBox.checked);
                    }
                } else if (this.plugin.config.snippetOptionClickBehavior === 2) {
                    // 打开代码片段编辑器
                    const snippet = await this.fetchSnippetForMenu(snippetMenuItem.dataset.id!);
                    if (!snippet) return;
                    void this.plugin.snippetsDialog.openEditDialog(snippet);
                }
            }

            if (this.plugin.isMobile) {
                // 移动端点击之后一直高亮着选项不好看，所以清除选中状态
                this.clearMenuSelection();
            }
        }
    };

    /**
     * 是否显示发布服务开关
     * （plugin.json disabledInPublish 为 true，发布会话不加载本插件；
     * 此开关用于在普通会话中管理片段是否在发布服务中生效）
     */
    isShowPublishCheckbox() {
        return this.plugin.config.showPublishCheckbox === 0 ? window.siyuan.config!.publish.enable === true : this.plugin.config.showPublishCheckbox === 1;
    }

    /**
     * 自拉代码片段用于菜单项操作，并对异常统一处理：undefined（列表中无该片段）弹错误提示，
     * false（自拉 API 失败）静默返回；成功返回片段。
     * @param snippetId 代码片段 ID
     * @returns 代码片段（异常时为 undefined，调用方直接 return 即可）
     */
    private async fetchSnippetForMenu(snippetId: string): Promise<Snippet | undefined> {
        const snippet = await this.plugin.snippetManager.getSnippetById(snippetId);
        if (snippet === undefined) {
            // undefined 是数组中没有
            this.plugin.showErrorMessage(this.plugin.i18n.getSnippetFailed);
        }
        // false（调用 API 返回错误）不弹窗，静默返回
        return snippet === false ? undefined : snippet;
    }

    /**
     * 生成代码片段列表（供本类与 SnippetManager 等生成菜单/对话框菜单项 HTML）
     * @param snippetsList 代码片段列表
     * @returns 代码片段列表 HTML 字符串
     */
    genMenuSnippetsItems(argSnippetsList?: Snippet[]): string {
        // 传入指定列表（如新增副本的单个菜单项）时不排序；默认按插件排序方式处理全量列表
        // （含深拷贝与按键排序，见 domain/snippet.ts sortSnippets）
        const snippetsList = argSnippetsList ?? sortSnippets(this.plugin.snippetsList ?? [], this.plugin.config.snippetSortType);
        return snippetsList.map(snippet => this.buildSnippetRow(snippet)).join("");
    }

    /**
     * 是否分组视图（菜单分组渲染/分组拖拽/分组操作均以本判断分支）
     * 分组无独立开关：存在至少一个真实分组即按分组折叠展示；没有任何分组时回退为平铺列表，
     * 与未开启分组功能前一致。未分组占位（UNGROUPED_GROUP_ID）不计入，仅表达组序位置。
     */
    isGroupedView(): boolean {
        return (this.plugin.snippetGroupStore?.groups?.some(group => !isUngroupedGroup(group))) ?? false;
    }

    /**
     * 生成单个代码片段菜单项 HTML（分组渲染与平铺渲染共用，保证两种形态下片段项 DOM 一致）
     * @param snippet 代码片段
     * @returns 代码片段菜单项 HTML 字符串
     */
    private buildSnippetRow(snippet: Snippet): string {
        const isTouch = this.plugin.isMobile || this.isTouchDevice;
        const showPublishCheckbox = this.isShowPublishCheckbox();

        // 删除/复制/编辑三个操作按钮（同构模板数据驱动生成，显隐随对应配置项）
        const actionButtons = [
            { type: "delete", icon: "iconTrashcan", show: this.plugin.config.showDeleteButton },
            { type: "duplicate", icon: "iconCopy", show: this.plugin.config.showDuplicateButton },
            { type: "edit", icon: "iconEdit", show: this.plugin.config.showEditButton },
        ];
        const itemButtonsHtml = actionButtons
            .map(button => `<button class="block__icon block__icon--show fn__flex-center${isTouch ? " jcsm-touch" : ""}${button.show ? "" : " fn__none"}" data-type="${button.type}"><svg><use xlink:href="#${button.icon}"></use></svg></button>`)
            .join("\n    ");

        // 创建临时的 DOM 元素来安全地设置代码片段名称 https://github.com/TCOTC/snippets/issues/21
        const safeSnippetName = document.createElement("span");
        safeSnippetName.textContent = snippetTitle(snippet);

        return `
<div class="jcsm-snippet-item b3-menu__item" data-type="${snippet.type}" data-id="${snippet.id}">
    <span class="jcsm-snippet-name fn__flex-1" placeholder="${this.plugin.i18n.emptySnippet}">${safeSnippetName.innerHTML}</span>
    <span class="fn__space"></span>
    ${itemButtonsHtml}
    <span class="fn__space"></span>
    ${genSnippetSwitchHtml("publishSwitch", !snippet.disabledInPublish, "jcsm-switch ", this.plugin.i18n.snippetDisabledInPublish, !showPublishCheckbox)}
    <span class="fn__space"></span>
    ${genSnippetSwitchHtml("snippetSwitch", snippet.enabled, "jcsm-switch ")}
</div>
            `;
    }

    /**
     * 折叠状态映射键（组内 map 键 "<css|js>.<分组 id|default>"，见 services/ui-storage.ts）
     * @param snippetType 片段类型
     * @param key 分组 id 或未分组占位 id
     * @returns 映射键
     */
    private groupCollapsedMapKey(snippetType: SnippetType, key: string): string {
        return `${snippetType}.${key}`;
    }

    /**
     * 读取分组折叠状态（默认展开；折叠是视图偏好，经 plugin.uiStorage 存思源内核 localStorage，
     * 跨窗口一致：本窗口切换即写库广播，打开菜单时由内核拉取最新）
     * @param snippetType 片段类型
     * @param key 分组 id 或未分组占位 id
     * @returns 是否折叠
     */
    private isGroupCollapsed(snippetType: SnippetType, key: string): boolean {
        return this.plugin.uiStorage?.groupCollapsed?.[this.groupCollapsedMapKey(snippetType, key)] === true;
    }

    /**
     * 写入分组折叠状态（同步更新缓存 map 并异步落库到思源内核 localStorage；只记录折叠为 true 的项）
     * @param snippetType 片段类型
     * @param key 分组 id 或未分组占位 id
     * @param collapsed 是否折叠
     */
    private setGroupCollapsed(snippetType: SnippetType, key: string, collapsed: boolean) {
        const uiStorage = this.plugin.uiStorage;
        if (!uiStorage) return;
        const next = { ...uiStorage.groupCollapsed };
        const mapKey = this.groupCollapsedMapKey(snippetType, key);
        if (collapsed) {
            next[mapKey] = true;
        } else {
            delete next[mapKey];
        }
        uiStorage.groupCollapsed = next;
        void uiStorage.saveGroupCollapsed(next);
    }

    /**
     * 生成分组视图下片段列表容器 HTML（CSS/JS 两类型各自判断；
     * 只有该类型存在至少一个用户分组时才按分组折叠树渲染并显示内置“未分组”，
     * 否则该类型直接平铺列出片段、不显示“未分组”标题。
     * 未分组占位分组在组序中的位置即“未分组”区段的位置，真实分组照常渲染。
     * 新建分组入口在菜单顶栏分组按钮，见 menuClickHandler data-type="group"）
     * @returns 分组视图 HTML 字符串
     */
    genGroupedMenuHtml(): string {
        const groups = cloneGroups(this.plugin.snippetGroupStore.groups ?? []);
        let html = "";
        (["css", "js"] as SnippetType[]).forEach(type => {
            const typeGroups = groups.filter(group => group.type === type);
            const realGroups = typeGroups.filter(group => !isUngroupedGroup(group));
            if (realGroups.length === 0) {
                // 该类型尚无用户分组：平铺列出片段，不显示“未分组”（避免未启用分组的类型多出组头）
                html += this.genTypePlainItems(type);
                return;
            }
            const hasAnchor = typeGroups.some(group => isUngroupedGroup(group));
            typeGroups.forEach(group => {
                // 未分组占位按其当前位置渲染为“未分组”区段（真实成员由未分组集合推导，不落盘）
                html += isUngroupedGroup(group)
                    ? this.genUngroupedSectionHtml(type, typeGroups)
                    : this.genGroupSectionHtml(type, group);
            });
            // 防御：分组缓存未补齐占位时，未分组兜底渲染在该类型所有组之后
            if (!hasAnchor) {
                html += this.genUngroupedSectionHtml(type, typeGroups);
            }
        });
        return html;
    }

    /**
     * 平铺生成某类型的片段行（该类型尚无用户分组时使用，不产生“未分组”组头）
     * @param snippetType 片段类型
     * @returns 片段行 HTML 字符串
     */
    private genTypePlainItems(snippetType: SnippetType): string {
        const snippetsList = this.plugin.snippetsList ?? [];
        return snippetsList
            .filter(snippet => snippet.type === snippetType)
            .map(snippet => this.buildSnippetRow(snippet))
            .join("");
    }

    /**
     * 以片段 id 反查片段（构建分组/未分组行时用，找不到则跳过——对账已剔除孤儿 id，这里仅防御）
     * @param snippetsList 权威片段列表
     * @param snippetType 片段类型
     * @returns 片段 id → 片段 的映射
     */
    private buildSnippetIdMap(snippetsList: Snippet[], snippetType: SnippetType): Map<string, Snippet> {
        const map = new Map<string, Snippet>();
        snippetsList.forEach(snippet => {
            if (snippet.type === snippetType) {
                map.set(snippet.id, snippet);
            }
        });
        return map;
    }

    /**
     * 生成单个分组区段 HTML（组头 + 组内片段行，折叠时隐藏组内行）
     * @param snippetType 片段类型
     * @param group 分组
     * @returns 区段 HTML 字符串
     */
    private genGroupSectionHtml(snippetType: SnippetType, group: SnippetGroup): string {
        const snippetMap = this.buildSnippetIdMap(this.plugin.snippetsList ?? [], snippetType);
        const rows = group.snippetIds
            .map(id => snippetMap.get(id))
            .filter((snippet): snippet is Snippet => !!snippet)
            .map(snippet => this.buildSnippetRow(snippet))
            .join("");
        const collapsed = this.isGroupCollapsed(snippetType, group.id);
        const name = group.name ? escapeHtml(group.name) : escapeHtml(this.plugin.i18n.groupEmptyName);
        // 折叠箭头用思源列表项同款 #iconRight（默认展开朝下、折叠朝右，见 index.scss rotate）
        // 参考思源 b3-list-item--hide-action：操作按钮收进 .jcsm-group-action 容器，默认隐藏，
        // 仅鼠标悬浮在组头时才显示（触摸设备给组头加 jcsm-touch 类常显）；按钮位于计数左侧
        const isTouch = this.plugin.isMobile || this.isTouchDevice;
        return `
<section class="jcsm-group-section${collapsed ? " jcsm-collapsed" : ""}" data-snippet-type="${snippetType}" data-group-id="${group.id}">
    <div class="jcsm-group-header${isTouch ? " jcsm-touch" : ""}" data-group-id="${group.id}" title="${name}">
        <span class="jcsm-caret fn__flex-center" aria-hidden="true"><svg><use xlink:href="#iconRight"></use></svg></span>
        <span class="jcsm-group-name fn__flex-1">${name}</span>
        <span class="jcsm-group-action fn__flex-center">
            <button class="block__icon block__icon--show fn__flex-center ariaLabel" data-group-action="rename" aria-label="${escapeHtml(this.plugin.i18n.groupRename)}" data-position="north"><svg><use xlink:href="#iconEdit"></use></svg></button>
            <button class="block__icon block__icon--show fn__flex-center ariaLabel" data-group-action="delete" aria-label="${escapeHtml(this.plugin.i18n.groupDelete)}" data-position="north"><svg><use xlink:href="#iconTrashcan"></use></svg></button>
        </span>
        <span class="jcsm-group-count">${group.snippetIds.length}</span>
    </div>
    <div class="jcsm-group-items">${rows}</div>
</section>
            `;
    }

    /**
     * 生成某类型的"未分组"内置区段 HTML（收纳未被任何同类型真实分组引用的片段，按全局数组序展示）。
     * 区段带固定占位分组 id（UNGROUPED_GROUP_ID），供组间拖拽排序把“未分组”当作普通分组移动位置。
     * @param snippetType 片段类型
     * @param typeGroups 该类型下的分组（含占位，用于推导未分组成员）
     * @returns 区段 HTML 字符串
     */
    private genUngroupedSectionHtml(snippetType: SnippetType, typeGroups: SnippetGroup[]): string {
        const snippetsList = this.plugin.snippetsList ?? [];
        const ungroupedIds = ungroupedSnippetIds(typeGroups, snippetsList, snippetType);
        const snippetMap = this.buildSnippetIdMap(snippetsList, snippetType);
        const rows = ungroupedIds
            .map(id => snippetMap.get(id))
            .filter((snippet): snippet is Snippet => !!snippet)
            .map(snippet => this.buildSnippetRow(snippet))
            .join("");
        const collapsed = this.isGroupCollapsed(snippetType, UNGROUPED_GROUP_ID);
        const isTouch = this.plugin.isMobile || this.isTouchDevice;
        const label = escapeHtml(this.plugin.i18n.groupUngrouped);
        return `
<section class="jcsm-group-section${collapsed ? " jcsm-collapsed" : ""}" data-snippet-type="${snippetType}" data-group-id="${UNGROUPED_GROUP_ID}" data-ungrouped="true">
    <div class="jcsm-group-header${isTouch ? " jcsm-touch" : ""}" data-group-id="${UNGROUPED_GROUP_ID}" data-ungrouped="true" title="${label}">
        <span class="jcsm-caret fn__flex-center" aria-hidden="true"><svg><use xlink:href="#iconRight"></use></svg></span>
        <span class="jcsm-group-name fn__flex-1">${label}</span>
        <span class="jcsm-group-count">${ungroupedIds.length}</span>
    </div>
    <div class="jcsm-group-items">${rows}</div>
</section>
            `;
    }

    /**
     * 切换分组/未分组区段折叠并持久化到 localStorage
     * @param section 区段元素
     */
    private toggleGroupSectionCollapsed(section: HTMLElement) {
        const snippetType = section.dataset.snippetType as SnippetType;
        const key = section.dataset.groupId ?? UNGROUPED_GROUP_ID;
        const collapsed = section.classList.toggle("jcsm-collapsed");
        this.setGroupCollapsed(snippetType, key, collapsed);
    }

    /**
     * 若片段条目所在分组区段处于折叠态则展开（方向键定位到组内片段前调用），
     * 使被定位的条目可见；展开态持久化到 localStorage
     * @param item 片段菜单项
     */
    private expandSectionForItem(item: HTMLElement) {
        const section = item.closest(".jcsm-group-section") as HTMLElement | null;
        if (!section || !section.classList.contains("jcsm-collapsed")) {
            return;
        }
        const snippetType = section.dataset.snippetType as SnippetType;
        const key = section.dataset.groupId ?? UNGROUPED_GROUP_ID;
        section.classList.remove("jcsm-collapsed");
        this.setGroupCollapsed(snippetType, key, false);
    }

    /**
     * 查找当前分区类型下的分组
     * @param groupId 分组 id
     * @returns 分组（不存在或类型不符时为 undefined）
     */
    private findCurrentTypeGroup(groupId: string): SnippetGroup | undefined {
        return findGroup(this.plugin.snippetGroupStore.groups ?? [], this.plugin.snippetsType, groupId);
    }

    /**
     * 新建分组（归属当前显示的分区类型；名称经输入对话框收集，空名取消）
     */
    addGroup() {
        const title = this.plugin.i18n.groupNewTitle;
        this.plugin.snippetsDialog.openPrompt(title, this.plugin.i18n.groupNamePlaceholder, "", (rawName) => {
            const name = rawName.trim();
            if (!name) {
                this.plugin.showErrorMessage(this.plugin.i18n.groupNameRequired);
                return;
            }
            const groupId = genNewGroupId(this.plugin.snippetGroupStore.groups ?? [], () => window.Lute.NewNodeID());
            const nextGroups = addGroup(this.plugin.snippetGroupStore.groups, {
                id: groupId, type: this.plugin.snippetsType, name, snippetIds: [],
            });
            void this.commitGroups(nextGroups);
        });
    }

    /**
     * 重命名分组（输入对话框预填当前名称，空名取消）
     * @param groupId 分组 id
     */
    renameGroup(groupId: string) {
        const group = this.findCurrentTypeGroup(groupId);
        if (!group) return;
        this.plugin.snippetsDialog.openPrompt(this.plugin.i18n.groupRenameTitle, this.plugin.i18n.groupNamePlaceholder, group.name, (rawName) => {
            const name = rawName.trim();
            if (!name) {
                this.plugin.showErrorMessage(this.plugin.i18n.groupNameRequired);
                return;
            }
            void this.commitGroups(renameGroup(this.plugin.snippetGroupStore.groups, groupId, name));
        });
    }

    /**
     * 删除分组（组内片段并入未分组，不删除片段本身；先二次确认）
     * @param groupId 分组 id
     */
    deleteGroup(groupId: string) {
        const group = this.findCurrentTypeGroup(groupId);
        if (!group) return;
        const name = group.name || this.plugin.i18n.groupEmptyName;
        this.plugin.snippetsDialog.openConfirm(
            this.plugin.i18n.groupDelete,
            this.plugin.i18n.groupDeleteDescription.replace("${x}", escapeHtml(name)),
            "jcsm-group-delete",
            undefined,
            this.plugin.i18n.delete,
            () => {
                // 同步清理该分组的折叠持久化状态（折叠键 "<type>.<groupId>"，见 ui-storage.ts），
                // 避免删除后残留无主折叠项
                this.removeGroupCollapsed(group.type, groupId);
                void this.commitGroups(removeGroup(this.plugin.snippetGroupStore.groups, groupId));
            }
        );
    }

    /**
     * 移除某分组（按类型）的折叠持久化状态（删除分组时调用，防残留）
     * @param snippetType 分组类型
     * @param groupId 分组 id
     */
    private removeGroupCollapsed(snippetType: SnippetType, groupId: string) {
        const uiStorage = this.plugin.uiStorage;
        if (!uiStorage || !(this.groupCollapsedMapKey(snippetType, groupId) in uiStorage.groupCollapsed)) {
            return;
        }
        this.setGroupCollapsed(snippetType, groupId, false);
    }

    /**
     * 落盘新分组集合（先补齐/清理未分组占位，保证组序表达正确）并就地重建分组视图
     * @param nextGroups 变更后的分组集合
     */
    private async commitGroups(nextGroups: SnippetGroup[]) {
        const normalized = withUngroupedAnchors(nextGroups);
        this.plugin.snippetGroupStore.groups = normalized;
        await this.plugin.snippetGroupStore.save();
        // 菜单打开时重建片段列表容器以反映最新分组（删光真实分组会回到平铺视图）
        if (this.menuItems) {
            this.initSnippetsContainer();
        }
    }

    /**
     * 设置菜单代码片段类型（供导入导出后刷新菜单类型状态调用）
     * @param snippetType 代码片段类型
     */
    setMenuSnippetsType(snippetType: SnippetType) {
        if (!this.plugin.isMobile) {
            this.setMenuSelection(snippetType);
        }

        // 设置该代码片段类型的全局开关状态
        const enabled = isSnippetsTypeEnabled(snippetType);
        const snippetsTypeSwitch = this.menuItems.querySelector(".jcsm-all-snippets-switch") as HTMLInputElement;
        snippetsTypeSwitch.checked = enabled;

        // 更新按钮提示
        this.menuItems.querySelector("button[data-type='new']")?.setAttribute("aria-label", this.plugin.i18n.add + " " + snippetType.toUpperCase());

        // 设置元素属性，通过 CSS 过滤列表
        const topContainer = this.menuItems.querySelector(".jcsm-top-container") as HTMLElement;
        topContainer?.setAttribute("data-type", snippetType);
    }

    /**
     * 设置菜单代码片段计数（菜单打开时由列表变更事件驱动刷新）
     */
    setMenuSnippetCount() {
        if (!this.menu) return;

        const cssCountElement = this.menuItems.querySelector(".jcsm-tab-count-css") as HTMLElement;
        const jsCountElement = this.menuItems.querySelector(".jcsm-tab-count-js") as HTMLElement;
        if (!cssCountElement || !jsCountElement) return;

        const cssCount = this.plugin.snippetsList.filter((item: Snippet) => item.type === "css").length;
        const jsCount = this.plugin.snippetsList.filter((item: Snippet) => item.type === "js").length;
        cssCountElement.textContent = cssCount > 99 ? "99+" : cssCount.toString();
        jsCountElement.textContent = jsCount > 99 ? "99+" : jsCount.toString();
    }

    /**
     * 选中菜单项（清除其他选中并滚动到该项，方向键/首次选中复用）
     * @param menuItem 要选中的菜单项
     */
    private selectMenuItem(menuItem: HTMLElement) {
        this.clearMenuSelection();
        // 分组视图下若该项所在分组处于折叠态先展开，保证被选中条目可见（回车/高亮有意义）
        if (this.isGroupedView()) {
            this.expandSectionForItem(menuItem);
        }
        menuItem.classList.add(CURRENT_ITEM_CLASS);
        this.scrollToMenuItem(menuItem);
    }

    /**
     * 设置菜单代码片段类型当前选中项
     * @param snippetType 代码片段类型
     */
    private setMenuSelection(snippetType: string) {
        // 给首个该类型的选项添加选中类名；搜索时排除的选项会添加 .fn__none 类名
        const firstMenuItem = this.menuItems?.querySelector(`.b3-menu__item[data-type="${snippetType}"]:not(.fn__none)`) as HTMLElement ||
                              this.menuItems?.querySelector(`.b3-menu__item[data-type="new"][data-snippet-type="${snippetType}"]`) as HTMLElement;
        if (firstMenuItem) {
            this.selectMenuItem(firstMenuItem);
        }
    }

    /**
     * 清除菜单选中
     */
    clearMenuSelection() {
        this.menuItems?.querySelectorAll(`.${CURRENT_ITEM_CLASS}`).forEach((item: HTMLElement) => {
            item.classList.remove(CURRENT_ITEM_CLASS);
        });
    }

    /**
     * 提示需要重新加载界面（JS 代码片段变更无法立即生效）：弹出通知并让重载按钮呼吸
     * 调用点：SnippetManager 更新/移除 JS 注入元素、FileWatchService 移除 JS 监听文件（各自先判断
     * "有旧 JS 且有效"，再调用本方法）。
     * @param timeout 通知显示时长（毫秒）
     */
    async promptJSReloadRequired(timeout: number) {
        this.plugin.showNotification("reloadUIAfterModifyJS", timeout);
        // 高亮菜单上的重新加载界面按钮
        await this.setReloadUIButtonBreathing();
    }

    /**
     * 设置重新加载界面按钮呼吸动画（JS 修改后提示，供 SnippetManager/文件监听等调用）
     */
    async setReloadUIButtonBreathing() {
        if (this.plugin.isReloadUIRequired) return; // 如果已经设置了呼吸动画，则不重复设置
        this.plugin.isReloadUIRequired = true;

        // 如果加载插件时就开启文件监听，menuItems 有可能未初始化
        const reloadUIButton = this.menuItems?.querySelector(".jcsm-top-container button[data-type='reload']") as HTMLButtonElement;
        reloadUIButton?.classList.add("jcsm-breathing");
    }

    /**
     * 是否正在设置代码片段类型开关呼吸动画
     */
    private isSettingSnippetsTypeSwitchBreathing = false;

    /**
     * 设置代码片段类型开关呼吸动画（供 SnippetManager 调用）
     */
    setSnippetsTypeSwitchBreathing() {
        if (this.isSettingSnippetsTypeSwitchBreathing) return;

        const snippetsTypeSwitch = this.menuItems?.querySelector(".jcsm-all-snippets-switch") as HTMLInputElement;
        if (snippetsTypeSwitch) {
            this.isSettingSnippetsTypeSwitchBreathing = true;
            snippetsTypeSwitch.classList.add("jcsm-input-breathing--once");
            setTimeout(() => {
                snippetsTypeSwitch.classList.remove("jcsm-input-breathing--once");
                this.isSettingSnippetsTypeSwitchBreathing = false;
            }, 700); // 动画的时间是 0.7s
        }
    }

    /**
     * 设置所有打开了代码片段编辑对话框的菜单项编辑按钮高亮
     */
    private setAllSnippetsEditButtonActive() {
        const dialogs = document.querySelectorAll(SNIPPET_DIALOG_SELECTOR);
        dialogs.forEach((dialog: HTMLElement) => {
            this.setSnippetEditButtonActive(dialog.dataset.snippetId!);
        });
    }

    /**
     * 设置代码片段菜单项编辑按钮高亮（供 SnippetsDialog 打开编辑对话框时调用）
     * @param snippetId 代码片段 ID
     */
    setSnippetEditButtonActive(snippetId: string) {
        if (!snippetId) return;

        const editButton = this.menuItems?.querySelector(`.jcsm-snippet-item[data-id='${snippetId}'] button[data-type='edit']`) as HTMLButtonElement;
        editButton?.classList.add("jcsm-active");
    }

    /**
     * 移除代码片段菜单项编辑按钮高亮（供 SnippetsDialog 关闭编辑对话框时调用）
     * @param snippetId 代码片段 ID
     */
    removeSnippetEditButtonActive(snippetId: string) {
        if (!snippetId) return;

        const editButton = this.menuItems?.querySelector(`.jcsm-snippet-item[data-id='${snippetId}'] button.jcsm-active[data-type='edit']`) as HTMLButtonElement;
        editButton?.classList.remove("jcsm-active");
    }

    /**
     * 是否存在打开的插件对话框和菜单
     * @returns 是否存在
     */
    isDialogAndMenuOpen(): boolean {
        return document.querySelectorAll(".b3-dialog--open[data-key^='jcsm-']").length > 0 || !!this.menu;
    }

    /**
     * 全局键盘按下事件处理（菜单/对话框键盘协调，监听于 documentElement）
     * @param event 键盘事件
     */
    globalKeyDownHandler = (event: KeyboardEvent) => {
        // 获取所有打开的插件模态对话框，把按键动作直接路由到最顶层对话框登记的处理函数
        // （见 utils.setDialogKeyHandler；不再合成 click 事件，click 处理器保持纯鼠标语义）
        // 无法判断是在操作哪个代码片段编辑对话框（非模态），所以此处忽略代码片段编辑对话框 jcsm-snippet-dialog 的操作
        const dialogElements = this.plugin.snippetsDialog.getAllModalElements();
        const dialogElement = dialogElements[dialogElements.length - 1];
        if (dialogElement) {
            // 阻止冒泡，避免触发原生监听器导致菜单关闭
            event.stopPropagation();
            getDialogKeyHandler(dialogElement)?.(event.key);
            return;
        }

        let handleMenu = true; // 是否处理菜单操作

        // 如果按下的是 Esc 键，则根据菜单和其他插件对话框的 zIndex 来判断是否需要关闭菜单
        if (event.key === "Escape") {
            let maxZIndex = 0;
            let maxZIndexElement: HTMLElement | null | undefined;
            const snippetDialogElements = document.querySelectorAll(`body > ${SNIPPET_DIALOG_SELECTOR}`);
            snippetDialogElements.forEach((element: HTMLElement) => {
                const zIndex = Number(element.style?.zIndex ?? 0);
                if (zIndex > maxZIndex) {
                    maxZIndex = zIndex;
                    maxZIndexElement = element;
                }
            });

            const menuZIndex = Number(this.menu?.element?.style?.zIndex ?? 0);
            if (menuZIndex < maxZIndex) {
                // 菜单的 zIndex 不是最高时就不关闭菜单
                handleMenu = false;
            }

            // 把 Esc 直接路由到最高 zIndex 的非模态编辑对话框登记的处理函数
            if (!this.menu && maxZIndexElement) {
                event.stopPropagation();
                this.plugin.console.log("globalKeyDownHandler: Esc, dispatch to maxZIndexElement", maxZIndexElement);
                getDialogKeyHandler(maxZIndexElement)?.("Escape");
            }
        }

        // 菜单操作
        if (this.menu && document.activeElement === document.body && handleMenu) {
            // 阻止冒泡，避免：
            // 1. 触发原生监听器导致实际上会操作菜单选项，因此无法在输入框中使用方向键移动光标
            // 2. 按 Enter 之后默认会关闭整个菜单
            // 打开插件设置时无法按 Alt+P 打开思源设置菜单，只要不是按 Enter 或方向键就放过事件冒泡
            if (["Escape", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
                this.plugin.console.log("globalKeyDownHandler: Escape, Enter, ArrowUp, ArrowDown, ArrowLeft, ArrowRight", event.key);
                event.stopPropagation();
            }
            // 如果当前在输入框中使用键盘，则不处理菜单按键事件
            if (isInputElementActive()) return;

            void this.handleMenuKey(event.key);
            return;
        }

        // 如果是在代码编辑器里使用快捷键，则阻止冒泡 https://github.com/TCOTC/snippets/issues/19
        if (document.activeElement?.closest(SNIPPET_DIALOG_SELECTOR)) {
            event.stopPropagation();
        }
    };

    /**
     * 移除全局键盘按下事件监听（菜单/对话框关闭后窗口内无 Dialog 和菜单时）
     */
    destroyGlobalKeyDownHandler = () => {
        if (!this.isDialogAndMenuOpen()) {
            // 窗口内没有打开的 Dialog 和菜单之后才移除事件监听
            this.plugin.removeListener(document.documentElement, "keydown", this.globalKeyDownHandler);
        }
    };
}
