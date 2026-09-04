import "./index.scss";
import {Snippet, SnippetType} from "./types";
import {isSnippetsTypeEnabled, isValidJavaScriptCode} from "./domain/snippet";
import {SNIPPETS_CHANGED, SnippetStore} from "./domain/snippet-store";
import {createSnippetsConfigItems} from "./config/schema";
import type {SnippetsConfigItem} from "./config/schema";
import {ConfigService} from "./config/config-service";
import {BroadcastService} from "./services/sync";
import {FileWatchService} from "./services/file-watch";
import {hideTooltip, htmlToElement, isInputElementActive, moveElementToTop, showElementTooltip} from "./utils";
import {EventBus} from "./core/event-bus";
import {ImportExportService} from "./services/import-export";
import {FeedbackService} from "./services/feedback";
import {ListenerRegistry} from "./services/listener-registry";

// 思源插件 API
import {
    Constants,
    Dialog,
    fetchPost,
    fetchSyncPost,
    getFrontend,
    hideMessage,
    Menu,
    platformUtils,
    Plugin,
    Setting
} from "siyuan";
// 未使用的：Custom、confirm、openTab、adaptHotkey、getBackend、Protyle、openWindow、IOperation、openMobileFileById、lockScreen、ICard、ICardData、exitSiYuan、getModelByDockType、getAllEditor、Files、platformUtils、openAttributePanel、saveLayout

// 工具函数
import {isPromiseFulfilled} from "./utils";

// CodeMirror 6（编辑器扩展/视图创建/生命周期管理已外迁至 src/ui/codemirror.ts 与 src/ui/editor-manager.ts）
import type {EditorView} from "@codemirror/view";
import {createCodeMirrorEditor} from "./ui/codemirror";
import {EditorManager} from "./ui/editor-manager";
import {SettingDialog} from "./ui/setting-dialog";

const PLUGIN_NAME = "snippets";                    // 插件名
const STORAGE_NAME = "plugin-config.json";         // 配置文件名
// const TAB_TYPE = "custom-tab"; // 自定义标签页

// noinspection JSUnusedGlobalSymbols
export default class PluginSnippets extends Plugin {
    // private custom: () => Custom; // 自定义标签页

    // ================================ 生命周期方法 ================================

    // 使用 window.siyuan.jcsm 存储变量
    // 这样重载插件（比如插件配置同步）之后，旧实例（包含未关闭的 Dialog）与新实例使用的变量始终是一致的

    /**
     * 是否为移动端
     */
    get isMobile(): boolean { return window.siyuan.jcsm?.isMobile ?? false; }
    set isMobile(value: boolean) { (window.siyuan.jcsm ??= {}).isMobile = value; }

    /**
     * 是否为触摸设备
     */
    get isTouchDevice(): boolean { return window.siyuan.jcsm?.isTouchDevice ?? false; }
    set isTouchDevice(value: boolean) { (window.siyuan.jcsm ??= {}).isTouchDevice = value; }

    /**
     * 当前实例是否为发布站点（而非“内核是否启用了发布服务”）：
     * window.siyuan.isPublish 由内核按会话角色注入，发布站点（发布静态页的 WebSocket/API 会话）
     * 为 true，普通编辑前端为 false。发布站点不加载插件（petal 仅加载于普通会话），
     * 因此本方法在现实可达路径上恒为 false，仅作 issue #33 预留判断。
     */
    private isPublish(): boolean { return window.siyuan.isPublish ?? false; }

    /**
     * 顶栏按钮元素
     */
    private topBarElement!: HTMLElement;

    /**
     * 类型化事件总线：数据变更后驱动 UI 刷新等内部解耦
     */
    private internalEventBus = new EventBus();

    /**
     * 代码片段列表 Store：数据写路径的单一入口，统一在列表变更后触发 SNIPPETS_CHANGED 事件
     */
    private snippetStore!: SnippetStore;

    /**
     * 编辑器对话框生命周期管理（主题监听 + 已打开编辑器更新/重建，实现见 src/ui/editor-manager.ts）
     */
    private editorManager!: EditorManager;

    /**
     * 设置对话框管理器（装配与交互见 src/ui/setting-dialog.ts，公开 openSetting 委托到它）
     */
    private settingDialog!: SettingDialog;

    /**
     * 配置服务（装配/持久化/热应用见 src/config/config-service.ts）
     */
    private configService!: ConfigService;

    /**
     * 文件监听服务（文件夹代码片段监听见 src/services/file-watch.ts）
     */
    private fileWatchService!: FileWatchService;

    /**
     * 导入导出服务（代码片段导出/导入见 src/services/import-export.ts）
     */
    private importExportService!: ImportExportService;

    /**
     * 通知/错误提示服务（实现见 src/services/feedback.ts，showNotification/showErrorMessage 委托到它）
     */
    private feedbackService!: FeedbackService;

    /**
     * 事件监听器统一簿记（实现见 src/services/listener-registry.ts，addListener/removeListener 委托到它）
     */
    private listenerRegistry!: ListenerRegistry;

    /**
     * 启用插件
     */
    public async onload() {
        // 初始化代码片段列表 Store，以 window.siyuan.jcsm.snippetsList 作为跨 reload 存活的存储后端
        this.snippetStore = new SnippetStore(this.internalEventBus, {
            get: () => this.snippetsList,
            set: (snippetsList) => {
                this.snippetsList = snippetsList;
            },
        });

        // 初始化编辑器对话框生命周期管理器（运行态经读取器实时转发：editorIndentUnit 需在配置装配完成 defineProperty 后才能读取，故只能在调用时取值）
        this.editorManager = new EditorManager({
            logger: this.console,
            editorIndentUnit: () => this.editorIndentUnit,
            i18n: () => this.i18n,
        });

        // 初始化配置服务（配置装配/持久化/热应用；存储键名与生命周期数据方法在此转发，运行态均延迟到调用时取值）
        this.configService = new ConfigService({
            logger: this.console,
            version: () => this.version,
            i18n: () => this.i18n,
            configItems: () => this.configItems,
            ensureConfigItems: () => this.initConfigItems(),
            definePropertiesTarget: () => this,
            loadConfig: async () => {
                await this.loadData(STORAGE_NAME);
                return this.data[STORAGE_NAME];
            },
            removeConfig: async () => {
                await this.removeData(STORAGE_NAME);
            },
            saveConfig: async (content) => {
                await this.saveData(STORAGE_NAME, content);
            },
            showErrorMessage: (message, timeout, id) => this.showErrorMessage(message, timeout, id),
            closeDialog: (dialogElement) => this.closeDialogByElement(dialogElement),
            hideNotice: (messageI18nKey) => hideMessage(PLUGIN_NAME + "-" + messageI18nKey),
        });

        // 初始化设置对话框管理器（运行态经读取器/动作实时转发：设置项列表等需在配置装配完成后才有，openSetting 打开时才会读取）
        this.settingDialog = new SettingDialog({
            logger: this.console,
            displayName: () => this.displayName,
            i18n: () => this.i18n,
            isMobile: () => this.isMobile,
            app: () => this.app,
            settingItems: () => this.setting.items,
            addListener: (element, event, fn, options) => this.addListener(element, event, fn, options),
            closeDialog: (dialogElement) => this.closeDialogByElement(dialogElement),
            saveSetting: (dialogElement) => this.configService.saveFromDialog(dialogElement),
            closeMenu: () => this.menu?.close(),
            exportSnippets: () => void this.importExportService.exportSnippetsToFile(),
            importSnippets: (overwrite) => void this.importExportService.importSnippets(overwrite),
            globalKeyDownHandler: () => this.globalKeyDownHandler,
        });

        // 初始化文件监听服务（运行态经读取器/动作实时转发：配置镜像属性在配置装配完成后才有，start/handle 调用时读取）
        this.fileWatchService = new FileWatchService({
            logger: this.console,
            i18n: () => this.i18n,
            fileWatchEnabled: () => this.fileWatchEnabled,
            fileWatchPath: () => this.fileWatchPath,
            fileWatchInterval: () => this.fileWatchInterval,
            autoReloadUIAfterModifyJS: () => this.autoReloadUIAfterModifyJS,
            isReloadUIRequired: () => this.isReloadUIRequired,
            showErrorMessage: (message, timeout) => this.showErrorMessage(message, timeout),
            showNotification: (messageI18nKey, timeout) => this.showNotification(messageI18nKey, timeout),
            setReloadUIButtonBreathing: () => this.setReloadUIButtonBreathing(),
            postReloadUI: () => this.postReloadUI(),
            genNewSnippetId: () => this.genNewSnippetId(),
        });

        // 初始化导入导出服务（列表读写/菜单刷新等经动作转发，调用时读取运行态）
        this.importExportService = new ImportExportService({
            logger: this.console,
            displayName: () => this.displayName,
            i18n: () => this.i18n,
            snippetsType: () => this.snippetsType,
            snippetsList: () => this.snippetsList,
            menuOpen: () => !!this.menu,
            showErrorMessage: (message, timeout, id) => this.showErrorMessage(message, timeout, id),
            genNewSnippetId: () => this.genNewSnippetId(),
            getSnippetsList: () => this.getSnippetsList(),
            saveSnippetsList: (snippetsList) => this.saveSnippetsList(snippetsList),
            storeReplaceAll: (snippetsList) => this.snippetStore.replaceAll(snippetsList),
            refreshMenuSnippetsType: () => this.setMenuSnippetsType(this.snippetsType),
        });

        // 初始化通知/错误提示服务（配置开关读取经实例 defineProperty 镜像转发）
        this.feedbackService = new FeedbackService({
            displayName: () => this.displayName,
            i18n: () => this.i18n,
            readConfig: (key) => (this as any)[key],
        });

        // 初始化事件监听器簿记（状态存于 jcsm 跨 reload 存活；addListener/removeListener 经实例委托到它）
        this.listenerRegistry = new ListenerRegistry({
            logger: this.console,
            consoleDebug: () => this.consoleDebug,
            checkThemeWatch: () => this.editorManager.checkAndManageThemeWatch(),
            isDialogOrMenuOpen: () => this.isDialogAndMenuOpen(),
        });

        // 订阅代码片段列表变更事件：菜单打开时刷新各类型计数
        this.internalEventBus.on(SNIPPETS_CHANGED, (_snippetId: string) => {
            this.setMenuSnippetCount();
        });
    }

    /**
     * 顶栏按钮位置
     */
    declare topBarPosition: "left" | "right";

    /**
     * 初始化顶栏按钮
     */
    private async topBarInit() {
        const topBarKeymap = this.getCustomKeymapByCommand("openSnippetsManager");
        const title = !this.isMobile && topBarKeymap ? this.displayName + " " + platformUtils.updateHotkeyTip(topBarKeymap) : this.displayName;
        this.topBarElement = this.addTopBar({
            icon: "iconJcsm",
            title: title,
            position: this.topBarPosition || "right",
            callback: () => {
                this.openSnippetsManager();
            }
        });
    }

    // 顶栏按钮点击回调：打开代码片段管理器
    private openSnippetsManager = async () => {
        if (this.getAllModalDialogElements().length > 0) return;
        await this.openMenu();
    };

    /**
     * 布局加载完成
     */
    public async onLayoutReady() {
        // 初始化 window.siyuan.jcsm
        window.siyuan.jcsm ??= {}; // ??= 逻辑空赋值运算符 https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing_assignment

        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";
        this.isTouchDevice = ("ontouchstart" in window) && navigator.maxTouchPoints > 1;

        // 优先初始化插件设置，因为顶栏按钮位置需要根据插件设置来决定
        await this.configService.init();
        this.setting = this.configService.setting!;
        // 插件设置加载之后启动文件监听
        if (this.fileWatchEnabled && this.fileWatchEnabled !== "disabled") {
            this.fileWatchService.start();
        }
        // 插件设置加载之后暴露 ignoreNotice 方法到全局
        window.siyuan.jcsm.disableNotification = (messageI18nKey) => this.configService.disableNotification(messageI18nKey);

        // 顶栏按钮图标
        this.addIcons(`
            <symbol id="iconJcsm" viewBox="0 0 32 32">
                <path d="M23.498 9.332c-0.256 0.256-0.415 0.611-0.415 1.002s0.159 0.745 0.415 1.002l4.665 4.665-4.665 4.665c-0.256 0.256-0.415 0.61-0.415 1.002s0.159 0.745 0.415 1.002v0c0.256 0.256 0.61 0.415 1.002 0.415s0.745-0.159 1.002-0.415l5.667-5.667c0.256-0.256 0.415-0.611 0.415-1.002s-0.158-0.745-0.415-1.002l-5.667-5.667c-0.256-0.256-0.61-0.415-1.002-0.415s-0.745 0.159-1.002 0.415v0z"></path>
                <path d="M7.5 8.917c-0.391 0-0.745 0.159-1.002 0.415l-5.667 5.667c-0.256 0.256-0.415 0.611-0.415 1.002s0.158 0.745 0.415 1.002l5.667 5.667c0.256 0.256 0.611 0.415 1.002 0.415s0.745-0.159 1.002-0.415v0c0.256-0.256 0.415-0.61 0.415-1.002s-0.159-0.745-0.415-1.002l-4.665-4.665 4.665-4.665c0.256-0.256 0.415-0.611 0.415-1.002s-0.159-0.745-0.415-1.002v0c-0.256-0.256-0.61-0.415-1.002-0.415v0z"></path>
                <path d="M19.965 3.314c-0.127-0.041-0.273-0.065-0.424-0.065-0.632 0-1.167 0.413-1.35 0.985l-0.003 0.010-7.083 22.667c-0.041 0.127-0.065 0.273-0.065 0.424 0 0.632 0.413 1.167 0.985 1.35l0.010 0.003c0.127 0.041 0.273 0.065 0.424 0.065 0.632 0 1.167-0.413 1.35-0.985l0.003-0.010 7.083-22.667c0.041-0.127 0.065-0.273 0.065-0.424 0-0.632-0.413-1.167-0.985-1.35l-0.010-0.003z"></path>
            </symbol>
        `);

        this.topBarInit().then();

        // 注册快捷键（都默认置空）
        this.addCommand({
            langKey: "openSnippetsManager", // 打开代码片段管理器
            hotkey: "",
            callback: () => {
                // 快捷键唤起菜单时，如果菜单已经打开，要先关闭再重新打开，所以这里直接执行就好，会自动关闭菜单再重开
                this.openSnippetsManager();
            },
        });
        this.addCommand({
            langKey: "reloadUI", // 重新加载界面
            hotkey: "",
            callback: () => {
                this.reloadUI();
            },
        });

        console.log(this.displayName, this.i18n.pluginOnload);

        // 调试
        // await new Promise(resolve => setTimeout(resolve, 10000));

        // TODO自定义页签: 添加自定义标签页
        // this.custom = this.addTab({
        //     type: TAB_TYPE,
        //     init() {
        //         this.element.innerHTML = `<div class="jcsm__custom-tab">${this.data.text}</div>`;
        //     },
        //     beforeDestroy() {
        //         this.console.log("在销毁标签页之前:", TAB_TYPE);
        //         // TODO自定义页签: 销毁标签页时，需要获取当前页签的数据然后处理（比如保存）
        //     },
        //     destroy() {
        //         this.console.log("销毁标签页:", TAB_TYPE);
        //     }
        // });
        // 获取已打开的所有自定义页签
        // this.getOpenedTab();

        // 初始化跨窗口同步服务用于跨窗口通信（需要等插件设置加载完成；传输 + 窗口保活 + 业务分发收敛于 services/sync.ts）
        this.syncService = new BroadcastService({
            logger: this.console,
            handlers: {
                snippet_toggle: async ({snippetId, enabled}) => {
                    // 远程开关：先自拉权威数据（协议不含片段原文），再走与本地相同的 toggleSnippet 路径
                    const snippet = await this.getSnippetById(snippetId);
                    if (!snippet) {
                        this.console.error("snippet_toggle: Snippet not found:", snippetId);
                        return;
                    }
                    await this.toggleSnippet(snippet, enabled, "remote");
                },
                snippet_toggle_publish: ({snippetId, enabled}) => this.toggleSnippetPublish(snippetId, enabled, "remote"),
                snippet_toggle_global: ({snippetType, enabled, previewingSnippetIds}) =>
                    this.globalToggleSnippet(snippetType, enabled, "remote", previewingSnippetIds),
                snippet_save: async (payload) => {
                    // 协议不含片段原文：接收窗口一律按 ID 自拉权威数据后，再与本地保存走同一路径（origin 为 remote）
                    const {snippetId, isCopy, copySnippetId} = payload;
                    if (!snippetId || isCopy === undefined || (isCopy && !copySnippetId)) {
                        this.console.error("snippet_save: Snippet or isCopy is missing:", payload);
                        return;
                    }
                    this.console.log("snippet_save", {snippetId, isCopy, copySnippetId});
                    if (isCopy) {
                        // 复制：先按副本 ID 自拉服务端权威数据（getSnippetById 副作用刷新列表为权威顺序），
                        // 被复制原片段作为菜单项插入锚点，从刷新后的列表取
                        const copySnippet = await this.getSnippetById(copySnippetId!);
                        if (!copySnippet) {
                            this.console.error("snippet_save: copySnippet not found:", copySnippetId);
                            return;
                        }
                        const originalSnippet = this.snippetsList.find((s: Snippet) => s.id === snippetId);
                        if (!originalSnippet) {
                            this.console.error("snippet_save: original snippet not found:", snippetId);
                            return;
                        }
                        await this.saveSnippet(originalSnippet, true, "remote", copySnippet);
                        return;
                    }
                    // 更新/新增：先在自拉前捕获本窗口旧片段（自拉会刷新列表为权威态，旧片段将不可再取），再自拉权威新态
                    const oldSnippet = this.snippetsList.find((s: Snippet) => s.id === snippetId);
                    const snippet = await this.getSnippetById(snippetId);
                    if (snippet === false || snippet === undefined) {
                        this.console.error("snippet_save: Snippet not found:", snippetId);
                        return;
                    }
                    await this.saveSnippet(snippet, false, "remote", undefined, oldSnippet);
                },
                snippet_delete: ({snippetId, snippetType, previewState}) =>
                    this.deleteSnippet(snippetId, snippetType, "remote", previewState),
                snippet_element_update: async ({snippet, snippetId, previewState}) => {
                    // 预览放行原文（豁免）：snippet 来自消息体（编辑中内容未保存、无法自拉）；
                    // 未携带原文（退出预览）时按 ID 自拉已保存片段恢复
                    let realSnippet = snippet;
                    if (!realSnippet) {
                        const fetchedSnippet = await this.getSnippetById(snippetId!);
                        if (fetchedSnippet === false || fetchedSnippet === undefined) {
                            this.console.error("snippet_element_update: Snippet not found:", snippetId);
                            return;
                        }
                        realSnippet = fetchedSnippet;
                    }
                    await this.updateSnippetElement(realSnippet, undefined, previewState);
                    this.console.log("snippet_element_update: updated snippet element for", realSnippet.id);
                },
                snippet_element_remove: ({snippetId, snippetType}) => this.removeSnippetElement(snippetId, snippetType),
                snippets_sort: async () => {
                    this.console.log("snippetsSortSync");
                    // 重新加载代码片段列表（读取权威态语义）并刷新菜单
                    this.snippetsList = await this.getSnippetsList() as Snippet[];
                    this.menuItems && this.initSnippetsContainer();
                },
            },
        });
        await this.syncService.start();
    }

    /**
     * 插件存储数据变更（思源内核推送 reloadPlugin(dataChangePlugins) 后由前端调用本方法）
     * 思源前端 loader 按「插件是否覆盖了基类 onDataChanged」决定数据变更时的处置：
     * 未覆盖则重载整个插件，覆盖则调用本方法。因此本覆盖必须保留——插件保存/同步配置触发数据变更时，
     * 若走整插件 reload 会丢失运行态（已打开的 Dialog / CodeMirror 编辑器）。
     * 触发来源（思源 ≥ 2a11f8ab，siyuan#19132，前端调用时携带 reason）：
     *  - sync（跨设备）：其他设备写入插件配置后经数据仓库合并拉回本机，内核推 dataChange；
     *  - overwrite（同内核其他前端实例）：其他实例经文件接口写入 data/storage/petal/snippets/，
     *    内核按发起实例附带的 app 排除其自身后推送本实例（发起方自己不会收到）。
     * 两类来源对本插件的处置相同——都要重新读取配置并热应用（ConfigService.reloadFromStorage 内部
     * 按值 diff，无变化不触发 onApply 副作用），故本方法不接收 reason 参数做区分。
     * 说明：跨窗口配置同步不再依赖自建广播——思源自 2a11f8ab（siyuan#19132）起，任何实例经文件接口
     * 写入插件配置都会触发内核推送（reason=overwrite，含发起实例自身以外的所有实例），本方法即同步入口；
     * 此前的 setting_apply 广播与 applySettingSync 已随该内核能力退役（插件重构以最新思源代码为基准）。
     */
    public async onDataChanged() {
        // 重新读取配置并热应用（applyConfig 内部按值 diff，无变化不触发 onApply 副作用）
        await this.configService.reloadFromStorage();
    }

    /**
     * 禁用插件
     * 插件更新会先执行 onunload 再执行 onload，不会执行 uninstall
     */
    public onunload() {
        // 取消该实例注册的全部事件订阅
        this.internalEventBus.clear();

        // 关闭跨窗口同步服务（发送下线通知并断开连接）
        this.syncService?.stop();

        // 停止主题模式监听
        this.editorManager?.stopThemeModeWatch();

        // 移除菜单
        this.menu?.close();

        // 停止文件监听
        this.fileWatchService.stop();

        console.log(this.displayName, this.i18n.pluginOnunload);
    }

    /**
     * 卸载插件
     */
    public uninstall() {
        // 关闭跨窗口同步服务（发送下线通知并断开连接）
        this.syncService?.stop();

        // 移除配置文件
        const response = this.removeData(STORAGE_NAME) as any;
        if (!isPromiseFulfilled(response)) {
            // 写入失败
            this.showErrorMessage(this.i18n.removeConfigFailed + " [" + response?.code + ": " + response?.msg + "]", 20000, "error");
            return;
        }

        // 移除所有 Dialog
        document.querySelectorAll(".b3-dialog--open[data-key^='jcsm-']").forEach((dialogElement: HTMLElement) => {
            this.closeDialogByElement(dialogElement);
        });

        // 移除 CodeMirror 编辑器样式
        const styleElements = Array.from(document.head.querySelectorAll("style")) as HTMLStyleElement[];
        for (const styleElement of styleElements) {
            if (styleElement.textContent?.includes(".cm-content")) {
                styleElement.remove();
                break;
            }
        }

        // 移除菜单
        this.menu?.close();

        // 停止文件监听
        this.fileWatchService.stop();

        // TODO自定义页签: 移除所有自定义页签

        // 停止主题模式监听
        this.editorManager?.stopThemeModeWatch();

        // 移除所有监听器
        this.listenerRegistry.destroy();

        // 最后移除全局变量
        delete window.siyuan.jcsm;

        console.log(this.displayName, this.i18n.pluginUninstall);
    }


    // ================================ 插件设置 ================================

    /**
     * 插件设置
     */
    public setting!: Setting;

    /**
     * 配置文件版本（配置结构有变化时升级）
     */
    private version = 1;

    /**
     * CSS 代码片段实时预览（必须与 snippet.type === "css" 一起使用）
     */
    private realTimePreview!: boolean;

    /**
     * 新建代码片段时默认启用
     */
    private newSnippetEnabled!: boolean;

    /**
     * 在开发者工具中输出插件日志
     */
    private consoleDebug!: boolean;

    /**
     * 配置项定义（类型定义与条目构建见 src/config/schema.ts）
     */
    private configItems: SnippetsConfigItem[] = [];

    /**
     * 初始化配置项（条目定义见 src/config/schema.ts，此处仅构建一次并挂到实例）
     * 注意在这里面不能用 this.console 之类的方法，因为它们需要先加载完插件配置才能用
     */
    private async initConfigItems() {
        if (this.configItems.length > 0) {
            // 已构建过则直接复用（构建结果与运行态无关，运行态由读取器/动作函数实时转发）
            return;
        }
        this.configItems = createSnippetsConfigItems({
            isMobile: () => this.isMobile,
            i18n: () => this.i18n,
            menuItems: () => this.menuItems,
            menuOpen: () => !!this.menu,
            menuSnippetsItemsHtml: () => this.genMenuSnippetsItems(),
            updateAllEditorConfigs: (reason) => this.editorManager.updateAllEditorConfigs(reason),
            removeTopBarElement: () => this.topBarElement?.remove(),
            initTopBar: () => this.topBarInit(),
            setMenuPosition: (isUpdate) => this.setMenuPosition(isUpdate),
            startFileWatch: () => this.fileWatchService.start(),
            stopFileWatch: () => this.fileWatchService.stop(),
            handleFileWatchPathChange: () => void this.fileWatchService.handlePathChange(),
            handleFileWatchIntervalChange: () => this.fileWatchService.handleIntervalChange(),
        });
    }

    /**
     * 打开插件设置窗口（装配与交互见 src/ui/setting-dialog.ts SettingDialog）
     * 方法名固定为 openSetting，支持通过菜单按钮打开、被思源调用打开
     */
    public openSetting() {
        this.settingDialog.open();
    }


    // ================================ 顶栏菜单 ================================

    /**
     * 顶栏菜单对象 this.menu.element === #commonMenu，菜单关闭时 === undefined
     */
    private menu!: Menu;

    /**
     * 菜单列表容器 #commonMenu > .b3-menu__items
     */
    private menuItems!: HTMLElement;

    /**
     * 打开顶栏菜单
     */
    private async openMenu() {
        this.menu = new Menu("PluginSnippets", () => {
            // 此处会在菜单被关闭（this.menu.close();）时执行
            this.closeMenuCallback();
        });

        // 如果菜单已存在，再次点击按钮就会移除菜单，此时直接返回
        if (this.menu.isOpen) {
            this.menu = undefined as unknown as Menu;
            if (!this.isMobile && this.topBarElement && this.topBarElement.matches(":hover")) {
                // 只有当鼠标悬停在顶栏按钮上时才显示 tooltip
                showElementTooltip(this.topBarElement);
            }
            return;
        }

        // 获取代码片段列表
        this.console.log("openMenu: 获取代码片段列表");
        const snippetsList = await this.getSnippetsList();
        if (snippetsList) {
            this.snippetsList = snippetsList;
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
<button class="block__icon block__icon--show fn__flex-center ariaLabel${this.snippetSearchType === 0 ? " fn__none" : ""}" data-type="search" data-position="north" aria-label="${this.i18n.search}"><svg><use xlink:href="#iconSearch"></use></svg></button>
<button class="block__icon block__icon--show fn__flex-center ariaLabel" data-type="config" data-position="north"><svg><use xlink:href="#iconSettings"></use></svg></button>
<button class="block__icon block__icon--show fn__flex-center ariaLabel${this.isReloadUIRequired ? " jcsm-breathing" : ""}" data-type="reload" data-position="north"><svg><use xlink:href="#iconRefresh"></use></svg></button>
<button class="block__icon block__icon--show fn__flex-center ariaLabel" data-type="new" data-position="north"><svg><use xlink:href="#iconAdd"></use></svg></button>
<span class="fn__space"></span>
<input class="jcsm-switch jcsm-all-snippets-switch b3-switch fn__flex-center" type="checkbox">
        `;

        // TODO功能: 加一个全局的 publishSwitch 开关，批量修改代码片段的 disabledInPublish 字段

        const radio = menuTop.querySelector(`[data-snippet-type="${this.snippetsType}"]`) as HTMLInputElement;
        radio.checked = true;
        const settingsButton = menuTop.querySelector("button[data-type='config']") as HTMLButtonElement;
        settingsButton.setAttribute("aria-label", this.i18n.pluginConfig);
        const newSnippetButton = menuTop.querySelector("button[data-type='new']") as HTMLButtonElement;
        newSnippetButton.setAttribute("aria-label", this.i18n.add + " " + this.snippetsType.toUpperCase());
        const reloadUIButton = menuTop.querySelector("button[data-type='reload']") as HTMLButtonElement;
        const reloadUIKeymap = this.getCustomKeymapByCommand("reloadUI");
        reloadUIButton.setAttribute("aria-label", (!this.isMobile && reloadUIKeymap) ? this.i18n.reloadUI + " " + platformUtils.updateHotkeyTip(reloadUIKeymap) : this.i18n.reloadUI);

        this.menuItems.append(menuTop);

        // 插入搜索输入框
        const searchInput = '<input class="jcsm-snippets-search b3-text-field fn__none" data-action="search" type="text">';
        this.menuItems.insertAdjacentHTML("beforeend", searchInput);

        // 初始化代码片段列表容器
        this.initSnippetsContainer();

        this.setMenuSnippetCount();
        this.setMenuSnippetsType(this.snippetsType);
        this.setAllSnippetsEditButtonActive();

        // 事件监听
        this.addListener(this.menu.element, "click", this.menuClickHandler);
        this.addListener(this.menu.element, "mousedown", () => {
            // 点击菜单时要显示在最上层
            moveElementToTop(this.menu.element);
        });
        this.addListener(this.menu.element, "input", (event: InputEvent) => {
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

                if (!this.isMobile) {
                    // 设置当前选中项
                    this.setMenuSelection(this.snippetsType);
                }
            }
        });
        // 监听按键操作，在选项上按回车时切换开关/特定交互、按 Delete 时删除代码片段、按 Tab 可以在各个可交互的元素上轮流切换
        // 处理太麻烦，先不做了，有其他人需要再说
        this.addListener(document.documentElement, "keydown", this.globalKeyDownHandler);
        // 添加鼠标事件监听（用于桌面端拖拽排序）
        this.addListener(this.menu.element, "mousedown", (event: MouseEvent) => {
            this.menuMousedownHandler(event);
        });
        // 添加触摸事件监听（用于移动端拖拽排序）
        this.addListener(this.menu.element, "touchstart", (event: TouchEvent) => {
            this.menuTouchstartHandler(event);
        }, { passive: true });

        // 弹出菜单
        if (this.isMobile) {
            this.menu.fullscreen();
        } else {
            this.setMenuPosition();
        }
    }

    /**
     * 初始化代码片段列表容器
     */
    private initSnippetsContainer() {
        // 插入代码片段列表容器
        const snippetsContainer = document.createElement("div");
        snippetsContainer.className = "jcsm-snippets-container";
        snippetsContainer.insertAdjacentHTML("beforeend", this.genMenuSnippetsItems());
        this.menuItems.querySelector(".jcsm-snippets-container")?.remove();
        this.menuItems.append(snippetsContainer);

        // “添加第一个 CSS 代码片段”的菜单项
        const newCssSnippetButton = htmlToElement(`<div class="jcsm-snippet-item b3-menu__item" data-type="new" data-snippet-type="css">${this.i18n.addFirstCSSSnippet}</div>`);
        snippetsContainer.appendChild(newCssSnippetButton);
        // “添加第一个 JS 代码片段”的菜单项
        const newJsSnippetButton = htmlToElement(`<div class="jcsm-snippet-item b3-menu__item" data-type="new" data-snippet-type="js">${this.i18n.addFirstJSSnippet}</div>`);
        snippetsContainer.appendChild(newJsSnippetButton);
    }

    /**
     * 设置菜单位置
     * @param isUpdate 是否仅更新菜单位置
     */
    private setMenuPosition(isUpdate = false) {
        this.console.log("setMenuPosition: isUpdate =", isUpdate);

        let rect = this.topBarElement.getBoundingClientRect();
        // 如果被隐藏，则使用更多按钮
        if (rect.width === 0) {
            rect = document.querySelector("#barMore")!.getBoundingClientRect();
        }
        if (rect.width === 0) {
            rect = document.querySelector("#barPlugins")!.getBoundingClientRect();
        }

        // this.topBarPosition 不存在的时候就默认为 right
        const dock = this.topBarPosition === "left" ? document.querySelector("#dockLeft") : document.querySelector("#dockRight");
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
        if (this.topBarPosition === "left") {
            this.menu.element.style.right = "";
            this.menu.element.style.left = dockWidth;
        } else {
            this.menu.element.style.right = dockWidth;
            this.menu.element.style.left = "";
        }

        // 顶栏按钮样式
        if (!this.isMobile && this.topBarElement) {
            this.topBarElement.classList.add("toolbar__item--active");
            // 移除 aria-label 属性，在菜单打开时不显示 tooltip
            this.topBarElement.removeAttribute("aria-label");
            hideTooltip();
        }
    }

    /**
     * 是否启用自动重新加载界面功能
     */
    declare autoReloadUIAfterModifyJS: boolean;

    /**
     * 关闭顶栏菜单回调
     */
    private closeMenuCallback() {
        if (this.topBarElement) {
            // topBarElement 不存在时说明 this.isMobile 为 true，此时不需要修改顶栏按钮样式
            this.topBarElement.classList.remove("toolbar__item--active");
            // topBarCommand 有可能变，所以每次都重新获取
            const topBarKeymap = this.getCustomKeymapByCommand("openSnippetsManager");
            const title = topBarKeymap ? this.displayName + " " + platformUtils.updateHotkeyTip(topBarKeymap) : this.displayName;
            this.topBarElement.setAttribute("aria-label", title);
        }

        // 移除事件监听
        this.removeListener(this.menu.element);
        this.menu = undefined as unknown as Menu;
        this.destroyGlobalKeyDownHandler();

        // 自动重新加载界面
        if (this.autoReloadUIAfterModifyJS && this.isReloadUIRequired && !document.querySelector(".b3-dialog--open[data-key='jcsm-snippet-dialog']")) {
            this.postReloadUI();
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
     * 点击代码片段选项的行为
     * 0：无操作
     * 1：切换代码片段开关状态
     * 2：打开代码片段编辑器
     */
    declare snippetOptionClickBehavior: number;

    /**
     * 菜单点击事件处理
     * @param event 鼠标事件
     */
    private menuClickHandler = async (event: MouseEvent) => {
        // 如果正在拖拽或拖拽回到原位，则不执行点击逻辑
        if (this.isDragging) {
            this.console.log("menuClickHandler: During drag operation, ignore click events.");
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
            this.console.log("menuClickHandler event:", event);
            if (event.detail=== "Escape") {
                // 按 Esc 关闭菜单
                this.menu.close();
            } else if (event.detail === "Enter") {
                const snippetElement = this.menuItems.querySelector(".b3-menu__item--current") as HTMLElement;
                const type = snippetElement?.dataset.type;
                if (snippetElement) {
                    if (type === "new") {
                        // 按回车新建代码片段
                        this.createSnippet();
                    } else {
                        // 按回车切换代码片段的开关状态
                        const input = snippetElement.querySelector("input[type='checkbox']") as HTMLInputElement;
                        const snippet = await this.getSnippetById(snippetElement.dataset.id!);
                        if (input && snippet) {
                            input.checked = !input.checked;
                            void this.toggleSnippet(snippet, input.checked);
                        }
                    }
                }
            } else if (event.detail === "ArrowUp" || event.detail === "ArrowDown") {
                // 按上下方向键切换代码片段选项
                // 获取当前代码片段类型的所有可见菜单项（排除带有 .fn__none 类的元素）
                const visibleMenuItems = Array.from(this.menuItems.querySelectorAll(`.jcsm-snippet-item[data-type="${this.snippetsType}"]:not(.fn__none)`)) as HTMLElement[];
                const currentMenuItem = this.menuItems.querySelector(".b3-menu__item--current") as HTMLElement;

                // 如果当前代码片段类型没有可见的 .jcsm-snippet-item 元素，则选中新建按钮
                if (visibleMenuItems.length === 0) {
                    const newSnippetButton = this.menuItems.querySelector(`.jcsm-snippet-item[data-type="new"][data-snippet-type="${this.snippetsType}"]`) as HTMLElement;
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
                const newType = this.snippetsType === "css" ? "js" : "css";

                // 切换选项卡元素
                const newTypeRadio = this.menuItems.querySelector(`[data-snippet-type="${newType}"]`) as HTMLInputElement;
                if (newTypeRadio) {
                    newTypeRadio.checked = true;
                }

                // 切换代码片段类型
                this.snippetsType = newType;
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
                    this.snippetsType = type;
                    this.setMenuSnippetsType(type);
                }
            }

            // 切换全局开关（snippetType 取当前菜单显示的类型，与旧实现内部 this.snippetsType 一致）
            if (target.classList.contains("jcsm-all-snippets-switch")) {
                void this.globalToggleSnippet(this.snippetsType, (target as HTMLInputElement).checked);
            }

            // 点击顶部的按钮
            if (tagName === "button") {
                const type = target.dataset.type;
                if (type === "search") {
                    // 显示或隐藏搜索输入框
                    const searchInput = this.menuItems.querySelector("input[data-action='search']") as HTMLInputElement;
                    if (this.snippetSearchType !== 0 && searchInput) {
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
                            const placeholderText = this.snippetSearchType === 0 ? this.i18n.search :
                                this.i18n[["snippetSearchTypeName", "snippetSearchTypeContent", "snippetSearchTypeNameAndContent"][this.snippetSearchType - 1]];
                            searchInput.setAttribute("placeholder", placeholderText);
                            searchInput.classList.remove("fn__none");
                            searchInput.focus();
                        }
                    }
                } else if (type === "config") {
                    // 打开设置对话框
                    this.openSetting();
                } else if (type === "reload") {
                    // 重新加载界面
                    this.reloadUI();
                } else if (type === "new") {
                    // 新建代码片段
                    this.createSnippet();
                }
            }
        }

        // 点击代码片段
        const snippetMenuItem = target.closest(".b3-menu__item") as HTMLElement;
        if (snippetMenuItem) {
            if (tagName === "button") {
                // 点击按钮

                // 点击按钮不会改变代码片段的开关状态，所以直接从 this.snippetsList 中获取当前代码片段
                const snippet = await this.getSnippetById(snippetMenuItem.dataset.id!);
                if (snippet === undefined) {
                    // undefined 是数组中没有
                    this.showErrorMessage(this.i18n.getSnippetFailed);
                    return;
                } else if (snippet === false) {
                    // false 是调用 API 返回错误
                    return;
                }

                const buttonType = target.dataset.type;
                if (buttonType === "duplicate") {
                    // 创建代码片段副本
                    void this.saveSnippet(snippet, true);
                } else if (buttonType === "edit") {
                    // 编辑代码片段，打开编辑对话框
                    void this.openSnippetEditDialog(snippet);
                    // TODO自定义页签: 编辑页签，等其他功能稳定之后再做
                } else if (buttonType === "delete") {
                    // 删除代码片段
                    this.openSnippetDeleteDialog(snippet.name, () => {
                        // 弹窗确定后删除代码片段
                        this.deleteSnippet(snippet.id!, snippet.type);
                    }); // 取消后无操作
                } else {
                    // 点击到不知道哪里的按钮，显示错误信息
                    this.showErrorMessage(this.i18n.unknownButtonType);
                }
            } else if (tagName === "input") {
                // 点击开关
                const type = target.dataset.type;
                if (type === "snippetSwitch") {
                    const snippet = await this.getSnippetById(snippetMenuItem.dataset.id!);
                    if (snippet) {
                        void this.toggleSnippet(snippet, (target as HTMLInputElement).checked);
                    }
                } else if (type === "publishSwitch") {
                    const snippet = await this.getSnippetById(snippetMenuItem.dataset.id!);
                    if (snippet) {
                        void this.toggleSnippetPublish(snippet.id, !(target as HTMLInputElement).checked);
                    }
                }
            } else if (target.getAttribute("data-type") === "new") {
                // 点击“添加第一个代码片段”按钮，新建代码片段
                this.createSnippet();
            } else {
                // 点击代码片段的菜单项
                if (this.snippetOptionClickBehavior === 1) {
                    // 切换代码片段的开关状态
                    const snippetSwitchCheckBox = snippetMenuItem.querySelector("input[data-type='snippetSwitch']") as HTMLInputElement;
                    snippetSwitchCheckBox.checked = !snippetSwitchCheckBox.checked;
                    const snippet = await this.getSnippetById(snippetMenuItem.dataset.id!);
                    if (snippet) {
                        void this.toggleSnippet(snippet, snippetSwitchCheckBox.checked);
                    }
                } else if (this.snippetOptionClickBehavior === 2) {
                    // 打开代码片段编辑器
                    const snippet = await this.getSnippetById(snippetMenuItem.dataset.id!);
                    if (snippet === undefined) {
                        // undefined 是数组中没有
                        this.showErrorMessage(this.i18n.getSnippetFailed);
                        return;
                    } else if (snippet === false) {
                        // false 是调用 API 返回错误
                        return;
                    }
                    void this.openSnippetEditDialog(snippet);
                }
            }

            if (this.isMobile) {
                // 移动端点击之后一直高亮着选项不好看，所以清除选中状态
                this.clearMenuSelection();
            }
        }
    };

    /**
     * 切换代码片段的开关状态（本地操作与跨窗口同步共用同一路径，阶段 3：消灭 toggleSnippetSync 镜像）
     * - 本地（origin 缺省为 local）：改内存 → 落库 → 更新元素 → 广播；若已打开该片段的 CSS 实时预览
     *   对话框，则跳过广播（开关状态由预览中的对话框接管，广播方窗口不推送）；
     * - 远程（origin 为 remote）：广播窗口已落库，本窗口仅同步元素与菜单开关 UI，不落库、不广播。
     * @param snippet 代码片段（本地取自列表/自拉；远程为按 snippetId 自拉的权威对象）
     * @param enabled 是否启用
     * @param origin 变更来源：local（本窗口操作）| remote（其他窗口广播）
     */
    private async toggleSnippet(snippet: Snippet, enabled: boolean, origin: "local" | "remote" = "local") {
        // 在菜单上切换代码片段的开关状态要实时保存
        snippet.enabled = enabled;

        if (origin === "remote") {
            this.console.log("Handling switch state synchronization:", {snippetId: snippet.id, enabled});
            // 更新代码片段元素
            await this.updateSnippetElement(snippet);

            // 更新菜单中的开关状态（如果菜单已打开）
            if (this.menuItems) {
                const checkbox = this.menuItems.querySelector(`.jcsm-snippet-item[data-id="${snippet.id}"] input[data-type='snippetSwitch']`) as HTMLInputElement;
                checkbox && (checkbox.checked = enabled);
                this.console.log("toggleSnippetSync: checkbox", checkbox, "enabled", enabled);
            }
            return;
        }

        void this.saveSnippetsList(this.snippetsList);
        void this.updateSnippetElement(snippet);

        if (snippet.type === "css" && this.realTimePreview && document.querySelector(`.b3-dialog--open[data-key="jcsm-snippet-dialog"][data-snippet-id="${snippet.id}"]`)) {
            // 如果开启了实时预览，并且打开了对应的 CSS 代码片段对话框，则在菜单项上开关代码片段的操作需要忽略，不广播开关状态变更到其他窗口
            return;
        }

        // 广播开关状态变更到其他窗口
        this.syncService?.broadcast({
            type: "snippet_toggle",
            snippetId: snippet.id,
            enabled: snippet.enabled,
        });
    }

    /**
     * 切换代码片段的发布服务开关状态（本窗口操作与同内核其他前端实例广播共用同一路径，阶段 3：消灭 toggleSnippetPublishSync 镜像）
     * 说明：这里所说的“跨窗口同步”指同一内核的不同前端实例（多 Electron 窗口 / 浏览器标签页 /
     * 移动端均连同一内核 WebSocket）；广播消息即“来自其他前端实例”，非跨设备同步。
     * 载荷 enabled 字段语义即 disabledInPublish（与 services/sync.ts 载荷注释保持一致）：
     * 为 true 表示“不在发布服务中显示”，为 false 表示“允许发布”。
     * - 本窗口操作（origin 缺省为 local）：本窗口菜单发布开关（普通编辑前端；发布站点不加载插件，
     *   issue #33）。就地改 disabledInPublish → 落库 → 广播；
     * - 同内核其他前端实例广播（origin 为 remote）：广播实例已落库，本实例不落库、不广播，仅同步自身状态：
     *   - 当前实例为发布站点（window.siyuan.isPublish 为 true）：维护发布界面中的注入元素——
     *     标记为“不在发布中显示”时按需添加元素，标记为“允许发布”时强制移除元素并从 Store 删除
     *     （原实现保留，含 issue #33 TODO；现状发布站点不加载插件，此分支实际不可达）；
     *   - 当前实例为普通编辑前端（window.siyuan.isPublish 为 false）：发布开关仅是无副作用的元数据
     *     （记录将来发布时该片段是否显示），不更新注入元素，仅就地改 disabledInPublish 并同步菜单 publishSwitch。
     * @param snippetId 代码片段 ID
     * @param enabled 是否禁用发布（即 disabledInPublish）
     * @param origin 变更来源：local（本窗口操作）| remote（同内核其他前端实例广播）
     */
    private async toggleSnippetPublish(snippetId: string, enabled: boolean, origin: "local" | "remote" = "local") {
        this.console.log("toggleSnippetPublish:", { snippetId, enabled, origin });

        if (origin === "local") {
            // 本窗口操作：菜单发布开关（本窗口调用点总是先 getSnippetById 自拉成功，片段必在列表中）
            const snippet = this.snippetsList.find((s: Snippet) => s.id === snippetId);
            if (!snippet) {
                this.console.error("toggleSnippetPublish: Snippet not found:", snippetId);
                return;
            }
            snippet.disabledInPublish = enabled;
            void this.saveSnippetsList(this.snippetsList);
            // void this.updateSnippetElement(snippet); // 发布服务开关状态变更不需要更新元素

            this.syncService?.broadcast({
                type: "snippet_toggle_publish",
                snippetId: snippet.id,
                enabled: snippet.disabledInPublish,
            });
            return;
        }

        // 同内核其他前端实例广播（origin 为 remote）
        if (this.isPublish()) {
            // 当前实例为发布站点
            // TODO功能: 支持在发布服务启用插件 https://github.com/TCOTC/snippets/issues/33
            if (enabled) {
                // enabled（disabledInPublish=true，不在发布中显示）：添加 snippet（由 updateSnippetElement 判断是否需要添加元素）
                const snippet = await this.getSnippetById(snippetId);
                if (snippet) {
                    await this.updateSnippetElement(snippet);
                }
            } else {
                // enabled=false（允许发布）：移除 snippet 的注入元素并从 Store 删除
                const snippet = this.snippetsList.find((s: Snippet) => s.id === snippetId);
                if (snippet) {
                    await this.updateSnippetElement(snippet, false); // 必须移除元素
                    // 从 Store 中删除：统一更新列表并触发计数刷新事件
                    this.snippetStore.remove(snippetId);
                }
            }
            return;
        }

        // 当前实例为普通编辑前端：发布开关仅是元数据，不影响本实例注入元素，所以不优先获取最新的代码片段
        let snippet: Snippet | undefined | false = this.snippetsList.find((s: Snippet) => s.id === snippetId);
        if (!snippet) {
            snippet = await this.getSnippetById(snippetId);
            await this.updateSnippetElement(snippet);
        }
        if (snippet) {
            snippet.disabledInPublish = enabled;
        } else {
            this.console.error("toggleSnippetPublish: Snippet not found:", snippetId);
        }

        // 更新菜单中的开关状态（如果菜单已打开）
        // 注意：菜单 publishSwitch 的勾选语义为“允许发布”（checked = !disabledInPublish），
        // 而广播载荷 enabled 的语义为 disabledInPublish，故此处必须取反
        if (!this.menuItems) return;
        const checkbox = this.menuItems.querySelector(`.jcsm-snippet-item[data-id="${snippetId}"] input[data-type='publishSwitch']`) as HTMLInputElement;
        checkbox && (checkbox.checked = !enabled);
        this.console.log("toggleSnippetPublish: checkbox", checkbox, "enabled", enabled);
    }

    /**
     * 切换某类型代码片段的全局开关状态（本地操作与跨窗口同步共用，阶段 3：消灭 globalToggleSnippetSync 镜像）
     * - 本地（origin 缺省为 local）：本窗口菜单开关。更新 config 镜像并调 /api/setting/setSnippet
     *   （内核即时广播，其他实例原生重渲染注入元素），收集本窗口实时预览中的片段 ID 随消息广播；
     * - 远程（origin 为 remote）：广播窗口已调 API，本窗口不重复调用，仅同步自身状态——更新 config
     *   镜像、刷新注入元素（跳过广播窗口正在实时预览的片段）与菜单全局开关 UI。
     * @param snippetType 代码片段类型
     * @param enabled 是否启用
     * @param origin 变更来源：local（本窗口操作）| remote（其他窗口广播）
     * @param remotePreviewingSnippetIds 广播窗口正在实时预览的片段 ID（仅远程使用，供本窗口跳过元素更新）
     */
    private async globalToggleSnippet(snippetType: SnippetType, enabled: boolean, origin: "local" | "remote" = "local", remotePreviewingSnippetIds: string[] = []) {
        this.console.log("globalToggleSnippet:", { snippetType, enabled, origin });

        // 更新全局变量和配置
        const syConfig = window.siyuan.config!;
        if (snippetType === "css") {
            syConfig.snippet.enabledCSS = enabled;
        } else if (snippetType === "js") {
            syConfig.snippet.enabledJS = enabled;
        }

        if (origin === "remote") {
            // 如果接受广播的窗口没有打开过菜单，可能不存在 this.snippetsList，需要获取
            if (!this.snippetsList || this.snippetsList.length === 0) {
                const snippetsList = await this.getSnippetsList();
                if (snippetsList) {
                    this.snippetsList = snippetsList;
                } else {
                    this.console.error("globalToggleSnippet: Can not get snippetsList");
                    return;
                }
            }

            // 更新代码片段元素
            // 切换全局开关只会影响已启用的代码片段，所以过滤出来
            let filteredSnippets = this.snippetsList.filter((snippet: Snippet) => snippet.type === snippetType && snippet.enabled === true);
            if (this.realTimePreview) {
                // 忽略在广播的窗口中正在实时预览的 CSS 代码片段元素更新
                filteredSnippets = filteredSnippets.filter(snippet => !remotePreviewingSnippetIds.includes(snippet.id));
            }
            filteredSnippets.forEach((snippet: Snippet) => {
                // enabled 为 true 时，snippet.enabled 也一定为 true
                this.updateSnippetElement(snippet, enabled);
            });

            // 更新菜单中的全局开关状态（如果菜单已打开，并且显示的是这个类型的代码片段）
            if (this.menuItems) {
                const globalSwitch = this.menuItems.querySelector(`.jcsm-top-container[data-type="${snippetType}"] .jcsm-all-snippets-switch`) as HTMLInputElement;
                globalSwitch && (globalSwitch.checked = enabled);
            }
            return;
        }

        // 本地：调用内核 API（触发内核即时广播，其他实例原生全量重渲染注入元素）
        fetchPost("/api/setting/setSnippet", syConfig.snippet);

        // 更新代码片段元素（本地正在预览的片段由 updateSnippetElement 内部按 isPreviewingSnippet 跳过）
        // 切换全局开关只会影响已启用的代码片段，所以过滤出来
        const filteredSnippets = this.snippetsList.filter((snippet: Snippet) => snippet.type === snippetType && snippet.enabled === true);
        filteredSnippets.forEach((snippet: Snippet) => {
            // enabled 为 true 时，snippet.enabled 也一定为 true
            // updateSnippetElement 几乎不会抛出错误，但我们仍需要处理返回的 Promise 以满足 ESLint 要求
            this.updateSnippetElement(snippet, enabled).then();
        });

        let previewingSnippetIds: string[] = [];
        if (this.realTimePreview) {
            // 收集正在实时预览的代码片段 ID
            previewingSnippetIds = Array.from(document.querySelectorAll('.b3-dialog--open[data-key="jcsm-snippet-dialog"][data-snippet-id]')).map(item => item.getAttribute("data-snippet-id") as string);
        }

        // 广播全局开关状态变更到其他窗口
        this.syncService?.broadcast({
            type: "snippet_toggle_global",
            snippetType,
            enabled,
            previewingSnippetIds,
        });
    }

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
     * 代码片段的排序方式
     */
    declare snippetSortType: string;

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
        const snippetsList = await this.getSnippetsList();
        if (snippetsList) {
            this.snippetsList = snippetsList;
        } else {
            return false;
        }

        // 从 Store 移动（含 CSS/JS 分区跨界修正），位置没有变化则不做后续 DOM 更新与广播
        const hasPositionChanged = this.snippetStore.move(itemId, selectItemId, isTop);
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
        void await this.saveSnippetsList(this.snippetsList);

        // 广播排序到其他窗口
        this.syncService?.broadcast({type: "snippets_sort"});

        return true;
    }

    /**
     * 菜单鼠标按下事件处理（用于拖拽排序）
     * @param event 鼠标事件
     */
    private menuMousedownHandler(event: MouseEvent) {
        if (this.snippetSortType !== "customSort") {
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
        if (this.snippetSortType !== "customSort") {
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
     * 代码片段搜索类型
     * 0: 不搜索
     * 1: 按标题搜索
     * 2: 按代码内容搜索
     * 3: 按标题和代码内容搜索
     */
    declare snippetSearchType: number;

    /**
     * 筛选代码片段（不区分大小写）
     * @param searchText 搜索文本
     * @returns 筛选后的代码片段 ID 数组，如果禁用搜索或搜索文本为空则返回 false
     */
    private filterSnippetsIds(searchText: string): string[] | false {
        // 如果禁用搜索或搜索文本为空，返回 false，表示不搜索
        if (this.snippetSearchType === 0 || !searchText || searchText.trim() === "") {
            return false;
        }

        const normalizedText = searchText.toLowerCase().trim();

        return this.snippetsList
            .filter((snippet: Snippet) => {
                switch (this.snippetSearchType) {
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
     * 是否显示创建副本按钮
     */
    declare showDuplicateButton: boolean;

    /**
     * 是否显示删除按钮
     */
    declare showDeleteButton: boolean;

    /**
     * 是否显示编辑按钮
     */
    declare showEditButton: boolean;

    /**
     * 是否显示发布服务开关
     */
    declare showPublishCheckbox: number;

    /**
     * 是否显示发布服务开关
     */
    private isShowPublishCheckbox() {
        return this.showPublishCheckbox === 0 ? window.siyuan.config!.publish.enable === true : this.showPublishCheckbox === 1;
    }

    /**
     * 生成代码片段列表
     * @param snippetsList 代码片段列表
     * @returns 代码片段列表 HTML 字符串
     */
    private genMenuSnippetsItems(argSnippetsList?: Snippet[]): string {
        let snippetsList: Snippet[] = argSnippetsList ?? this.snippetsList ?? [];
        if (!argSnippetsList) {
            // 深拷贝 snippetsList，避免排序影响原数据
            if (this.snippetSortType !== "fixedSort" && this.snippetSortType !== "customSort") {
                if (typeof structuredClone === "function") {
                    snippetsList = structuredClone(snippetsList);
                } else {
                    snippetsList = JSON.parse(JSON.stringify(snippetsList));
                }
            }

            // 排序
            switch (this.snippetSortType) {
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

        const isTouch = this.isMobile || this.isTouchDevice;
        const showPublishCheckbox = this.isShowPublishCheckbox();
        let snippetsHtml = "";

        snippetsList.forEach((snippet: Snippet) => {
            // 创建临时的 DOM 元素来安全地设置代码片段名称 https://github.com/TCOTC/snippets/issues/21
            const safeSnippetName = document.createElement("span");
            safeSnippetName.textContent = snippet.name || snippet.content.slice(0, 200);

            snippetsHtml += `
<div class="jcsm-snippet-item b3-menu__item" data-type="${snippet.type}" data-id="${snippet.id}">
    <span class="jcsm-snippet-name fn__flex-1" placeholder="${this.i18n.emptySnippet}">${safeSnippetName.innerHTML}</span>
    <span class="fn__space"></span>
    <button class="block__icon block__icon--show fn__flex-center${ isTouch ? " jcsm-touch" : ""}${this.showDeleteButton    ? "" : " fn__none"}" data-type="delete"><svg><use xlink:href="#iconTrashcan"></use></svg></button>
    <button class="block__icon block__icon--show fn__flex-center${ isTouch ? " jcsm-touch" : ""}${this.showDuplicateButton ? "" : " fn__none"}" data-type="duplicate"><svg><use xlink:href="#iconCopy"></use></svg></button>
    <button class="block__icon block__icon--show fn__flex-center${ isTouch ? " jcsm-touch" : ""}${this.showEditButton      ? "" : " fn__none"}" data-type="edit"><svg><use xlink:href="#iconEdit"></use></svg></button>
    <span class="fn__space"></span>
    <input data-type="publishSwitch" class="jcsm-switch b3-switch fn__flex-center ariaLabel${ showPublishCheckbox ? "" : " fn__none"}" aria-label="${this.i18n.snippetDisabledInPublish}" data-position="north" type="checkbox"${snippet.disabledInPublish ? "" : " checked"}>
    <span class="fn__space"></span>
    <input data-type="snippetSwitch" class="jcsm-switch b3-switch fn__flex-center" type="checkbox"${snippet.enabled ? " checked" : ""}>
</div>
            `;
        });

        return snippetsHtml;
    }

    /**
     * 设置菜单代码片段类型
     * @param snippetType 代码片段类型
     */
    private setMenuSnippetsType(snippetType: SnippetType) {
        if (!this.isMobile) {
            this.setMenuSelection(snippetType);
        }

        // 设置该代码片段类型的全局开关状态
        const enabled = isSnippetsTypeEnabled(snippetType);
        const snippetsTypeSwitch = this.menuItems.querySelector(".jcsm-all-snippets-switch") as HTMLInputElement;
        snippetsTypeSwitch.checked = enabled;

        // 更新按钮提示
        this.menuItems.querySelector("button[data-type='new']")?.setAttribute("aria-label", this.i18n.add + " " + snippetType.toUpperCase());

        // 设置元素属性，通过 CSS 过滤列表
        const topContainer = this.menuItems.querySelector(".jcsm-top-container") as HTMLElement;
        topContainer?.setAttribute("data-type", snippetType);
    }

    /**
     * 设置菜单代码片段计数
     */
    private setMenuSnippetCount() {
        if (!this.menu) return;

        const cssCountElement = this.menuItems.querySelector(".jcsm-tab-count-css") as HTMLElement;
        const jsCountElement = this.menuItems.querySelector(".jcsm-tab-count-js") as HTMLElement;
        if (!cssCountElement || !jsCountElement) return;

        const cssCount = this.snippetsList.filter((item: Snippet) => item.type === "css").length;
        const jsCount = this.snippetsList.filter((item: Snippet) => item.type === "js").length;
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
    private clearMenuSelection() {
        this.menuItems?.querySelectorAll(".b3-menu__item--current").forEach((item: HTMLElement) => {
            item.classList.remove("b3-menu__item--current");
        });
    }

    /**
     * 是否需要重新加载界面
     */
    get isReloadUIRequired() { return window.siyuan.jcsm?.isReloadUIRequired ?? false; }
    set isReloadUIRequired(value: boolean) { (window.siyuan.jcsm ??= {}).isReloadUIRequired = value; }

    /**
     * 设置重新加载界面按钮呼吸动画
     */
    private async setReloadUIButtonBreathing() {
        if (this.isReloadUIRequired) return; // 如果已经设置了呼吸动画，则不重复设置
        this.isReloadUIRequired = true;

        // 如果加载插件时就开启文件监听，this.menuItems 有可能未初始化
        const reloadUIButton = this.menuItems?.querySelector(".jcsm-top-container button[data-type='reload']") as HTMLButtonElement;
        reloadUIButton?.classList.add("jcsm-breathing");
    }

    /**
     * 是否正在设置代码片段类型开关呼吸动画
     */
    private isSettingSnippetsTypeSwitchBreathing = false;

    /**
     * 设置代码片段类型开关呼吸动画
     */
    private setSnippetsTypeSwitchBreathing() {
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
     * 设置代码片段菜单项编辑按钮高亮
     * @param snippetId 代码片段 ID
     */
    private setSnippetEditButtonActive(snippetId: string) {
        if (!snippetId) return;

        const editButton = this.menuItems?.querySelector(`.jcsm-snippet-item[data-id='${snippetId}'] button[data-type='edit']`) as HTMLButtonElement;
        editButton?.classList.add("jcsm-active");
    }

    /**
     * 移除代码片段菜单项编辑按钮高亮
     * @param snippetId 代码片段 ID
     */
    private removeSnippetEditButtonActive(snippetId: string) {
        if (!snippetId) return;

        const editButton = this.menuItems?.querySelector(`.jcsm-snippet-item[data-id='${snippetId}'] button.jcsm-active[data-type='edit']`) as HTMLButtonElement;
        editButton?.classList.remove("jcsm-active");
    }


    // ================================ 代码片段管理 ================================

    /**
     * 代码片段列表
     */
    get snippetsList() { return window.siyuan.jcsm?.snippetsList ?? []; }
    set snippetsList(value: Snippet[]) { (window.siyuan.jcsm ??= {}).snippetsList = value; }

    /**
     * 代码片段类型
     */
    get snippetsType(): SnippetType { 
        // 如果已经有值（用户切换过标签），使用该值，否则使用配置中的默认值
        const type = window.siyuan.jcsm?.snippetsType ?? window.siyuan.jcsm?.defaultSnippetsType;
        if (type !== "css" && type !== "js") {
            return "css";
        }
        return type;
    }
    set snippetsType(value: SnippetType) { (window.siyuan.jcsm ??= {}).snippetsType = value; }

    /**
     * 创建代码片段
     */
    private createSnippet() {
        const snippet: Snippet = {
            id: this.genNewSnippetId(),
            name: "",
            type: this.snippetsType as "css" | "js",
            enabled: this.newSnippetEnabled,
            content: "",
        };
        // 不直接添加代码片段
        // this.saveSnippet(snippet);
        void this.openSnippetEditDialog(snippet, true);
    }

    /**
     * 保存代码片段（添加/更新/复制；本窗口操作与同内核其他前端实例广播共用同一路径，阶段 3：消灭 saveSnippetSync 镜像）
     * - 本窗口操作（origin 缺省为 local）：snippet 为编辑结果对象（对话框保存）或复制源对象（复制按钮，
     *   副本在方法内派生）；先自拉服务端旧态做 diff，有变更才经 Store 落库、更新元素/UI 并广播；
     * - 同内核其他前端实例广播（origin 为 remote）：广播窗口已落库，本窗口不落库、不广播，仅同步自身状态。
     *   广播消息不含片段原文（禁原文约束），片段对象由注册表 snippet_save 键自拉权威数据后传入：
     *   复制场景 snippet 为被复制原片段（菜单项插入锚点）、remoteCopySnippet 为自拉的权威副本；
     *   非复制场景 snippet 为自拉的权威新态、remoteOldSnippet 为自拉前捕获的本窗口旧片段
     *   （仅改名时不必重刷注入元素，避免 JS 重复弹出重载提示）。
     * @param snippet 代码片段（语义随 origin，见上）
     * @param isCopy 是否为复制操作
     * @param origin 变更来源：local（本窗口操作）| remote（其他窗口广播）
     * @param remoteCopySnippet 仅 origin 为 remote 且 isCopy 时使用：自拉的权威副本对象
     * @param remoteOldSnippet 仅 origin 为 remote 且非复制时使用：自拉前捕获的本窗口旧片段
     */
    private async saveSnippet(snippet: Snippet, isCopy = false, origin: "local" | "remote" = "local", remoteCopySnippet?: Snippet, remoteOldSnippet?: Snippet) {
        this.console.log("saveSnippet:", {snippetId: snippet.id, isCopy, origin});

        if (origin === "remote") {
            if (isCopy) {
                if (!remoteCopySnippet) {
                    this.console.error("saveSnippet: remote copySnippet is missing:", snippet.id);
                    return;
                }
                // 从 Store 统一 upsert（幂等：副本已随自拉就位，此处仅统一触发计数刷新事件）
                this.snippetStore.upsert(remoteCopySnippet);
                // 代码片段有可能未启用，所以不传入 enabled === true 的参数
                await this.updateSnippetElement(remoteCopySnippet);
                // 镜像菜单项插入与原始片段对话框按钮更新
                this.applySnippetUIChange(snippet, true, remoteCopySnippet);
                this.console.log("saveSnippet: remote copySnippet", remoteCopySnippet);
                return;
            }
            // 从 Store 统一 upsert（列表已随自拉刷新为权威态，计数由事件统一刷新）
            this.snippetStore.upsert(snippet);
            if (remoteOldSnippet) {
                // 本窗口原本有该片段：更新。比较对象属性值而不是对象引用
                const contentOrEnabledChanged = remoteOldSnippet.content !== snippet.content || remoteOldSnippet.enabled !== snippet.enabled;
                if (contentOrEnabledChanged) {
                    // 只有代码片段名称改变的时候不需要更新元素
                    // 代码片段有可能未启用，所以不传入 enabled === true 的参数
                    // 问题案例: 先禁用整体状态，再在对话框中启用，然后预览，然后保存。会在整体禁用的情况下启用代码片段，或者说没有移除预览时添加的元素
                    //  应该始终执行 updateSnippetElement
                    await this.updateSnippetElement(snippet);

                    // TODO功能: 跨窗口同步时，如果有打开对应的代码片段编辑器，需要更新编辑器的内容
                }
            } else {
                // 本窗口原本没有该片段：新增（列表已按权威顺序就位）
                // 代码片段有可能未启用，所以不传入 enabled === true 的参数
                await this.updateSnippetElement(snippet);
            }
            this.applySnippetUIChange(snippet, true);
            return;
        }

        let hasChanges = false;
        let copySnippet: Snippet | undefined = undefined;
        if (isCopy) {
            // 使用结构化克隆深拷贝 snippet 对象，避免副本和原对象引用同一内存
            if (typeof structuredClone === "function") {
                copySnippet = structuredClone(snippet);
            } else {
                // 不支持 structuredClone 则回退到 JSON 方法
                copySnippet = JSON.parse(JSON.stringify(snippet)) as Snippet;
            }
            // 生成新的代码片段
            copySnippet.id = this.genNewSnippetId();
            copySnippet.name = snippet.name + ` (${this.i18n.duplicate} ${new Date().toLocaleString()})`;

            // 把副本创建在当前代码片段的上面（菜单计数由 SNIPPETS_CHANGED 事件统一刷新）
            this.snippetStore.insertBefore(copySnippet, snippet.id);
            hasChanges = true;

            // 代码片段有可能未启用，所以不传入 enabled === true 的参数
            await this.updateSnippetElement(copySnippet);

            this.console.log("saveSnippet: copySnippet", copySnippet);
        } else {
            // 在 snippetsList 中查找是否存在该代码片段
            const oldSnippet = await this.getSnippetById(snippet.id!);
            if (oldSnippet) {
                // 如果存在，则更新该代码片段
                // 比较对象属性值而不是对象引用
                const nameChanged = oldSnippet.name !== snippet.name;
                const contentOrEnabledChanged = oldSnippet.content !== snippet.content || oldSnippet.enabled !== snippet.enabled || oldSnippet.disabledInPublish !== snippet.disabledInPublish;
                hasChanges = nameChanged || contentOrEnabledChanged;
                if (hasChanges) {
                    // 从 Store 统一替换并触发计数刷新事件
                    this.snippetStore.upsert(snippet);
                }
                if (contentOrEnabledChanged) {
                    // 只有代码片段名称改变的时候不需要更新元素
                    // 代码片段有可能未启用，所以不传入 enabled === true 的参数
                    // 问题案例: 先禁用整体状态，再在对话框中启用，然后预览，然后保存。会在整体禁用的情况下启用代码片段，或者说没有移除预览时添加的元素
                    //  应该始终执行 updateSnippetElement
                    await this.updateSnippetElement(snippet);
                }
            } else {
                if (oldSnippet === false) {
                    this.showErrorMessage(this.i18n.getSnippetFailed);
                    return;
                }
                // 如果不存在（oldSnippet === undefined），则添加代码片段（store.upsert 按类型分区插入，计数由事件统一刷新）
                this.snippetStore.upsert(snippet);
                hasChanges = true;
                // 代码片段有可能未启用，所以不传入 enabled === true 的参数
                await this.updateSnippetElement(snippet);
            }
        }

        if (hasChanges) {
            // 代码片段发生变更才推送更新
            // 需要等 getSnippetsList() 调用的 API 执行完毕之后才推送更新，其他窗口需要用到代码片段的最新数据
            void await this.saveSnippetsList(this.snippetsList);
            this.applySnippetUIChange(snippet, true, copySnippet);

            // 广播代码片段数据更新到其他窗口
            // 注意：不得携带代码片段原文（content 可能含敏感信息），接收窗口按 ID 自拉权威数据
            this.syncService?.broadcast({
                type: "snippet_save",
                snippetId: snippet.id,
                isCopy: isCopy,
                copySnippetId: copySnippet?.id,
            });
        }
    }

    /**
     * 删除代码片段（本地操作与跨窗口同步共用同一路径，阶段 3：消灭 deleteSnippetSync 镜像）
     * - 本地（origin 缺省为 local）：自拉权威数据校验存在 → 从 Store 删除 → 落库 → 移除注入元素
     *   /更新 UI → 广播（附本窗口是否正在预览该片段）；
     * - 远程（origin 为 remote）：广播窗口已落库并校验过，本窗口仅按自身状态同步——广播窗口未预览
     *   该片段时才移除注入元素；片段在本窗口列表中存在时更新 UI 并同步从 Store 删除。
     * @param id 代码片段 ID
     * @param snippetType 代码片段类型
     * @param origin 变更来源：local（本窗口操作）| remote（其他窗口广播）
     * @param remotePreviewState 广播窗口是否正在实时预览该片段（仅远程使用，用于跳过注入元素移除）
     */
    private async deleteSnippet(id: string, snippetType: SnippetType, origin: "local" | "remote" = "local", remotePreviewState = false) {
        // TODO: 有个 "/api/snippet/removeSnippet" 看看能不能用上
        this.console.log("deleteSnippet", {id, snippetType, origin});

        if (!id || !snippetType) {
            if (origin === "local") {
                this.showErrorMessage(this.i18n.deleteSnippetFailed);
            } else {
                this.console.error("deleteSnippet: Snippet is missing:", {id, snippetType});
            }
            return;
        }

        if (origin === "local") {
            const snippet = await this.getSnippetById(id);
            if (snippet === undefined) {
                this.showErrorMessage(this.i18n.getSnippetFailed);
                return;
            } else if (snippet === false) {
                return;
            }
            // 从 Store 中删除：统一更新列表并广播变更事件，菜单在打开时会自行刷新计数
            this.snippetStore.remove(id);
            // 需要等 getSnippetsList() 调用的 API 执行完毕之后才推送更新，其他窗口需要用到代码片段的最新数据
            void await this.saveSnippetsList(this.snippetsList);

            void this.removeSnippetElement(id, snippetType);
            this.applySnippetUIChange(snippet, false);

            // 广播代码片段数据更新到其他窗口
            this.syncService?.broadcast({
                type: "snippet_delete",
                snippetId: id,
                snippetType: snippetType,
                previewState: this.isPreviewingSnippet(id, snippetType),
            });
            return;
        }

        // 远程：广播窗口没有预览该代码片段的情况下，才移除元素
        if (!remotePreviewState) {
            void this.removeSnippetElement(id, snippetType);
        }
        const snippet = this.snippetsList.find((s: Snippet) => s.id === id);
        if (snippet) {
            this.applySnippetUIChange(snippet, false);
            // 从 Store 中删除：统一在列表更新之后触发计数刷新事件（否则计数仍是删除前的值）
            this.snippetStore.remove(id);
        }
    }

    /**
     * 应用代码片段 UI 变更
     * @param snippet 代码片段
     * @param isAddOrUpdate 是否为添加或更新
     * @param copySnippet 副本代码片段
     */
    private applySnippetUIChange(snippet: Snippet, isAddOrUpdate: boolean, copySnippet?: Snippet) {
        const snippetMenuItem = this.menuItems?.querySelector(`.jcsm-snippet-item[data-id="${snippet.id}"]`) as HTMLElement;
        const dialog = document.querySelector(`.b3-dialog--open[data-key="jcsm-snippet-dialog"][data-snippet-id="${snippet.id}"]`) as HTMLDivElement;
        let deleteButton, confirmButton;
        if (dialog && !copySnippet) {
            // 创建代码片段副本时不需要更新原始代码片段的 Dialog 的按钮
            deleteButton = dialog.querySelector(".jcsm-dialog .jcsm-dialog-container button[data-action=\"delete\"]") as HTMLButtonElement;
            confirmButton = dialog.querySelector(".jcsm-dialog .b3-dialog__action button[data-action=\"confirm\"]") as HTMLButtonElement;
        }
        // 应用代码片段变更，修改相关的元素
        if (isAddOrUpdate) {
            // 打开菜单时才需要修改菜单项
            if (this.menu) {
                if (snippetMenuItem) {
                    // 有菜单项
                    if (copySnippet) {
                        // 在指定菜单项的上方插入新的副本菜单项
                        const snippetsHtml = this.genMenuSnippetsItems([copySnippet]);
                        snippetMenuItem.insertAdjacentHTML("beforebegin", snippetsHtml);
                    } else {
                        // 更新菜单项
                        const nameElement = snippetMenuItem.querySelector(".jcsm-snippet-name") as HTMLElement;
                        if (nameElement) nameElement.textContent = snippet.name || snippet.content.slice(0, 200);
                        const publishSwitchElement = snippetMenuItem.querySelector("input[data-type='publishSwitch']") as HTMLInputElement;
                        if (publishSwitchElement) publishSwitchElement.checked = !snippet.disabledInPublish;
                        const snippetSwitchElement = snippetMenuItem.querySelector("input[data-type='snippetSwitch']") as HTMLInputElement;
                        if (snippetSwitchElement) snippetSwitchElement.checked = snippet.enabled;
                    }
                } else {
                    // 没有菜单项，在菜单项列表的顶部插入新的菜单项
                    const snippetsHtml = this.genMenuSnippetsItems([snippet]);
                    this.menuItems.querySelector(".jcsm-snippets-container")?.insertAdjacentHTML("afterbegin", snippetsHtml);
                }
            }

            // 修改对应的 Dialog
            deleteButton?.classList.remove("fn__none"); // 显示删除按钮
            if (confirmButton) confirmButton.textContent = this.i18n.save; // 将“新建”按钮的文案改为“保存”
        } else {
            // 移除菜单项
            snippetMenuItem?.remove();

            // 修改对应的 Dialog
            deleteButton?.classList.add("fn__none"); // 隐藏删除按钮
            if (confirmButton) confirmButton.textContent = this.i18n.new; // 将“保存”按钮的文案改为“新建”
        }
    }

    /**
     * 根据 ID 获取代码片段（副作用是更新 this.snippetsList ）
     * @param id 代码片段 ID
     * @returns 代码片段 | false
     */
    private async getSnippetById(id: string): Promise<Snippet | false | undefined> {
        const snippetsList = await this.getSnippetsList();
        if (snippetsList) {
            this.snippetsList = snippetsList;
            return this.snippetsList.find((snippet: Snippet) => snippet.id === id);
        } else {
            return false;
        }
    }

    /**
     * 获取代码片段列表
     * @returns 代码片段列表 | false
     */
    private async getSnippetsList(): Promise<Snippet[] | false> {
        const response = await fetchSyncPost("/api/snippet/getSnippet", { type: "all", enabled: 2 });
        if (response.code !== 0) {
            this.showErrorMessage(this.i18n.getSnippetsListFailed + " [" + response.msg + "]");
            return false;
        }
        const snippetsList = response.data.snippets as Snippet[];
        this.console.log("getSnippetsList", snippetsList);
        return response.data.snippets as Snippet[];
    }

    /**
     * 保存代码片段列表（参考思源本体 app/src/config/util/snippets.ts ）
     * @param snippetsList 代码片段列表
     * @returns Promise<void>
     */
    private saveSnippetsList(snippetsList: Snippet[]): Promise<void> {
        this.console.log("saveSnippetsList", snippetsList);
        // 将回调形式的 fetchPost 包装为 Promise，以便可以 await
        return new Promise((resolve, reject) => {
            fetchPost("/api/snippet/setSnippet", { snippets: snippetsList }, (response) => {
                // 增加错误处理
                if (response.code !== 0) {
                    this.showErrorMessage(this.i18n.saveSnippetsListFailed + " [" + response.msg + "]");
                    reject(new Error(this.i18n.saveSnippetsListFailed + " [" + response.msg + "]"));
                    return;
                }
                resolve();
            });
        });
    }

    /**
     * 更新代码片段元素（添加、更新、删除、启用、禁用、全局启用、全局禁用）
     * @param snippet 代码片段
     * @param enabled 是否启用
     * @param previewState 为 true 时是预览操作；为 false 时是退出预览操作，需要恢复原始元素
     */
    private async updateSnippetElement(snippet: Snippet | false | undefined, enabled?: boolean, previewState?: boolean) {
        if (!snippet) {
            this.showErrorMessage(this.i18n.updateSnippetElementParamError);
            return;
        }
        if (previewState === undefined && this.isPreviewingSnippet(snippet.id, snippet.type)) {
            // 如果开启了实时预览，并且打开了对应的 CSS 代码片段对话框，则在菜单项上开关代码片段的操作需要忽略
            // 问题案例：全局禁用 CSS，预览一个 CSS 片段，启用片段，在菜单禁用片段会导致预览元素被移除
            //  这是因为从菜单关闭时没有 previewState 参数，此时需要通过是否有实时预览中的代码片段对话框来判断
            return;
        }

        const elementId = `snippet${snippet.type.toUpperCase()}${snippet.id}`;
        const element = document.getElementById(elementId);

        // ?? 空值合并运算符，当左侧值为 null 或 undefined 时返回右侧值，此处优先使用 enabled 的值
        const isEnabled = enabled ?? snippet.enabled;
        const isSnippetsTypeEnabledFlag = isSnippetsTypeEnabled(snippet.type);

        if (isEnabled && (isSnippetsTypeEnabledFlag || previewState)) {
            // 代码片段需要启用 && （该代码片段对应的类型是启用状态 || 正在预览该代码片段）→ 则添加新元素
            if (element && element.innerHTML === snippet.content) {
                // 如果要添加的代码片段与原来的一样，就忽略
            } else {
                this.console.log("updateSnippetElement: remove old element:", element);
                element?.remove();
                let newElement;
                if (snippet.type === "css") {
                    newElement = document.createElement("style");
                    newElement.id = elementId;
                    newElement.textContent = snippet.content;
                    document.head.appendChild(newElement);
                } else if (snippet.type === "js") {
                    if (!isValidJavaScriptCode(snippet.content)) {
                        this.showErrorMessage(this.i18n.invalidJavaScriptCode);
                    }
                    newElement = document.createElement("script");
                    newElement.id = elementId;
                    newElement.type = "text/javascript";
                    // 思源的代码使用 .text ，这与 .textContent 是等效的，参考：https://developer.mozilla.org/en-US/docs/Web/API/HTMLScriptElement/text https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent
                    newElement.textContent = snippet.content;
                    document.head.appendChild(newElement);
                }
                this.console.log("updateSnippetElement: add new element:", newElement);
            }
        } else {
            // else 分支等效于 !isEnabled || (!isSnippetsTypeEnabled && !previewState)
            // 禁用 || (全局禁用 && 不是正在预览) → 则移除旧元素
            this.console.log("updateSnippetElement: remove disabled element:", element);
            element?.remove();
        }

        if (previewState === undefined && isEnabled && this.menu && snippet.type === this.snippetsType && !isSnippetsTypeEnabled) {
            // 如果当前的操作是在非预览状态下、开启代码片段、开启了菜单、菜单上显示的是这个类型的代码片段、这个类型的代码片段是关闭状态 → 全局开关闪烁一下
            this.setSnippetsTypeSwitchBreathing();
        }

        // 需要弹出消息提示的情况：
        // 1. 修改：有旧代码 && 旧代码有效 && （新代码有效 || 新代码无效）等效于有新代码
        // 2. 删除：有旧代码 && 旧代码有效 && 没有新代码
        // 3. 禁用：有旧代码 && 旧代码有效 && 没有新代码
        // 以上合并为：有旧代码 && 旧代码有效 → 本质上是旧 JS 被修改/删除/禁用时无法立即生效
        if (snippet.type === "js" && element && element.innerHTML && isValidJavaScriptCode(element.innerHTML)) {
            // JS 代码片段元素更新需要弹出消息提示
            this.showNotification("reloadUIAfterModifyJS", 4000);
            // 高亮菜单上的重新加载界面按钮
            await this.setReloadUIButtonBreathing();
        }
    }

    /**
     * 移除代码片段元素
     * @param snippetId 代码片段 ID
     * @param snippetType 代码片段类型
     */
    private async removeSnippetElement(snippetId: string, snippetType: string) {
        if (!snippetId || !snippetType) return;
        // 如果当前窗口正在预览代码片段，则不移除元素
        if (this.isPreviewingSnippet(snippetId, snippetType)) return;

        const elementId = `snippet${snippetType.toUpperCase()}${snippetId}`;
        const element = document.getElementById(elementId);
        // 删除 JS 代码片段需要弹出消息提示：有旧代码 && 旧代码有效
        if (snippetType === "js" && element && element.innerHTML && isValidJavaScriptCode(element.innerHTML)) {
            this.showNotification("reloadUIAfterModifyJS", 4000);
            await this.setReloadUIButtonBreathing();
        }
        element?.remove();
    }


    // ================================ 对话框相关 ================================

    // dialog.destroy 还能传递参数，看看这个写法能不能用上
    // dialog.destroy({cancel: "true"});

    /**
     * 生成代码片段编辑对话框
     * @param snippet 代码片段
     * @param confirmText 确认按钮的文案
     * @returns 代码片段编辑对话框 HTML 字符串
     */
    private genSnippetEditDialog(snippet: Snippet, confirmText: string = this.i18n.save): string {
        const showPublishCheckbox = this.isShowPublishCheckbox();
        // TODO功能: 在删除按钮左边加一个创建副本按钮（始终显示），点击之后创建副本（不直接保存，是新建的代码片段，需要手动点击保存按钮）并且打开编辑对话框
        return `
<div class="jcsm-dialog">
    <div class="jcsm-dialog-header resize__move"></div>
    <div class="jcsm-dialog-container">
        <div class="fn__flex">
            <input class="jcsm-dialog-name fn__flex-1 b3-text-field" spellcheck="false" placeholder="${this.i18n.title}">
            <div class="fn__space"></div>
            <button data-action="delete" class="block__icon block__icon--show ariaLabel fn__none" aria-label="${this.i18n.deleteSnippet}" data-position="north">
                <svg><use xlink:href="#iconTrashcan"></use></svg>
            </button>
            <div class="fn__space"></div>
            <input data-type="publishSwitch" class="b3-switch fn__flex-center ariaLabel${ showPublishCheckbox ? "" : " fn__none"}" aria-label="${this.i18n.snippetDisabledInPublish}" data-position="north" type="checkbox"${snippet.disabledInPublish ? "" : " checked"}>
            <div class="fn__space"></div>
            <input data-type="snippetSwitch" class="b3-switch fn__flex-center" type="checkbox"${snippet.enabled ? " checked" : ""}>
        </div>
        <div class="fn__hr"></div>
        <div class="jcsm-dialog-content"></div>
        <div class="fn__hr--b"></div>
    </div>
    <div class="b3-dialog__action">
        <button data-action="cancel" class="b3-button b3-button--cancel">${this.i18n.cancel}</button>
        <div class="fn__space"></div>
        <button data-action="preview" class="b3-button b3-button--text${snippet.type === "js" || this.realTimePreview ? " fn__none" : ""}">${this.i18n.preview}</button>
        <div class="fn__space"></div>
        <button data-action="confirm" class="b3-button b3-button--text">${confirmText}</button>
    </div>
</div>
        `;
    }

    /**
     * 编辑器缩进单位
     */
    declare editorIndentUnit: string;

    /**
     * 是否允许同时打开多个代码片段编辑器
     */
    declare multipleSnippetEditors: boolean;

    /**
     * 打开代码片段编辑对话框
     * @param snippet 代码片段
     * @param isNew 是否为新建代码片段
     * @returns 是否成功打开对话框
     */
    private async openSnippetEditDialog(snippet: Snippet, isNew?: boolean): Promise<boolean> {
        if (this.getAllModalDialogElements().length > 0) return false;

        // 检查参数
        const paramError: string[] = [];
        if (!snippet) {
            paramError.push(this.i18n.snippet);
        } else {
            if (!snippet.id) {
                paramError.push(this.i18n.snippetId);
            }
            if (!snippet.type) {
                paramError.push(this.i18n.snippetType);
            }
        }
        if (paramError.length > 0) {
            this.showErrorMessage(this.i18n.snippetDialogParamError + "[" + paramError.join(", ") + "]");
            return false;
        }

        // 给对应的菜单项的编辑按钮添加背景色
        this.setSnippetEditButtonActive(snippet.id);

        // 如果已经有打开的对应 snippetId 的 Dialog，则仅激活它，不重复创建
        const existedDialog = document.querySelector(`.b3-dialog--open[data-key="jcsm-snippet-dialog"][data-snippet-id="${snippet.id}"]`) as HTMLDivElement;
        if (existedDialog) {
            moveElementToTop(existedDialog);
            return true;
        }

        // 创建 Dialog
        const dialog = new Dialog({
            content: this.genSnippetEditDialog(snippet, isNew ? this.i18n.new : undefined),
            width: this.isMobile ? "92vw" : "70vw",
            height: "80vh",
            hideCloseIcon: this.isMobile,
        });
        (dialog.element as any).dialogObject = dialog;

        // 设置 Dialog 属性
        dialog.element.setAttribute("data-key", "jcsm-snippet-dialog");
        dialog.element.setAttribute("data-snippet-id", snippet.id);
        dialog.element.setAttribute("data-snippet-type", snippet.type);

        if (!isNew) {
            // 非新建代码片段时，显示删除按钮
            const deleteButton = dialog.element.querySelector("button[data-action='delete']") as HTMLButtonElement;
            deleteButton?.classList.remove("fn__none");
        }

        if (!this.isMobile && this.multipleSnippetEditors) {
            // 桌面端支持同时打开多个 Dialog，需要设置 Dialog 样式
            dialog.element.style.zIndex = (++window.siyuan.zIndex).toString();
            dialog.element.querySelector(".b3-dialog__scrim")?.remove();
            const dialogElement = dialog.element.querySelector(".b3-dialog") as HTMLElement;
            dialogElement.style.width = "0";
            dialogElement.style.height = "0";
            dialogElement.style.left = "50vw";
            dialogElement.style.top = "50vh";
            const dialogContainer = dialogElement.querySelector(".b3-dialog__container") as HTMLElement;
            dialogContainer.style.position = "fixed";
            dialog.element.setAttribute("data-modal", "false"); // 标记为非模态对话框
        } else {
            dialog.element.setAttribute("data-modal", "true");  // 标记为模态对话框
        }

        // 检查并启动主题模式监听（在第一个编辑器对话框打开时）
        this.editorManager.checkAndManageThemeWatch(true);

        // 设置代码片段标题和内容
        const nameElement = dialog.element.querySelector(".jcsm-dialog-name") as HTMLInputElement; // 标题不允许输入换行，所以得用 input 元素，textarea 元素没法在操作能 Ctrl+Z 撤回的前提下阻止用户换行
        nameElement.value = snippet.name;
        nameElement.focus();

        // 创建 CodeMirror 编辑器
        const contentContainer = dialog.element.querySelector(".jcsm-dialog-content") as HTMLElement;
        const codeMirrorView = createCodeMirrorEditor(contentContainer, snippet.content, snippet.type, this.editorIndentUnit, this.i18n);
        // codeMirrorView.contentDOM.focus();

        const publishSwitchInput = dialog.element.querySelector("input[data-type='publishSwitch']") as HTMLInputElement;
        const snippetSwitchInput = dialog.element.querySelector("input[data-type='snippetSwitch']") as HTMLInputElement;
        // switchInput.checked = snippet.enabled; // genSnippetDialog 的时候已经添加了 enabled 属性，这里不需要重复设置

        // 取消编辑代码片段
        const cancelHandler = async () => {
            const cancel = async () => {
                // 需要先关闭 Dialog，因为后面的 this.removeSnippetElement 会根据是否打开了 Dialog 来判断代码片段是否正在预览
                this.closeDialogByElement(dialog.element);

                if (snippet.type === "css") {
                    // 退出预览操作，新建的代码片段需要移除元素，已有的代码片段需要恢复原始元素 https://github.com/TCOTC/snippets/issues/26
                    if (isNew) {
                        void this.removeSnippetElement(snippet.id, snippet.type);
                        // 发送广播消息，在其他窗口调用 this.removeSnippetElementSync() 移除代码片段元素
                        this.syncService?.broadcast({
                            type: "snippet_element_remove",
                            snippetId: snippet.id,
                            snippetType: snippet.type
                        });
                    } else {
                        let realSnippet: Snippet | undefined | false = this.snippetsList.find((s: Snippet) => s.id === snippet.id);
                        if (!realSnippet) {
                            realSnippet = await this.getSnippetById(snippet.id);
                        }
                        if (!realSnippet) return;
                        this.updateSnippetElement(realSnippet, undefined, false);
                        // 发送广播消息，在其他窗口调用 this.updateSnippetElementSync() 更新代码片段元素
                        // 退出预览用的是已保存片段（可自拉），不携带原文，只发 snippetId + previewState: false
                        this.syncService?.broadcast({
                            type: "snippet_element_update",
                            snippetId: snippet.id,
                            previewState: false
                        });
                    }
                }
            };

            // 获取 Dialog 的焦点元素
            const focusElement = dialog.element.querySelector(":focus") as HTMLElement || dialog.element.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
            // 点击开关之后要移除焦点，不然弹出确认弹窗之后按 Esc 还是会触发 Dialog 上的 keydown 事件
            focusElement?.blur();

            const currentSnippet = await this.getSnippetById(snippet.id);
            if (currentSnippet === undefined) {
                // 如果当前代码片段不存在，说明是在“取消新建代码片段”
                // 问题案例：
                //  1、打开代码编辑器
                //  2、删除代码片段
                //  3、关闭代码编辑器会弹窗确认
                //  4、点击“放弃修改”之后没有正确关闭代码编辑器
                //  原因是 isNew 的值没有更新
                isNew = true;
                // 如果没有填任何内容，则直接关闭 Dialog
                if (nameElement.value.trim() === "" && codeMirrorView.state.doc.toString().trim() === "") {
                    cancel();
                    return;
                } else {
                    // 如果填了内容，则弹窗提示确认
                    this.openSnippetCancelDialog(snippet, true, undefined,
                        () => { cancel(); }, // 取消
                        () => { focusElement?.focus(); } // 恢复焦点
                    );
                    return;
                }
            } else if (currentSnippet === false) {
                // API 调用失败，无法确认是否存在更改，直接关闭 Dialog
                cancel();
                return;
            }

            const changes = [];
            // 用当前实际的状态来跟对话框中的内容来对比，而不是用对话框的初始 snippet 对象（比如在菜单修改了开关，但对话框的初始 snippet 对象不会同步更新）
            if (currentSnippet.name !== nameElement.value) {
                changes.push(this.i18n.snippetName);
            }
            if (currentSnippet.content !== codeMirrorView.state.doc.toString()) {
                changes.push(this.i18n.snippetContent);
            }
            if (currentSnippet.enabled !== snippetSwitchInput.checked) {
                changes.push(this.i18n.snippetEnabled);
            }
            if (currentSnippet.disabledInPublish !== !publishSwitchInput.checked) {
                // 注意 !publishSwitchInput.checked 是取反的
                changes.push(this.i18n.snippetDisabledInPublish);
            }

            if (changes.length > 0) {
                // 有变更，弹窗提示确认
                this.openSnippetCancelDialog(snippet, false, changes,
                    () => { cancel(); }, // 取消
                    () => { focusElement?.focus(); } // 恢复焦点
                );
                return;
            } else {
                // 没有变更
                cancel();
            }
        };
        // CSS 代码片段预览
        const previewHandler = () => {
            this.console.log("Handle CSS preview");
            if (snippet.type !== "css") {
                this.showErrorMessage(this.i18n.realTimePreviewHandlerFunctionError);
                return;
            }
            const previewSnippet: Snippet = {
                id: snippet.id,
                name: "",
                type: "css",
                enabled: snippetSwitchInput.checked,
                disabledInPublish: !publishSwitchInput.checked,
                content: codeMirrorView.state.doc.toString(),
            };

            // 只更新代码片段元素，不保存代码片段 this.saveSnippet(snippet);
            this.updateSnippetElement(previewSnippet, undefined, true);

            // 发送广播消息，在其他窗口调用 this.updateSnippetElementSync() 更新 CSS 代码片段元素
            // 豁免“广播禁原文”：预览内容未保存、接收窗口无法自拉，且为同内核可信实例上的显式预览操作，允许携带编辑中的 CSS 文本
            this.syncService?.broadcast({
                type: "snippet_element_update",
                snippet: previewSnippet,
                previewState: true
            });
        };
        // 新建或更新代码片段
        const saveHandler = async () => {
            snippet.name = nameElement.value;
            snippet.content = codeMirrorView.state.doc.toString();
            snippet.enabled = snippetSwitchInput.checked;
            snippet.disabledInPublish = !publishSwitchInput.checked;

            // 要先关闭 Dialog，因为通过 saveSnippet 调用的 updateSnippetElement 会根据 Dialog 是否打开来决定是否需要更新代码片段元素
            this.closeDialogByElement(dialog.element);
            // 需要等待 saveSnippet 完成之后才能确认 this.isReloadUIRequired 的状态
            await this.saveSnippet(snippet);
            // 自动重新加载界面
            if (this.autoReloadUIAfterModifyJS && this.isReloadUIRequired && !document.querySelector(".b3-dialog--open[data-key='jcsm-snippet-dialog']")) {
                this.postReloadUI();
            }
        };

        // 原生的 dialog.destroy() 方法会导致菜单直接被关闭，这里覆盖掉，改成调用 cancelHandler()
        dialog.destroyNative = dialog.destroy;
        dialog.destroy = () => {
            this.console.log("snippetEditDialog destroy");
            cancelHandler();
        };

        const isOnlyCtrl = (event: KeyboardEvent) => event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;

        // 处理标题区跳转和 Ctrl+Enter 保存
        this.addListener(dialog.element, "keydown", (event: KeyboardEvent) => {
            this.console.log("snippetEditDialog keydown", event);
            const target = event.target as HTMLElement;
            if (target === nameElement) {
                // 在标题中按键
                if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    codeMirrorView.contentDOM.focus();
                    return;
                }
            } else if (target === codeMirrorView.contentDOM) {
                // 在代码编辑器中按键
                if (isOnlyCtrl(event) && event.key === "Enter") {
                    // 按 Ctrl+Enter 键执行“保存”操作
                    event.preventDefault();
                    saveHandler();
                    return;
                }
            }

            if (event.key === "Escape") {
                // 按 Esc 键关闭 Dialog
                event.stopPropagation();
                cancelHandler();
                return;
            }
        }, {capture: true}); // 需要在捕获阶段阻止冒泡，否则按 Ctrl+Enter 会先输入一个换行

        this.addListener(dialog.element, "keydown", (event: KeyboardEvent | CustomEvent) => {
            const target = event.target as HTMLElement;
            if (target === codeMirrorView.contentDOM) {
                // 在代码编辑器中按键
                if (isOnlyCtrl((event as KeyboardEvent)) && (event as KeyboardEvent).key === "f") {
                    // 按 Ctrl+F 搜索时阻止冒泡，否则会呼出思源的搜索
                    event.stopPropagation();
                }
            }
            // 监听输入框内容变化，实时预览
            // 用了代码编辑器之后，按 Backspace、Ctrl+X 等操作都监听不到 input 事件，所以改成监听 keydown 事件
            if (snippet.type === "css" && this.realTimePreview) {
                const isDispatch = typeof (event as CustomEvent).detail === "string";
                // 仅在代码编辑器区域内按键或自定义事件触发时处理实时预览
                if (target === codeMirrorView.contentDOM || (isDispatch && (event as CustomEvent).detail === "realTimePreview")) {
                    setTimeout(() => {
                        previewHandler();
                    }, 0); // 等待符号键入完成
                }
            }
        }); // 不能在捕获阶段处理，否则 Ctrl+F 不会被编辑器处理、codeMirrorView.state.doc.toString() 会获取到编辑之前的内容

        this.addListener(dialog.element, "wheel", (event: Event) => {
            // 阻止冒泡，否则当菜单打开时，输入框无法使用鼠标滚轮滚动
            event.stopPropagation();
        }, {passive: true});

        this.addListener(dialog.element, "mousedown", () => {
            // 点击 Dialog 时要显示在最上层
            moveElementToTop(dialog.element);
            // 移除菜单上的 b3-menu__item--current，否则 this.globalKeyDownHandler() 会操作菜单
            this.clearMenuSelection();
        });

        // 添加右键菜单 https://github.com/TCOTC/snippets/issues/22
        // 思源 3.8.3+ 起，浏览器原生输入框的右键菜单内容完全由渲染进程控制，
        // IPC 载荷由一组语言字段改为 items 数组，主进程只渲染数组中列出的项。
        // https://github.com/siyuan-note/siyuan/issues/15810
        // https://github.com/siyuan-note/siyuan/issues/17526
        // https://github.com/siyuan-note/siyuan/pull/19100
        // CodeMirror 编辑器中撤销 undo 和重做 redo 无法使用，因此这里直接不发送这两项，
        // 菜单中就不会再出现它们和多余的分隔线。
        this.addListener(dialog.element, "contextmenu", (event: MouseEvent) => {
            if (!(event.target as HTMLElement).closest(".cm-content[contenteditable='true']")) return;
            event.stopPropagation();
            // 尝试使用思源的 ipcRenderer 发送右键菜单事件
            try {
                // 检查是否存在 electron 的 ipcRenderer
                const electron = (window as any).require?.("electron");
                if (electron?.ipcRenderer) {
                    this.console.log("electron:", electron);
                    this.console.log("showContextMenu: use ipcRenderer");
                    electron.ipcRenderer.send(Constants.SIYUAN_CONTEXT_MENU, {
                        x: event.clientX,
                        y: event.clientY,
                        requestedAt: Date.now(),
                        items: [
                            {role: "copy", label: window.siyuan.languages.copy},
                            {role: "cut", label: window.siyuan.languages.cut},
                            {role: "delete", label: window.siyuan.languages.delete},
                            {role: "paste", label: window.siyuan.languages.paste},
                            {role: "pasteAndMatchStyle", label: window.siyuan.languages.pasteAsPlainText},
                            {role: "selectAll", label: window.siyuan.languages.selectAll},
                        ],
                    });
                    return;
                }
            } catch (error) {
                this.console.log("Failed to use ipcRenderer:", error);
            }
        }, {capture: true});

        // 在菜单打开的情况下，移动端无法上下划动对话框中的编辑器，需要阻止事件冒泡
        this.addListener(dialog.element, "touchmove", (event: TouchEvent) => {
            event.stopPropagation();
        }, {passive: true});

        const closeElement = dialog.element.querySelector(".b3-dialog__close") as HTMLElement;
        const scrimElement = dialog.element.querySelector(".b3-dialog__scrim") as HTMLElement;
        // 代码片段编辑对话框的 .b3-dialog__scrim 元素只在桌面端被移除，移动端还是有的，所以要处理点击

        this.addListener(dialog.element, "click", async (event: MouseEvent | CustomEvent) => {
            const target = event.target as HTMLElement;
            const tagName = target.tagName.toLowerCase();
            const isDispatch = typeof event.detail === "string";
            if (tagName === "input" && target === snippetSwitchInput) {
                // 切换代码片段的开关状态
                if (this.realTimePreview && snippet.type === "css") {
                    previewHandler();
                }
            } else if (tagName === "button") {
                // CodeMirror 搜索面板内的按钮由编辑器自身通过 onclick 处理，不能在捕获阶段拦截，
                // 否则 stopPropagation 会阻止事件到达目标按钮，导致 onclick 不执行 https://github.com/TCOTC/snippets/issues/38
                if (target.closest(".cm-search")) {
                    return;
                }
                // 阻止冒泡，否则点击确认按钮会导致 menu 关闭
                event.stopPropagation();
                // 移除焦点，否则点击按钮后如果不关闭 Dialog 的话会一直显示 :focus 样式
                target.blur();
                switch (target.dataset.action) {
                    case "delete":
                        // 弹窗确定后删除代码片段/不新建代码片段、关闭 Dialog
                        this.openSnippetDeleteDialog(snippet.name, () => {
                            this.deleteSnippet(snippet.id, snippet.type);
                            this.closeDialogByElement(dialog.element);
                        }); // 取消后无操作
                        break;
                    case "cancel":
                        // 取消
                        void cancelHandler();
                        break;
                    case "preview":
                        // 预览 CSS 代码片段
                        if (snippet.type === "css") {
                            previewHandler();
                        }
                        break;
                    case "confirm":
                        // 新建/更新代码片段
                        void saveHandler();
                        break;
                }
            } else if (target === closeElement || target === scrimElement || (isDispatch && event.detail === "Escape")) {
                // 阻止冒泡，否则点击会导致 menu 关闭
                event.stopPropagation();
                void cancelHandler();
            }
            return;
        }, {capture: true}); // 点击 .b3-dialog__close 和 .b3-dialog__scrim 时需要在捕获阶段阻止冒泡才行，因为原生在这两个元素上有监听器

        this.addListener(dialog.element, "click", async (event: Event) => {
            // 阻止冒泡，否则点击 Dialog 时会导致 menu 关闭
            event.stopPropagation();
        });

        // 打开对话框时先执行一次预览
        if (snippet.type === "css" && this.realTimePreview) {
            previewHandler();
        }

        return true;

        // 还能插入 Protyle 编辑器，以后说不定能用上
        // new Protyle(this.app, dialog.element.querySelector("#protyle"), {
        //     blockId: this.getEditor().protyle.block.rootID,
        // });
    }

    /**
     * 打开代码片段删除对话框
     * @param snippetName 代码片段名称
     * @param confirm 确认回调
     */
    private openSnippetDeleteDialog(snippetName: string, confirm?: () => void) {
        // TODO功能: 实现了代码片段回收站之后，增加一个“不再提示”按钮，点击之后修改配置项、弹出消息说明可以在插件设置中开关
        this.openConfirmDialog(
            this.i18n.deleteConfirm,
            this.i18n.deleteConfirmDescription.replace("${x}", snippetName ? " <b>" + snippetName + "</b> " : ""),
            "jcsm-snippet-delete",
            undefined,
            this.i18n.delete,
            () => {
                // 删除代码片段
                confirm?.();
            }
        );

        // 不需要移除菜单上的 b3-menu__item--current，方便判断点击的是哪个代码片段
        // this.unselectSnippet();
    }

    /**
     * 打开代码片段取消对话框
     * @param snippet 代码片段
     * @param isNew 是否是新建代码片段
     * @param changes 变更内容
     * @param confirm 确认回调
     * @param cancel 取消回调
     */
    private openSnippetCancelDialog(snippet: Snippet, isNew?: boolean, changes?: string[], confirm?: () => void, cancel?: () => void) {
        const snippetName = snippet.name.trim();
        let text: string;
        if (isNew) {
            text = this.i18n.cancelConfirmNewSnippet
                .replace("${y}", snippetName ? " <b>" + snippetName + "</b> " : "");
        } else {
            // 将每个 change 用 <b> 标签包裹
            const changesText = changes?.map(change => `<b>${change}</b>`).join(", ") ?? "";
            text = this.i18n.cancelConfirmEditSnippet
                .replace("${x}", changesText)
                .replace("${y}", snippetName ? " <b>" + snippetName + "</b> " : "");
        }

        this.openConfirmDialog(
            this.i18n.cancelConfirm,
            text,
            "jcsm-snippet-cancel",
            this.i18n.continueEdit,
            this.i18n.giveUpEdit,
            () => { confirm?.(); }, // 取消编辑代码片段
            () => { cancel?.(); }
        );
    }

    /**
     * 打开确认对话框（参考原生代码 app/src/dialog/confirmDialog.ts ）
     * @param title 对话框标题
     * @param text 对话框内容
     * @param dataKey 对话框元素的 data-key 属性值
     * @param cancelText 取消按钮文本
     * @param confirmText 确认按钮文本
     * @param confirm 确认回调
     * @param cancel 取消回调
     */
    private openConfirmDialog(title: string, text: string, dataKey?: string, cancelText?: string, confirmText?: string, confirm?: () => void, cancel?: () => void) {
        if (!text && !title) {
            confirm?.();
            return;
        }

        const redButton = dataKey === "jcsm-snippet-delete" || dataKey === "jcsm-snippet-cancel"; // 删除和放弃修改按钮是红色

        const dialog = new Dialog({
            title,
            content: `
<div class="b3-dialog__content">
    <div class="ft__breakword">${text}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${ cancelText ?? this.i18n.cancel }</button>
    <div class="fn__space"></div>
    <button class="b3-button ${ redButton ? "b3-button--remove" : "b3-button--text"}" data-type="confirm">${ confirmText ?? this.i18n.confirm}</button>
</div>
            `,
            width: this.isMobile ? "92vw" : "520px",
        });
        (dialog.element as any).dialogObject = dialog;

        dialog.element.setAttribute("data-key", dataKey ?? "dialog-confirm"); // Constants.DIALOG_CONFIRM
        dialog.element.setAttribute("data-modal", "true");  // 标记为模态对话框
        const container = dialog.element.querySelector(".b3-dialog__container") as HTMLElement;
        if (container) container.style.maxHeight = "90vh";

        const closeElement = dialog.element.querySelector(".b3-dialog__close") as HTMLElement;
        const scrimElement = dialog.element.querySelector(".b3-dialog__scrim") as HTMLElement;

        dialog.destroyNative = dialog.destroy;
        dialog.destroy = () => {
            this.console.log("confirmDialog destroy");
            cancel?.();
            this.closeDialogByElement(dialog.element);
        };

        // 在菜单打开的情况下，移动端无法上下划动对话框中的滚动容器，需要阻止事件冒泡
        this.addListener(dialog.element, "touchmove", (event: TouchEvent) => {
            event.stopPropagation();
        }, {passive: true});

        this.addListener(dialog.element, "click", (event: KeyboardEvent) => {
            this.console.log("confirmDialog click", event);
            // 阻止冒泡，否则点击 Dialog 时会导致 menu 关闭
            event.stopPropagation();
            let target = event.target as HTMLElement;
            const isDispatch = typeof event.detail === "string";
            while (target && target !== dialog.element || isDispatch) {
                if (target.dataset.type === "cancel" || (isDispatch && event.detail=== "Escape")) {
                        cancel?.();
                        this.closeDialogByElement(dialog.element);
                    break;
                } else if (target.dataset.type === "confirm" || (isDispatch && event.detail=== "Enter")) {
                        confirm?.();
                        this.closeDialogByElement(dialog.element);
                    break;
                } else if (target === closeElement || target === scrimElement) {
                    cancel?.();
                    this.closeDialogByElement(dialog.element);
                    break;
                }
                target = target.parentElement as HTMLElement;
            }
        }, {capture: true});
    }

    /**
     * 通过元素关闭对话框
     * @param dialogElement 对话框元素
     */
    private closeDialogByElement(dialogElement: HTMLElement) {
        if (!dialogElement) {
            this.console.error("closeDialogByElement: dialogElement is undefined, return");
            return;
        }
        this.console.log("closeDialogByElement: dialogElement:", dialogElement);

        // 如果是代码片段编辑对话框
        if (dialogElement.dataset.key === "jcsm-snippet-dialog") {
            // 销毁 CodeMirror 编辑器
            const editorElement = dialogElement.querySelector(".jcsm-dialog-content .cm-editor");
            if (editorElement && (editorElement as any).cmView && (editorElement as any).cmView.destroy) {
                this.console.log("closeDialogByElement: destroying CodeMirror editor");
                (editorElement as any).cmView.destroy();
            }
            // 移除菜单项编辑按钮的背景色
            this.removeSnippetEditButtonActive(dialogElement.dataset.snippetId!);
        }

        // 移除事件监听器
        this.removeListener(dialogElement);

        const destroyEventHandler = () => {
            // Dialog 移除之后再移除全局键盘事件监听，因为需要判断窗口中是否还存在菜单和 Dialog
            this.destroyGlobalKeyDownHandler();
            // 检查并停止主题模式监听（在最后一个编辑器对话框关闭时）
            this.editorManager.checkAndManageThemeWatch();
        };

        let isDestroyed = false;
        const dialogObject = (dialogElement as any).dialogObject;
        const destroyCallback = dialogObject.destroyCallback || undefined;
        if (dialogObject) {
            dialogObject.destroyCallback = () => {
                isDestroyed = true;
                // 调用原有的 destroyCallback
                destroyCallback?.();
                destroyEventHandler();
            };
            // 修改 zIndex 以避免 menu 被移除 https://github.com/siyuan-note/siyuan/blob/ffad6048fdd677c78b6649d94315d3702391beb2/app/src/dialog/index.ts#L91-L95
            (dialogElement.querySelector(".b3-dialog") as HTMLElement).style.zIndex = ((parseInt(window.siyuan.menus.menu.element.style.zIndex) || 0) + 1).toString();
            dialogObject.destroyNative();
        }

        // 基本是原生 dialog.destroy() 的逻辑，但移除了不必要的操作
        const customDestroy = (options?: any) => {
            dialogElement.classList.remove("b3-dialog--open");
            setTimeout(() => {
                dialogElement.remove();
                if (destroyCallback) {
                    destroyCallback(options);
                }
                window.siyuan.dialogs.find((item: Dialog, index: number) => {
                    if (item.id === dialogObject.id) {
                        window.siyuan.dialogs.splice(index, 1);
                        return true;
                    }
                });
                // https://github.com/siyuan-note/siyuan/issues/10475
                document.getElementById("drag")?.classList.remove("fn__hidden");
            }, Constants.TIMEOUT_DBLCLICK);
        };

        // 1 秒后检查是否已销毁，没有的话则手动销毁
        setTimeout(() => {
            if (!isDestroyed) {
                customDestroy();
                destroyEventHandler();
            }
        }, 1000);
    }

    /**
     * 获取所有模态对话框元素
     * @returns 对话框元素数组
     */
    private getAllModalDialogElements(): HTMLElement[] {
        // 模态对话框打开时，不允许打开或操作菜单和代码片段编辑对话框，否则 this.globalKeyDownHandler() 判断不了 Escape 和 Enter 按键是对哪个元素的操作
        return Array.from(document.querySelectorAll("body > .b3-dialog--open[data-key^='jcsm-']:not([data-modal='false'])")) as HTMLElement[];
    }

    // ================================ 消息处理 ================================

    /**
     * 弹出通知（实现见 src/services/feedback.ts FeedbackService）
     * @param messageI18nKey 消息的 i18n 键
     * @param timeout 消息显示时间（毫秒）；-1 永不关闭；0 永不关闭，添加一个关闭按钮；undefined 默认 6000 毫秒
     */
    private showNotification(messageI18nKey: string, timeout: number | undefined = undefined) {
        this.feedbackService.showNotification(messageI18nKey, timeout);
    }

    /**
     * 弹出错误消息（实现见 src/services/feedback.ts FeedbackService）
     * @param message 错误消息
     * @param timeout 消息显示时间（毫秒）；-1 永不关闭；0 永不关闭，添加一个关闭按钮；undefined 默认 6000 毫秒
     * @param id 消息的 ID
     */
    private showErrorMessage(message: string, timeout: number | undefined = undefined, id?: string) {
        this.feedbackService.showErrorMessage(message, timeout, id);
    }

    // ================================ 工具方法 ================================

    /**
     * 生成新的代码片段 ID
     * @returns 新的代码片段 ID
     */
    private genNewSnippetId(): string {
        let newId = window.Lute.NewNodeID();
        while (this.snippetsList.find((s: Snippet) => s.id === newId)) {
            newId = window.Lute.NewNodeID();
        }
        return newId;
    }

    /**
     * 判断是否正在预览代码片段
     * @param snippetId 代码片段 ID
     * @param snippetType 代码片段类型
     * @returns 是否正在预览
     */
    private isPreviewingSnippet(snippetId: string, snippetType: string): boolean {
        return snippetType === "css" && this.realTimePreview && !!document.querySelector(`.b3-dialog--open[data-key="jcsm-snippet-dialog"][data-snippet-id="${snippetId}"]`);
    }

    /**
     * 重新加载界面
     */
    private reloadUI() {
        // 方案1：获取界面上所有打开的代码片段编辑对话框，判断是否存在未保存的变更，如果有的话需要弹窗确认再重载界面
        // 先用方案 1 顶顶，之后看看能不能实现方案 2
        // TODO: 方案2：获取界面上所有打开的代码片段编辑对话框（包括相关内联样式），重载界面之后恢复对话框的位置、大小、内容...

        // 获取所有打开的代码片段编辑对话框
        const dialogs = document.querySelectorAll(".b3-dialog--open[data-key='jcsm-snippet-dialog']");
        // 判断是否存在未保存的变更
        let needConfirm = false;
        for (let i = 0; i < dialogs.length; i++) {
            const dialog = dialogs[i] as HTMLElement;
            const snippetId = dialog.getAttribute("data-snippet-id");
            const snippet = this.snippetsList.find((s: Snippet) => s.id === snippetId);
            // 获取代码片段的标题
            const titleElement = dialog.querySelector(".jcsm-dialog-name") as HTMLInputElement;
            const title = titleElement?.value || "";
            // 从编辑器获取代码
            const editorElement = dialog.querySelector(".cm-editor") as HTMLElement;
            const editorView = (editorElement as any).cmView as EditorView;
            const code = editorView.state.doc.toString() || "";
            if (
                (snippet && (title !== snippet.name || code !== snippet.content)) // 已存在的代码片段，判断标题或内容是否有变更
                || (!snippet && (title !== "" || code !== ""))                    // 新建代码片段，判断是否有内容
            ) {
                // 只要有一个未保存变更就停止循环
                needConfirm = true;
                break;
            }
        }

        if (needConfirm) {
            this.openConfirmDialog(this.i18n.reloadUIConfirm, this.i18n.reloadUIConfirmDescription, "jcsm-reload-ui-confirm", undefined, undefined,  () => {
                this.postReloadUI();
            });
        } else {
            this.postReloadUI();
        }
    }

    /**
     * 发送重新加载界面请求
     */
    private postReloadUI() {
        fetchPost("/api/ui/reloadUI", (response: any) => {
            if (response.status !== 200) {
                this.showErrorMessage(this.i18n.reloadUIFailed);
            }
        });
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
     * 控制台调试输出
     */
    private console = (() => {
        // 日志编号计数器，从 1 开始
        let logCounter = 1;

        /**
         * 获取当前编号字符串，格式为 3 位数字（如 001、002）
         */
        const getLogNumber = () => {
            const num = logCounter.toString().padStart(3, "0");
            logCounter++;
            return num;
        };

        /**
         * 通用日志输出方法，简化重复代码
         * @param label 日志标签
         * @param args 日志内容
         */
        const output = (label: string, args: any[]) => {
            const logNumber = getLogNumber();
            console.groupCollapsed(`[${logNumber}] ${label}:`, ...args); // 使用 console.groupCollapsed 创建可折叠的日志组，保持源代码可点击性
            console.trace("Call Stack:"); // 使用 console.trace 输出可点击的调用栈
            console.groupEnd();
        };

        return {
            /**
             * 输出调试日志
             * @param args 日志内容
             */
            log: (...args: any[]) => {
                if (!this.consoleDebug) return;
                output("Log", args);
            },
            /**
             * 输出警告日志
             * @param args 日志内容
             */
            warn: (...args: any[]) => {
                output("Warning", args);
            },
            /**
             * 输出错误日志
             * @param args 日志内容
             */
            error: (...args: any[]) => {
                output("Error", args);
            }
        };
    })();

    /**
     * 全局键盘按下事件处理
     * @param event 键盘事件
     */
    private globalKeyDownHandler = (event: KeyboardEvent) => {
        // 获取所有打开的插件模态对话框，把按键操作发送给 DOM 最下方，也就是最顶层的对话框
        // 无法判断是在操作哪个代码片段编辑对话框（非模态），所以此处忽略代码片段编辑对话框 jcsm-snippet-dialog 的操作
        const dialogElements = this.getAllModalDialogElements();
        const dialogElement = dialogElements[dialogElements.length - 1];
        if (dialogElement) {
            // // 如果按 Esc 时焦点在输入框里，移除焦点
            // if (event.key === "Escape" && this.isInputElementActive()) {
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
                this.console.log("globalKeyDownHandler: Esc, dispatchEvent to maxZIndexElement", maxZIndexElement);
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
                this.console.log("globalKeyDownHandler: Escape, Enter, ArrowUp, ArrowDown, ArrowLeft, ArrowRight", event.key);
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
     * 移除全局键盘按下事件监听
     */
    private destroyGlobalKeyDownHandler = () => {
        if (!this.isDialogAndMenuOpen()) {
            // 窗口内没有打开的 Dialog 和菜单之后才移除事件监听
            this.removeListener(document.documentElement, "keydown", this.globalKeyDownHandler);
        }
    };

    /**
     * 是否存在打开的插件对话框和菜单
     * @returns 是否存在
     */
    private isDialogAndMenuOpen(): boolean {
        return document.querySelectorAll(".b3-dialog--open[data-key^='jcsm-']").length > 0 || !!this.menu;
    }


    // ================================ 事件监听管理 ================================

    /**
     * 添加事件监听器（统一簿记见 src/services/listener-registry.ts）
     * @param element 元素
     * @param event 事件
     * @param fn 回调函数
     * @param options 监听器选项
     */
    private addListener(element: HTMLElement, event: string, fn: (event?: Event) => void, options?: AddEventListenerOptions) {
        this.listenerRegistry.add(element, event, fn, options);
    }

    /**
     * 移除事件监听器（统一簿记见 src/services/listener-registry.ts）
     * @param element 元素
     * @param event 事件
     * @param fn 回调函数
     * @param options 监听器选项
     */
    private removeListener(element: HTMLElement, event?: string, fn?: (event?: Event) => void, options?: AddEventListenerOptions) {
        this.listenerRegistry.remove(element, event, fn, options);
    }


    // ================================ 文件监听功能（实现见 src/services/file-watch.ts） ================================
    /**
     * 文件监听模式
     */
    declare fileWatchEnabled: string;

    /**
     * 文件监听路径
     */
    declare fileWatchPath: string;

    /**
     * 文件监听间隔（秒）
     */
    declare fileWatchInterval: number;

    // ================================ 跨窗口同步 ================================

    /**
     * 跨窗口广播服务（阶段 3：传输 + 窗口保活收敛于 services/sync.ts）
     * onLayoutReady 中创建并启动；业务消息按 type 查表分发到 handlers 注册表（见构造处）。
     */
    private syncService: BroadcastService | null = null;
}




