// 顶栏菜单 UI
// 职责：代码片段管理器顶栏按钮的创建与点击打开、菜单的打开/绘制/事件委托（含键盘）、CSS/JS 切换、搜索、呼吸动画、
// 菜单项生成与计数/选中/编辑按钮高亮、菜单位置、关闭回调（含自动重载界面联动）、拖拽排序（见 menu-drag-sort.ts）、
// 以及菜单 + 对话框的全局键盘协调（Esc/Enter/方向键按 zIndex 与开合状态分发）。
import {Menu, platformUtils} from "siyuan";
import {hideTooltip, htmlToElement, isInputElementActive, moveElementToTop, showElementTooltip} from "../utils";
import {filterSnippetsByKeyword, isSnippetsTypeEnabled, sortSnippets} from "../domain/snippet";
import {MenuDragSort} from "./menu-drag-sort";
import type PluginSnippets from "../index";
import type {Snippet, SnippetType} from "../types";

/**
 * 顶栏菜单管理器
 * 菜单状态（menu/menuItems/呼吸标志）为本类内部状态，拖拽交互与拖拽状态见 MenuDragSort（src/ui/menu-drag-sort.ts）；
 * 展示配置（snippetSearchType/snippetSortType/snippetOptionClickBehavior/show* 等）为插件实例字段，
 * 经 plugin 延迟读取；业务动作调用 plugin.snippetManager/plugin.snippetsDialog 等模块方法。
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
     * 顶栏菜单对象 this.menu.element === #commonMenu，菜单关闭时 === undefined
     */
    menu!: Menu;

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
     * 初始化顶栏按钮
     * 顶栏按钮即菜单入口：schema onApply（topBarPosition 变更）/生命周期装配均调用本方法。
     */
    async initTopBar() {
        const topBarKeymap = this.plugin.getCustomKeymapByCommand("openSnippetsManager");
        const title = !this.plugin.isMobile && topBarKeymap ? this.plugin.displayName + " " + platformUtils.updateHotkeyTip(topBarKeymap) : this.plugin.displayName;
        this.topBarElement = this.plugin.addTopBar({
            icon: "iconJcsm",
            title: title,
            position: this.plugin.topBarPosition || "right",
            callback: () => {
                this.openSnippetsManager();
            }
        });
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
        this.menu = new Menu("PluginSnippets", () => {
            // 此处会在菜单被关闭（this.menu.close();）时执行
            this.closeMenuCallback();
        });

        // 如果菜单已存在，再次点击按钮就会移除菜单，此时直接返回
        if (this.menu.isOpen) {
            this.menu = undefined as unknown as Menu;
            if (!this.plugin.isMobile && this.topBarElement && this.topBarElement.matches(":hover")) {
                // 只有当鼠标悬停在顶栏按钮上时才显示 tooltip
                showElementTooltip(this.topBarElement);
            }
            return;
        }

        // 获取代码片段列表
        this.plugin.console.log("openMenu: 获取代码片段列表");
        const snippetsList = await this.plugin.snippetManager.getSnippetsList();
        if (snippetsList) {
            this.plugin.snippetsList = snippetsList;
        } else {
            // 获取代码片段列表失败时，关闭菜单
            this.menu.close();
            return;
        }

        // 插入菜单顶部
        this.menuItems = this.menu.element.querySelector(".b3-menu__items")!;
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
<button class="block__icon block__icon--show fn__flex-center ariaLabel${this.plugin.snippetSearchType === 0 ? " fn__none" : ""}" data-type="search" data-position="north" aria-label="${this.plugin.i18n.search}"><svg><use xlink:href="#iconSearch"></use></svg></button>
<button class="block__icon block__icon--show fn__flex-center ariaLabel" data-type="config" data-position="north"><svg><use xlink:href="#iconSettings"></use></svg></button>
<button class="block__icon block__icon--show fn__flex-center ariaLabel${this.plugin.isReloadUIRequired ? " jcsm-breathing" : ""}" data-type="reload" data-position="north"><svg><use xlink:href="#iconRefresh"></use></svg></button>
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
        const reloadUIButton = menuTop.querySelector("button[data-type='reload']") as HTMLButtonElement;
        const reloadUIKeymap = this.plugin.getCustomKeymapByCommand("reloadUI");
        reloadUIButton.setAttribute("aria-label", (!this.plugin.isMobile && reloadUIKeymap) ? this.plugin.i18n.reloadUI + " " + platformUtils.updateHotkeyTip(reloadUIKeymap) : this.plugin.i18n.reloadUI);

        this.menuItems.append(menuTop);

        // 插入搜索输入框
        const searchInput = '<input class="jcsm-snippets-search b3-text-field fn__none" data-action="search" type="text">';
        this.menuItems.insertAdjacentHTML("beforeend", searchInput);

        // 初始化代码片段列表容器
        this.initSnippetsContainer();

        this.setMenuSnippetCount();
        this.setMenuSnippetsType(this.plugin.snippetsType);
        this.setAllSnippetsEditButtonActive();

        // 事件监听
        this.plugin.addListener(this.menu.element, "click", this.menuClickHandler);
        this.plugin.addListener(this.menu.element, "mousedown", () => {
            // 点击菜单时要显示在最上层
            moveElementToTop(this.menu.element);
        });
        this.plugin.addListener(this.menu.element, "input", (event: InputEvent) => {
            const target = event.target as HTMLInputElement;
            const tagName = target.tagName.toLowerCase();
            if (tagName === "input" && target.dataset.action === "search") {
                // 筛选代码片段（过滤逻辑见 domain/snippet.ts filterSnippetsByKeyword）
                const filterSnippetsIds = filterSnippetsByKeyword(this.plugin.snippetsList, this.plugin.snippetSearchType, target.value);
                if (filterSnippetsIds) {
                    this.menuItems.querySelectorAll(".jcsm-snippet-item").forEach((item: HTMLElement) => {
                        if (filterSnippetsIds.includes(item.dataset.id!)) {
                            item.classList.remove("fn__none");
                        } else {
                            item.classList.add("fn__none");
                        }
                    });
                } else {
                    this.menuItems.querySelectorAll(".jcsm-snippet-item").forEach((item: HTMLElement) => {
                        item.classList.remove("fn__none");
                    });
                }

                if (!this.plugin.isMobile) {
                    // 设置当前选中项
                    this.setMenuSelection(this.plugin.snippetsType);
                }
            }
        });
        // 监听按键操作，在选项上按回车时切换开关/特定交互、按 Delete 时删除代码片段、按 Tab 可以在各个可交互的元素上轮流切换
        // 处理太麻烦，先不做了，有其他人需要再说
        this.plugin.addListener(document.documentElement, "keydown", this.globalKeyDownHandler);
        // 添加鼠标事件监听（用于桌面端拖拽排序；拖拽交互实现见 src/ui/menu-drag-sort.ts MenuDragSort）
        this.plugin.addListener(this.menu.element, "mousedown", (event: MouseEvent) => {
            this.dragSort.handleMenuMousedown(event);
        });
        // 添加触摸事件监听（用于移动端拖拽排序）
        this.plugin.addListener(this.menu.element, "touchstart", (event: TouchEvent) => {
            this.dragSort.handleMenuTouchstart(event);
        }, { passive: true });

        // 弹出菜单
        if (this.plugin.isMobile) {
            this.menu.fullscreen();
        } else {
            this.setMenuPosition();
        }
    }

    /**
     * 初始化代码片段列表容器（供跨窗口排序同步时重渲染菜单项列表，需在菜单已打开且有 menuItems 时调用）
     */
    initSnippetsContainer() {
        // 插入代码片段列表容器
        const snippetsContainer = document.createElement("div");
        snippetsContainer.className = "jcsm-snippets-container";
        snippetsContainer.insertAdjacentHTML("beforeend", this.genMenuSnippetsItems());
        this.menuItems.querySelector(".jcsm-snippets-container")?.remove();
        this.menuItems.append(snippetsContainer);

        // “添加第一个 CSS 代码片段”的菜单项
        const newCssSnippetButton = htmlToElement(`<div class="jcsm-snippet-item b3-menu__item" data-type="new" data-snippet-type="css">${this.plugin.i18n.addFirstCSSSnippet}</div>`);
        snippetsContainer.appendChild(newCssSnippetButton);
        // “添加第一个 JS 代码片段”的菜单项
        const newJsSnippetButton = htmlToElement(`<div class="jcsm-snippet-item b3-menu__item" data-type="new" data-snippet-type="js">${this.plugin.i18n.addFirstJSSnippet}</div>`);
        snippetsContainer.appendChild(newJsSnippetButton);
    }

    /**
     * 设置菜单位置
     * @param isUpdate 是否仅更新菜单位置
     */
    setMenuPosition(isUpdate = false) {
        this.plugin.console.log("setMenuPosition: isUpdate =", isUpdate);

        let rect = this.topBarElement.getBoundingClientRect();
        // 如果被隐藏，则使用更多按钮
        if (rect.width === 0) {
            rect = document.querySelector("#barMore")!.getBoundingClientRect();
        }
        if (rect.width === 0) {
            rect = document.querySelector("#barPlugins")!.getBoundingClientRect();
        }

        // this.topBarPosition 不存在的时候就默认为 right
        const dock = this.plugin.topBarPosition === "left" ? document.querySelector("#dockLeft") : document.querySelector("#dockRight");
        const dockRect = dock?.getBoundingClientRect();
        const dockWidth = ((dockRect?.width || 0) + 1).toString() + "px";

        if (!isUpdate) {
            this.menu.open({
                x: rect.right,
                y: rect.bottom + 1,
                isLeft: false,
            });
        }
        // 不要用鼠标位置、菜单要固定宽度，否则切换 CSS 和 JS 时，菜单可能会大幅抖动或者超出窗口边界
        this.menu.element.style.width = "min(400px, 90vw)";
        if (this.plugin.topBarPosition === "left") {
            this.menu.element.style.right = "";
            this.menu.element.style.left = dockWidth;
        } else {
            this.menu.element.style.right = dockWidth;
            this.menu.element.style.left = "";
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
            const topBarKeymap = this.plugin.getCustomKeymapByCommand("openSnippetsManager");
            const title = topBarKeymap ? this.plugin.displayName + " " + platformUtils.updateHotkeyTip(topBarKeymap) : this.plugin.displayName;
            this.topBarElement.setAttribute("aria-label", title);
        }

        // 移除事件监听
        this.plugin.removeListener(this.menu.element);
        this.menu = undefined as unknown as Menu;
        this.destroyGlobalKeyDownHandler();

        // 自动重新加载界面（无打开的编辑对话框时才重载）
        if (this.plugin.autoReloadUIAfterModifyJS && this.plugin.isReloadUIRequired && !this.plugin.editorManager.hasEditorDialogsOpen()) {
            this.plugin.postReloadUI();
        }
    }

    /**
     * 滚动到指定的菜单项，确保其在滚动容器中可见
     * @param menuItem 要滚动到的菜单项
     */
    private scrollToMenuItem(menuItem: HTMLElement) {
        // 获取滚动容器
        const scrollContainer = this.menuItems.querySelector(".jcsm-snippets-container") as HTMLElement;
        if (!scrollContainer) return;

        // 使用 requestAnimationFrame 确保元素完全渲染后再获取位置信息
        requestAnimationFrame(() => {
            // 获取菜单项相对于滚动容器的位置信息
            const containerRect = scrollContainer.getBoundingClientRect();
            const itemRect = menuItem.getBoundingClientRect();

            // 检查位置信息是否有效（高度不为0）
            if (containerRect.height === 0 || itemRect.height === 0) {
                // 如果位置信息无效，再次尝试
                requestAnimationFrame(() => this.scrollToMenuItem(menuItem));
                return;
            }

            // 计算菜单项是否在可视区域内
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

        // 键盘操作
        if (typeof event.detail === "string") {
            this.plugin.console.log("menuClickHandler event:", event);
            if (event.detail=== "Escape") {
                // 按 Esc 关闭菜单
                this.menu.close();
            } else if (event.detail === "Enter") {
                const snippetElement = this.menuItems.querySelector(".b3-menu__item--current") as HTMLElement;
                const type = snippetElement?.dataset.type;
                if (snippetElement) {
                    if (type === "new") {
                        // 按回车新建代码片段
                        this.plugin.snippetManager.createSnippet();
                    } else {
                        // 按回车切换代码片段的开关状态
                        const input = snippetElement.querySelector("input[type='checkbox']") as HTMLInputElement;
                        const snippet = await this.plugin.snippetManager.getSnippetById(snippetElement.dataset.id!);
                        if (input && snippet) {
                            input.checked = !input.checked;
                            void this.plugin.snippetManager.toggleSnippet(snippet, input.checked);
                        }
                    }
                }
            } else if (event.detail === "ArrowUp" || event.detail === "ArrowDown") {
                // 按上下方向键切换代码片段选项
                // 获取当前代码片段类型的所有可见菜单项（排除带有 .fn__none 类的元素）
                const visibleMenuItems = Array.from(this.menuItems.querySelectorAll(`.jcsm-snippet-item[data-type="${this.plugin.snippetsType}"]:not(.fn__none)`)) as HTMLElement[];
                const currentMenuItem = this.menuItems.querySelector(".b3-menu__item--current") as HTMLElement;

                // 如果当前代码片段类型没有可见的 .jcsm-snippet-item 元素，则选中新建按钮
                if (visibleMenuItems.length === 0) {
                    const newSnippetButton = this.menuItems.querySelector(`.jcsm-snippet-item[data-type="new"][data-snippet-type="${this.plugin.snippetsType}"]`) as HTMLElement;
                    if (newSnippetButton) {
                        currentMenuItem?.classList.remove("b3-menu__item--current");
                        newSnippetButton.classList.add("b3-menu__item--current");
                        this.scrollToMenuItem(newSnippetButton);
                    }
                } else if (visibleMenuItems.length === 1) {
                    // 只有一个可见代码片段时，切换到该代码片段
                    currentMenuItem?.classList.remove("b3-menu__item--current");
                    visibleMenuItems[0].classList.add("b3-menu__item--current");
                    this.scrollToMenuItem(visibleMenuItems[0]);
                } else if (visibleMenuItems.length > 1) {
                    // 获取当前选中项在可见菜单项中的索引，如果没有选中项则设为 -1
                    const currentIndex = currentMenuItem ? visibleMenuItems.indexOf(currentMenuItem) : -1;

                    // 根据按键方向计算新的索引
                    let newIndex: number;
                    if (event.detail === "ArrowUp") {
                        // 向上键：切换到前一个元素，如果是第一个则切换到最后一个
                        newIndex = currentIndex <= 0 ? visibleMenuItems.length - 1 : currentIndex - 1;
                    } else {
                        // 向下键：切换到后一个元素，如果是最后一个则切换到第一个
                        newIndex = currentIndex >= visibleMenuItems.length - 1 ? 0 : currentIndex + 1;
                    }

                    // 移除当前选中状态
                    currentMenuItem?.classList.remove("b3-menu__item--current");
                    // 添加新的选中状态
                    visibleMenuItems[newIndex].classList.add("b3-menu__item--current");

                    // 确保选中的代码片段在滚动容器中可见
                    this.scrollToMenuItem(visibleMenuItems[newIndex]);
                }
            } else if (event.detail === "ArrowLeft" || event.detail === "ArrowRight") {
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
            }
        }

        // 点击顶部
        if (target.closest(".jcsm-top-container")) {
            this.clearMenuSelection();

            // 切换代码片段类型
            if (tagName === "input" && target.getAttribute("name") === "jcsm-tabs") {
                const type = target.dataset.snippetType;
                if (type === "css" || type === "js") {
                    this.plugin.snippetsType = type;
                    this.setMenuSnippetsType(type);
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
                    if (this.plugin.snippetSearchType !== 0 && searchInput) {
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
                            const placeholderText = this.plugin.snippetSearchType === 0 ? this.plugin.i18n.search :
                                this.plugin.i18n[["snippetSearchTypeName", "snippetSearchTypeContent", "snippetSearchTypeNameAndContent"][this.plugin.snippetSearchType - 1]];
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
                } else if (type === "new") {
                    // 新建代码片段
                    this.plugin.snippetManager.createSnippet();
                }
            }
        }

        // 点击代码片段
        const snippetMenuItem = target.closest(".b3-menu__item") as HTMLElement;
        if (snippetMenuItem) {
            if (tagName === "button") {
                // 点击按钮

                // 点击按钮不会改变代码片段的开关状态，所以直接从 snippetsList 中获取当前代码片段
                const snippet = await this.plugin.snippetManager.getSnippetById(snippetMenuItem.dataset.id!);
                if (snippet === undefined) {
                    // undefined 是数组中没有
                    this.plugin.showErrorMessage(this.plugin.i18n.getSnippetFailed);
                    return;
                } else if (snippet === false) {
                    // false 是调用 API 返回错误
                    return;
                }

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
                if (this.plugin.snippetOptionClickBehavior === 1) {
                    // 切换代码片段的开关状态
                    const snippetSwitchCheckBox = snippetMenuItem.querySelector("input[data-type='snippetSwitch']") as HTMLInputElement;
                    snippetSwitchCheckBox.checked = !snippetSwitchCheckBox.checked;
                    const snippet = await this.plugin.snippetManager.getSnippetById(snippetMenuItem.dataset.id!);
                    if (snippet) {
                        void this.plugin.snippetManager.toggleSnippet(snippet, snippetSwitchCheckBox.checked);
                    }
                } else if (this.plugin.snippetOptionClickBehavior === 2) {
                    // 打开代码片段编辑器
                    const snippet = await this.plugin.snippetManager.getSnippetById(snippetMenuItem.dataset.id!);
                    if (snippet === undefined) {
                        // undefined 是数组中没有
                        this.plugin.showErrorMessage(this.plugin.i18n.getSnippetFailed);
                        return;
                    } else if (snippet === false) {
                        // false 是调用 API 返回错误
                        return;
                    }
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
     */
    isShowPublishCheckbox() {
        return this.plugin.showPublishCheckbox === 0 ? window.siyuan.config!.publish.enable === true : this.plugin.showPublishCheckbox === 1;
    }

    /**
     * 生成代码片段列表（供本类与 SnippetManager 等生成菜单/对话框菜单项 HTML）
     * @param snippetsList 代码片段列表
     * @returns 代码片段列表 HTML 字符串
     */
    genMenuSnippetsItems(argSnippetsList?: Snippet[]): string {
        // 传入指定列表（如新增副本的单个菜单项）时不排序；默认按插件排序方式处理全量列表
        // （含深拷贝与按键排序，见 domain/snippet.ts sortSnippets）
        const snippetsList = argSnippetsList ?? sortSnippets(this.plugin.snippetsList ?? [], this.plugin.snippetSortType);

        const isTouch = this.plugin.isMobile || this.isTouchDevice;
        const showPublishCheckbox = this.isShowPublishCheckbox();
        let snippetsHtml = "";

        snippetsList.forEach((snippet: Snippet) => {
            // 创建临时的 DOM 元素来安全地设置代码片段名称 https://github.com/TCOTC/snippets/issues/21
            const safeSnippetName = document.createElement("span");
            safeSnippetName.textContent = snippet.name || snippet.content.slice(0, 200);

            snippetsHtml += `
<div class="jcsm-snippet-item b3-menu__item" data-type="${snippet.type}" data-id="${snippet.id}">
    <span class="jcsm-snippet-name fn__flex-1" placeholder="${this.plugin.i18n.emptySnippet}">${safeSnippetName.innerHTML}</span>
    <span class="fn__space"></span>
    <button class="block__icon block__icon--show fn__flex-center${ isTouch ? " jcsm-touch" : ""}${this.plugin.showDeleteButton    ? "" : " fn__none"}" data-type="delete"><svg><use xlink:href="#iconTrashcan"></use></svg></button>
    <button class="block__icon block__icon--show fn__flex-center${ isTouch ? " jcsm-touch" : ""}${this.plugin.showDuplicateButton ? "" : " fn__none"}" data-type="duplicate"><svg><use xlink:href="#iconCopy"></use></svg></button>
    <button class="block__icon block__icon--show fn__flex-center${ isTouch ? " jcsm-touch" : ""}${this.plugin.showEditButton      ? "" : " fn__none"}" data-type="edit"><svg><use xlink:href="#iconEdit"></use></svg></button>
    <span class="fn__space"></span>
    <input data-type="publishSwitch" class="jcsm-switch b3-switch fn__flex-center ariaLabel${ showPublishCheckbox ? "" : " fn__none"}" aria-label="${this.plugin.i18n.snippetDisabledInPublish}" data-position="north" type="checkbox"${snippet.disabledInPublish ? "" : " checked"}>
    <span class="fn__space"></span>
    <input data-type="snippetSwitch" class="jcsm-switch b3-switch fn__flex-center" type="checkbox"${snippet.enabled ? " checked" : ""}>
</div>
            `;
        });

        return snippetsHtml;
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
     * 设置菜单代码片段类型当前选中项
     * @param snippetType 代码片段类型
     */
    private setMenuSelection(snippetType: string) {
        // 移除其他选项上的 .b3-menu__item--current 类名
        this.clearMenuSelection();
        // 给首个该类型的选项添加 .b3-menu__item--current 类名；搜索时排除的选项会添加 .fn__none 类名
        const firstMenuItem = this.menuItems?.querySelector(`.b3-menu__item[data-type="${snippetType}"]:not(.fn__none)`) as HTMLElement ||
                              this.menuItems?.querySelector(`.b3-menu__item[data-type="new"][data-snippet-type="${snippetType}"]`) as HTMLElement;
        if (firstMenuItem) {
            firstMenuItem.classList.add("b3-menu__item--current");
            // 确保选中的代码片段在滚动容器中可见
            this.scrollToMenuItem(firstMenuItem);
        }
    }

    /**
     * 清除菜单选中
     */
    clearMenuSelection() {
        this.menuItems?.querySelectorAll(".b3-menu__item--current").forEach((item: HTMLElement) => {
            item.classList.remove("b3-menu__item--current");
        });
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
        const dialogs = document.querySelectorAll(".b3-dialog--open[data-key=\"jcsm-snippet-dialog\"]");
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
        // 获取所有打开的插件模态对话框，把按键操作发送给 DOM 最下方，也就是最顶层的对话框
        // 无法判断是在操作哪个代码片段编辑对话框（非模态），所以此处忽略代码片段编辑对话框 jcsm-snippet-dialog 的操作
        const dialogElements = this.plugin.snippetsDialog.getAllModalElements();
        const dialogElement = dialogElements[dialogElements.length - 1];
        if (dialogElement) {
            // // 如果按 Esc 时焦点在输入框里，移除焦点
            // if (event.key === "Escape" && isInputElementActive()) {
            //     (document.activeElement as HTMLElement).blur();
            //     return;
            // }
            // 阻止冒泡，避免触发原生监听器导致菜单关闭
            event.stopPropagation();
            // 触发 Dialog 的 click 事件，传递按键（参考原生方法：https://github.com/siyuan-note/siyuan/blob/c88f99646c4c1139bcfc551b4f24b7cbea151751/app/src/boot/globalEvent/keydown.ts#L1394-L1406 ）
            dialogElement.dispatchEvent(new CustomEvent("click", {detail: event.key}));
            return;
        }

        let handleMenu = true; // 是否处理菜单操作

        // 如果按下的是 Esc 键，则根据菜单和其他插件对话框的 zIndex 来判断是否需要关闭菜单
        if (event.key === "Escape") {
            let maxZIndex = 0;
            let maxZIndexElement: HTMLElement | null | undefined;
            const snippetDialogElements = document.querySelectorAll("body > .b3-dialog--open[data-key='jcsm-snippet-dialog']");
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

            // 把事件 dispatchEvent 到最高 zIndex 的 snippetDialogElement 上，让 Dialog 处理 Esc 键
            if (!this.menu && maxZIndexElement) {
                event.stopPropagation();
                this.plugin.console.log("globalKeyDownHandler: Esc, dispatchEvent to maxZIndexElement", maxZIndexElement);
                maxZIndexElement.dispatchEvent(new CustomEvent("click", {detail: event.key}));
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

            this.menu.element.dispatchEvent(new CustomEvent("click", {detail: event.key}));
            return;
        }

        // 如果是在代码编辑器里使用快捷键，则阻止冒泡 https://github.com/TCOTC/snippets/issues/19
        if (document.activeElement?.closest(".b3-dialog--open[data-key='jcsm-snippet-dialog']")) {
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
