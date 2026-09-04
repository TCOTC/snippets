// 顶栏菜单 UI（原 index.ts「顶栏菜单」分节整体外迁，行为等价）
// 职责：代码片段管理器顶栏菜单的打开/绘制/事件委托（含键盘）、CSS/JS 切换、搜索、呼吸动画、
// 拖拽排序（鼠标/触摸）、菜单项生成与计数/选中/编辑按钮高亮、菜单位置、关闭回调（含自动重载界面联动），
// 以及菜单 + 对话框的全局键盘协调（Esc/Enter/方向键按 zIndex 与开合状态分发）。
// 简洁化：不设 Host——直接持有 PluginSnippets 实例（import type 避免运行时循环依赖），
// 经插件侧已 public 化的运行态/服务直连（manager/dialog/store/sync/console/i18n/镜像配置等）。
import {Constants, Menu, platformUtils} from "siyuan";
import {hideTooltip, htmlToElement, isInputElementActive, moveElementToTop, showElementTooltip} from "../utils";
import {isSnippetsTypeEnabled} from "../domain/snippet";
import type PluginSnippets from "../index";
import type {Snippet, SnippetType} from "../types";

/**
 * 顶栏菜单管理器（原 index.ts openMenu/initSnippetsContainer/setMenuPosition/closeMenuCallback/scrollToMenuItem/
 * menuClickHandler/拖拽排序组/搜索/菜单项生成/计数与高亮组 外迁，行为等价）
 * 菜单开关状态（menu/menuItems/拖拽标志/呼吸标志）为本类内部状态；
 * 展示配置（snippetSearchType/snippetSortType/snippetOptionClickBehavior/show* 等）为插件 defineProperty 镜像，
 * 经 plugin 延迟读取；业务动作经 plugin.snippetManager/plugin.snippetsDialog 等直连。
 */
export class SnippetsMenu {
    private readonly plugin: PluginSnippets;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
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
     * 关闭菜单（供插件生命周期等在需要时主动关闭；Menu 关闭会触发关闭回调）
     */
    close() {
        this.menu?.close();
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
            if (!this.plugin.isMobile && this.plugin.topBarElement && this.plugin.topBarElement.matches(":hover")) {
                // 只有当鼠标悬停在顶栏按钮上时才显示 tooltip
                showElementTooltip(this.plugin.topBarElement);
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
                // 筛选代码片段
                const filterSnippetsIds = this.filterSnippetsIds(target.value);
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
        // 添加鼠标事件监听（用于桌面端拖拽排序）
        this.plugin.addListener(this.menu.element, "mousedown", (event: MouseEvent) => {
            this.menuMousedownHandler(event);
        });
        // 添加触摸事件监听（用于移动端拖拽排序）
        this.plugin.addListener(this.menu.element, "touchstart", (event: TouchEvent) => {
            this.menuTouchstartHandler(event);
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

        let rect = this.plugin.topBarElement.getBoundingClientRect();
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
        if (!this.plugin.isMobile && this.plugin.topBarElement) {
            this.plugin.topBarElement.classList.add("toolbar__item--active");
            // 移除 aria-label 属性，在菜单打开时不显示 tooltip
            this.plugin.topBarElement.removeAttribute("aria-label");
            hideTooltip();
        }
    }

    /**
     * 关闭顶栏菜单回调
     */
    private closeMenuCallback() {
        if (this.plugin.topBarElement) {
            // topBarElement 不存在时说明 isMobile 为 true，此时不需要修改顶栏按钮样式
            this.plugin.topBarElement.classList.remove("toolbar__item--active");
            // topBarCommand 有可能变，所以每次都重新获取
            const topBarKeymap = this.plugin.getCustomKeymapByCommand("openSnippetsManager");
            const title = topBarKeymap ? this.plugin.displayName + " " + platformUtils.updateHotkeyTip(topBarKeymap) : this.plugin.displayName;
            this.plugin.topBarElement.setAttribute("aria-label", title);
        }

        // 移除事件监听
        this.plugin.removeListener(this.menu.element);
        this.menu = undefined as unknown as Menu;
        this.destroyGlobalKeyDownHandler();

        // 自动重新加载界面
        if (this.plugin.autoReloadUIAfterModifyJS && this.plugin.isReloadUIRequired && !document.querySelector(".b3-dialog--open[data-key='jcsm-snippet-dialog']")) {
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
        // 如果正在拖拽或拖拽回到原位，则不执行点击逻辑
        if (this.isDragging) {
            this.plugin.console.log("menuClickHandler: During drag operation, ignore click events.");
            this.clearDragState(); // 延迟清除拖拽状态
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

            // 切换全局开关（snippetType 取当前菜单显示的类型，与旧实现内部 snippetsType 一致）
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
     * 拖拽状态标志位，用于防止拖拽回到原位后触发点击事件、防止移动端无法划动菜单列表（判断是否应该阻止默认行为）
     */
    private isDragging = false;

    /**
     * 拖拽清理定时器，用于在拖拽结束后清理标志位
     */
    private dragCleanupTimer: number | null = null;

    /**
     * 清理拖拽状态，延迟清理以确保不会影响正常的点击操作
     */
    private clearDragState() {
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
     * 菜单鼠标按下事件处理（用于拖拽排序）
     * @param event 鼠标事件
     */
    private menuMousedownHandler(event: MouseEvent) {
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
        const dragContainer = this.menuItems.querySelector(".jcsm-snippets-container") as HTMLElement;
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
     * 菜单触摸开始事件处理（用于移动端拖拽排序）
     * @param event 触摸事件
     */
    private menuTouchstartHandler(event: TouchEvent) {
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
        const dragContainer = this.menuItems.querySelector(".jcsm-snippets-container") as HTMLElement;
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

    /**
     * 筛选代码片段（不区分大小写）
     * @param searchText 搜索文本
     * @returns 筛选后的代码片段 ID 数组，如果禁用搜索或搜索文本为空则返回 false
     */
    private filterSnippetsIds(searchText: string): string[] | false {
        // 如果禁用搜索或搜索文本为空，返回 false，表示不搜索
        if (this.plugin.snippetSearchType === 0 || !searchText || searchText.trim() === "") {
            return false;
        }

        const normalizedText = searchText.toLowerCase().trim();

        return this.plugin.snippetsList
            .filter((snippet: Snippet) => {
                switch (this.plugin.snippetSearchType) {
                    case 1:
                        // 按标题筛选
                        return (snippet.name || snippet.content.slice(0, 200)).toLowerCase().includes(normalizedText);
                    case 2:
                        // 按代码内容筛选
                        return snippet.content.toLowerCase().includes(normalizedText);
                    case 3:
                        // 按标题和代码内容筛选
                        return (
                            snippet.name.toLowerCase().includes(normalizedText) ||
                            snippet.content.toLowerCase().includes(normalizedText)
                        );
                    default:
                        // 不支持的搜索类型，直接跳过
                        return false;
                }
            })
            .map((snippet: Snippet) => snippet.id!); // 只返回 id 字符串数组
    }

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
        let snippetsList: Snippet[] = argSnippetsList ?? this.plugin.snippetsList ?? [];
        if (!argSnippetsList) {
            // 深拷贝 snippetsList，避免排序影响原数据
            if (this.plugin.snippetSortType !== "fixedSort" && this.plugin.snippetSortType !== "customSort") {
                if (typeof structuredClone === "function") {
                    snippetsList = structuredClone(snippetsList);
                } else {
                    snippetsList = JSON.parse(JSON.stringify(snippetsList));
                }
            }

            // 排序
            switch (this.plugin.snippetSortType) {
                case "fixedSort":
                    break;
                case "customSort":
                    break;
                case "enabledASC":
                    snippetsList.sort((a, b) => Number(b.enabled) - Number(a.enabled));
                    break;
                case "enabledDESC":
                    snippetsList.sort((a, b) => Number(a.enabled) - Number(b.enabled));
                    break;
                case "fileNameASC":
                    snippetsList.sort((a, b) => a.name.localeCompare(b.name));
                    break;
                case "fileNameDESC":
                    snippetsList.sort((a, b) => b.name.localeCompare(a.name));
                    break;
                case "fileNameNatASC":
                    snippetsList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                    break;
                case "fileNameNatDESC":
                    snippetsList.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
                    break;
                case "createdASC":
                    // 创建时间要从 id 中获取，id 的格式是 "20250813161014-se1mend"，其中 "20250813161014" 是创建时间，"se1mend" 是随机字符串
                    snippetsList.sort((a, b) => a.id!.slice(0, 14).localeCompare(b.id!.slice(0, 14)));
                    break;
                case "createdDESC":
                    snippetsList.sort((a, b) => b.id!.slice(0, 14).localeCompare(a.id!.slice(0, 14)));
                    break;
                default:
                    break;
            }
        }
        snippetsList = snippetsList ?? [];

        const isTouch = this.plugin.isMobile || this.plugin.isTouchDevice;
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
