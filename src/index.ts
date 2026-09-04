import "./index.scss";
import {Snippet, SnippetType} from "./types";
import {SNIPPETS_CHANGED, SnippetStore} from "./domain/snippet-store";
import {createSnippetsConfigItems} from "./config/schema";
import type {SnippetsConfigItem} from "./config/schema";
import {ConfigService, STORAGE_NAME} from "./config/config-service";
import {BroadcastService} from "./services/sync";
import {FileWatchService} from "./services/file-watch";
import {EventBus} from "./core/event-bus";
import {ImportExportService} from "./services/import-export";
import {FeedbackService} from "./services/feedback";
import {ListenerRegistry} from "./services/listener-registry";
import {SnippetManager} from "./services/snippet-manager";
import {SnippetsMenu} from "./ui/menu";

// 思源插件 API
import {
    fetchPost,
    getFrontend,
    Plugin,
    Setting
} from "siyuan";
// 未使用的：Custom、confirm、openTab、adaptHotkey、getBackend、Protyle、openWindow、IOperation、openMobileFileById、lockScreen、ICard、ICardData、exitSiYuan、getModelByDockType、getAllEditor、Files、openAttributePanel、saveLayout

// 工具函数
import {isPromiseFulfilled} from "./utils";

// CodeMirror 6（编辑器扩展/视图创建/生命周期管理已外迁至 src/ui/codemirror.ts、src/ui/editor-manager.ts 与 src/ui/snippets-dialog.ts）
import {EditorManager} from "./ui/editor-manager";
import {SettingDialog} from "./ui/setting-dialog";
import {SnippetsDialog} from "./ui/snippets-dialog";

const PLUGIN_NAME = "snippets";                    // 插件名
// const TAB_TYPE = "custom-tab"; // 自定义标签页

// noinspection JSUnusedGlobalSymbols
export default class PluginSnippets extends Plugin {
    // private custom: () => Custom; // 自定义标签页

    // ================================ 生命周期方法 ================================

    /**
     * 是否为移动端（onLayoutReady 时按前端类型赋值；运行态标志收敛自 window.siyuan.jcsm，
     * 实例字段即可——每次插件加载都会重算，无需跨 reload 全局仓库）
     */
    isMobile = false;

    /**
     * 是否为触摸设备（onLayoutReady 时赋值，同上收敛自 jcsm）
     */
    isTouchDevice = false;

    /**
     * 顶栏按钮元素（SnippetsMenu 直连访问，故公开）
     */
    topBarElement!: HTMLElement;

    /**
     * 类型化事件总线：数据变更后驱动 UI 刷新等内部解耦
     */
    private internalEventBus = new EventBus();

    /**
     * 代码片段列表 Store：数据写路径的单一入口，统一在列表变更后触发 SNIPPETS_CHANGED 事件
     * （SnippetManager 直连访问，故公开）
     */
    snippetStore!: SnippetStore;

    /**
     * 顶栏菜单管理器（打开/绘制/事件/拖拽/搜索/高亮见 src/ui/menu.ts SnippetsMenu，构造直连本实例）
     */
    menuView!: SnippetsMenu;

    /**
     * 代码片段管理器（创建/保存/删除/元素注入见 src/services/snippet-manager.ts，构造直连本实例）
     * （SnippetsMenu/SnippetsDialog 直连访问，故公开）
     */
    snippetManager!: SnippetManager;

    /**
     * 编辑器对话框生命周期管理（主题监听 + 已打开编辑器更新/重建，实现见 src/ui/editor-manager.ts）
     * （SnippetsDialog/SnippetsMenu 直连访问，故公开）
     */
    editorManager!: EditorManager;

    /**
     * 设置对话框管理器（装配与交互见 src/ui/setting-dialog.ts，公开 openSetting 委托到它）
     */
    settingDialog!: SettingDialog;

    /**
     * 对话框管理器（代码片段编辑/确认对话框与按元素关闭见 src/ui/snippets-dialog.ts SnippetsDialog）
     */
    snippetsDialog!: SnippetsDialog;

    /**
     * 配置服务（装配/持久化/热应用见 src/config/config-service.ts；SettingDialog 直连访问，故公开）
     */
    configService!: ConfigService;

    /**
     * 文件监听服务（文件夹代码片段监听见 src/services/file-watch.ts）
     */
    private fileWatchService!: FileWatchService;

    /**
     * 导入导出服务（代码片段导出/导入见 src/services/import-export.ts；SettingDialog 直连访问，故公开）
     */
    importExportService!: ImportExportService;

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
        // 初始化代码片段列表 Store（后端为插件实例 snippetsList 缓存：以内核为权威，菜单打开/保存后自拉刷新）
        this.snippetStore = new SnippetStore(this.internalEventBus, {
            get: () => this.snippetsList,
            set: (snippetsList) => {
                this.snippetsList = snippetsList;
            },
        });

        // 初始化代码片段管理器（直连本实例，运行态延迟到调用时读取）
        this.snippetManager = new SnippetManager(this);

        // 初始化顶栏菜单管理器（直连本实例，运行态延迟到调用时读取）
        this.menuView = new SnippetsMenu(this);

        // 初始化编辑器对话框生命周期管理器（直连本实例，editorIndentUnit 等调用时读取）
        this.editorManager = new EditorManager(this);

        // 初始化配置服务（直连本实例；配置读写经本模块自持存储键名与插件生命周期数据方法）
        this.configService = new ConfigService(this);

        // 初始化设置对话框管理器（直连本实例）
        this.settingDialog = new SettingDialog(this);

        // 初始化文件监听服务（直连本实例，配置镜像经实例读取）
        this.fileWatchService = new FileWatchService(this);

        // 初始化导入导出服务（直连本实例，列表读写/菜单刷新经服务内转发）
        this.importExportService = new ImportExportService(this);

        // 初始化通知/错误提示服务（直连本实例，配置开关经实例 defineProperty 镜像读取）
        this.feedbackService = new FeedbackService(this);

        // 初始化事件监听器簿记（监听器登记与元素清理见 src/services/listener-registry.ts）
        this.listenerRegistry = new ListenerRegistry(this);

        // 初始化对话框管理器（代码片段编辑对话框/确认对话框/按元素关闭等；直连本实例）
        this.snippetsDialog = new SnippetsDialog(this);

        // 订阅代码片段列表变更事件：菜单打开时刷新各类型计数
        this.internalEventBus.on(SNIPPETS_CHANGED, (_snippetId: string) => {
            this.menuView.setMenuSnippetCount();
        });
    }

    /**
     * 顶栏按钮位置
     */
    declare topBarPosition: "left" | "right";

    /**
     * 布局加载完成
     */
    public async onLayoutReady() {
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

        // 顶栏按钮图标（iconJcsm symbol 注册见 SnippetsMenu.initIcons，src/ui/menu.ts）
        this.menuView.initIcons();

        this.menuView.initTopBar().then();

        // 注册快捷键（都默认置空）
        this.addCommand({
            langKey: "openSnippetsManager", // 打开代码片段管理器
            hotkey: "",
            callback: () => {
                // 快捷键唤起菜单时，如果菜单已经打开，要先关闭再重新打开，所以这里直接执行就好，会自动关闭菜单再重开
                this.menuView.openSnippetsManager();
            },
        });
        this.addCommand({
            langKey: "reloadUI", // 重新加载界面
            hotkey: "",
            callback: () => {
                // 重载界面（扫描打开的编辑对话框未保存变更并二次确认）见 SnippetsDialog.reloadUI
                this.snippetsDialog.reloadUI();
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

        // 初始化跨窗口同步服务用于跨窗口通信（需要等插件设置加载完成；传输 + 窗口保活收敛于 services/sync.ts）
        this.syncService = new BroadcastService({
            logger: this.console,
            // 业务分发注册表见 SnippetManager.buildSyncHandlers（src/services/snippet-manager.ts）：
            // 各消息键把远程广播映射到同一方法并传 origin 为 "remote"，接收窗口按 snippetId 自拉权威数据
            handlers: this.snippetManager.buildSyncHandlers(),
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
        this.menuView.close();

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

        // 移除所有 Dialog（关闭全部插件模态对话框，实现见 SnippetsDialog.closeAllDialogs）
        this.snippetsDialog.closeAllDialogs();

        // 移除 CodeMirror 编辑器样式（实现见 EditorManager.cleanupEditorStyles）
        this.editorManager?.cleanupEditorStyles();

        // 移除菜单
        this.menuView.close();

        // 停止文件监听
        this.fileWatchService.stop();

        // TODO自定义页签: 移除所有自定义页签

        // 停止主题模式监听
        this.editorManager?.stopThemeModeWatch();

        // 移除所有监听器
        this.listenerRegistry.destroy();

        console.log(this.displayName, this.i18n.pluginUninstall);
    }


    // ================================ 插件设置 ================================

    /**
     * 插件设置
     */
    public setting!: Setting;

    /**
     * 配置文件版本（配置结构有变化时升级；ConfigService 直连访问，故公开）
     */
    version = 1;

    /**
     * CSS 代码片段实时预览（必须与 snippet.type === "css" 一起使用）
     */
    realTimePreview!: boolean;

    /**
     * 新建代码片段时默认启用
     */
    newSnippetEnabled!: boolean;

    /**
     * 在开发者工具中输出插件日志（ListenerRegistry 直连访问，故公开）
     */
    consoleDebug!: boolean;

    /**
     * 配置项定义（类型定义与条目构建见 src/config/schema.ts；ConfigService 直连访问，故公开）
     */
    configItems: SnippetsConfigItem[] = [];

    /**
     * 初始化配置项（条目定义见 src/config/schema.ts，此处仅构建一次并挂到实例；ConfigService 直连调用，故公开）
     * 注意在这里面不能用 this.console 之类的方法，因为它们需要先加载完插件配置才能用
     */
    async initConfigItems() {
        if (this.configItems.length > 0) {
            // 已构建过则直接复用（构建结果与运行态无关，运行态由读取器/动作函数实时转发）
            return;
        }
        this.configItems = createSnippetsConfigItems({
            isMobile: () => this.isMobile,
            i18n: () => this.i18n,
            menuItems: () => this.menuView.menuItems,
            menuOpen: () => !!this.menuView.menu,
            menuSnippetsItemsHtml: () => this.menuView.genMenuSnippetsItems(),
            updateAllEditorConfigs: (reason) => this.editorManager.updateAllEditorConfigs(reason),
            removeTopBarElement: () => this.topBarElement?.remove(),
            initTopBar: () => this.menuView.initTopBar(),
            setMenuPosition: (isUpdate) => this.menuView.setMenuPosition(isUpdate),
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


    // ================================ 顶栏菜单（实现见 src/ui/menu.ts SnippetsMenu） ================================
    // 打开/绘制/事件/搜索/拖拽/高亮与菜单状态（menu/menuItems/拖拽标志等）均已外迁至 SnippetsMenu，
    // 插件实例仅保留供 SnippetsMenu 经 defineProperty 读取的镜像属性声明。

    /**
     * 是否启用自动重新加载界面功能
     */
    declare autoReloadUIAfterModifyJS: boolean;

    /**
     * 点击代码片段选项的行为
     * 0：无操作
     * 1：切换代码片段开关状态
     * 2：打开代码片段编辑器
     */
    declare snippetOptionClickBehavior: number;

    /**
     * 代码片段的排序方式
     */
    declare snippetSortType: string;

    /**
     * 代码片段搜索类型
     * 0: 不搜索
     * 1: 按标题搜索
     * 2: 按代码内容搜索
     * 3: 按标题和代码内容搜索
     */
    declare snippetSearchType: number;

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
     * 是否需要重新加载界面（JS 修改后的呼吸提示标志；收敛自 window.siyuan.jcsm，
     * 属菜单 UI 运行态——界面刷新/插件重载后自然复位，无需跨 reload 全局仓库）
     */
    isReloadUIRequired = false;


    // ================================ 代码片段管理 ================================

    /**
     * 代码片段列表缓存（以内核 /api/snippet/getSnippet 为权威：菜单打开/保存/删除/排序等场景自拉刷新；
     * 收敛自 window.siyuan.jcsm.snippetsList——仅作同页会话缓存，插件重载后由下一次自拉重建）
     */
    snippetsList: Snippet[] = [];

    /**
     * 默认代码片段类型（配置镜像 defaultSnippetsType：ConfigService 内部缓存 + defineProperty 代理）
     */
    declare defaultSnippetsType: SnippetType;

    /**
     * 用户会话中切换过的代码片段类型缓存（收敛自 window.siyuan.jcsm.snippetsType，
     * 重载后回退配置默认值 defaultSnippetsType）
     */
    private snippetsTypeCache: SnippetType | undefined;

    /**
     * 当前代码片段类型（用户切换过则用缓存值，否则用配置默认值；读点语义与原 jcsm 实现一致）
     */
    get snippetsType(): SnippetType {
        // 如果已经有值（用户切换过标签），使用该值，否则使用配置中的默认值（defaultSnippetsType 配置镜像
        // 已收敛为 ConfigService 内部缓存并经 defineProperty 代理，见 src/config/config-service.ts）
        const type = this.snippetsTypeCache ?? this.defaultSnippetsType;
        if (type !== "css" && type !== "js") {
            return "css";
        }
        return type;
    }
    set snippetsType(value: SnippetType) { this.snippetsTypeCache = value; }


    // ================================ 对话框相关（实现见 src/ui/snippets-dialog.ts SnippetsDialog） ================================

    /**
     * 编辑器缩进单位
     */
    declare editorIndentUnit: string;

    /**
     * 是否允许同时打开多个代码片段编辑器
     */
    declare multipleSnippetEditors: boolean;


    // ================================ 消息处理 ================================

    /**
     * 弹出通知（实现见 src/services/feedback.ts FeedbackService）
     * @param messageI18nKey 消息的 i18n 键
     * @param timeout 消息显示时间（毫秒）；-1 永不关闭；0 永不关闭，添加一个关闭按钮；undefined 默认 6000 毫秒
     */
    showNotification(messageI18nKey: string, timeout: number | undefined = undefined) {
        this.feedbackService.showNotification(messageI18nKey, timeout);
    }

    /**
     * 弹出错误消息（实现见 src/services/feedback.ts FeedbackService）
     * @param message 错误消息
     * @param timeout 消息显示时间（毫秒）；-1 永不关闭；0 永不关闭，添加一个关闭按钮；undefined 默认 6000 毫秒
     * @param id 消息的 ID
     */
    showErrorMessage(message: string, timeout: number | undefined = undefined, id?: string) {
        this.feedbackService.showErrorMessage(message, timeout, id);
    }

    // ================================ 工具方法 ================================

    /**
     * 发送重新加载界面请求（SnippetsMenu/FileWatchService/SnippetsDialog/各服务直连访问，故公开）
     */
    postReloadUI() {
        fetchPost("/api/ui/reloadUI", (response: any) => {
            if (response.status !== 200) {
                this.showErrorMessage(this.i18n.reloadUIFailed);
            }
        });
    }

    /**
     * 通过命令名称获取用户自定义快捷键（SnippetsMenu 直连访问，故公开）
     * @param command 命令名称
     * @returns 用户自定义快捷键
     */
    getCustomKeymapByCommand(command: string): string {
        return window.siyuan.config.keymap.plugin?.[PLUGIN_NAME]?.[command]?.custom || "";
    }

    /**
     * 控制台调试输出（SnippetManager 直连访问，故公开）
     */
    console = (() => {
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

    // 全局键盘按下/移除事件监听与开合判断（globalKeyDownHandler/destroyGlobalKeyDownHandler/isDialogAndMenuOpen）
    // 已随菜单一并外迁至 src/ui/menu.ts SnippetsMenu

    // ================================ 事件监听管理 ================================

    /**
     * 添加事件监听器（统一簿记见 src/services/listener-registry.ts；各 UI/服务直连访问，故公开）
     * @param element 元素
     * @param event 事件
     * @param fn 回调函数
     * @param options 监听器选项
     */
    addListener(element: HTMLElement, event: string, fn: (event?: Event) => void, options?: AddEventListenerOptions) {
        this.listenerRegistry.add(element, event, fn, options);
    }

    /**
     * 移除事件监听器（统一簿记见 src/services/listener-registry.ts；各 UI/服务直连访问，故公开）
     * @param element 元素
     * @param event 事件
     * @param fn 回调函数
     * @param options 监听器选项
     */
    removeListener(element: HTMLElement, event?: string, fn?: (event?: Event) => void, options?: AddEventListenerOptions) {
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
     * （SnippetManager 直连访问，故公开）
     */
    syncService: BroadcastService | null = null;
}
