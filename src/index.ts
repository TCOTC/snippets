import "./index.scss";
import {Snippet, SnippetType} from "./types";
import {SnippetStore} from "./domain/snippet-store";
import {ConfigService, STORAGE_NAME} from "./config/config-service";
import {BroadcastService} from "./services/sync";
import {FileWatchService} from "./services/file-watch";
import {ImportExportService} from "./services/import-export";
import {FeedbackService} from "./services/feedback";
import {ListenerRegistry} from "./services/listener-registry";
import {SnippetManager} from "./services/snippet-manager";
import {SnippetsMenu} from "./ui/menu";

// 思源插件 API
import {
    fetchPost,
    getFrontend,
    Plugin
} from "siyuan";

// 工具函数
import {isPromiseFulfilled} from "./utils";

// CodeMirror 编辑器工厂与生命周期管理见 src/ui/editor-manager.ts，编辑对话框见 src/ui/snippets-dialog.ts
import {EditorManager} from "./ui/editor-manager";
import {SettingDialog} from "./ui/setting-dialog";
import {SnippetsDialog} from "./ui/snippets-dialog";

const PLUGIN_NAME = "snippets";                    // 插件名
// const TAB_TYPE = "custom-tab"; // 自定义标签页

// noinspection JSUnusedGlobalSymbols
export default class PluginSnippets extends Plugin {
    /**
     * 是否为移动端
     */
    isMobile = false;

    /**
     * 代码片段列表 Store：数据写路径的单一入口
     */
    snippetStore!: SnippetStore;

    /**
     * 顶栏菜单管理器（打开/绘制/事件/拖拽/搜索/高亮见 src/ui/menu.ts SnippetsMenu）
     */
    menuView!: SnippetsMenu;

    /**
     * 代码片段管理器（创建/保存/删除/元素注入见 src/services/snippet-manager.ts）
     */
    snippetManager!: SnippetManager;

    /**
     * 编辑器对话框生命周期管理（主题监听 + 已打开编辑器更新/重建，实现见 src/ui/editor-manager.ts）
     */
    editorManager!: EditorManager;

    /**
     * 设置对话框管理器（装配与交互见 src/ui/setting-dialog.ts）
     */
    settingDialog!: SettingDialog;

    /**
     * 对话框管理器（代码片段编辑/确认对话框与按元素关闭见 src/ui/snippets-dialog.ts SnippetsDialog）
     */
    snippetsDialog!: SnippetsDialog;

    /**
     * 配置服务（装配/持久化/热应用见 src/config/config-service.ts）
     */
    configService!: ConfigService;

    /**
     * 文件监听服务（文件夹代码片段监听见 src/services/file-watch.ts；
     */
    fileWatchService!: FileWatchService;

    /**
     * 导入导出服务（代码片段导出/导入见 src/services/import-export.ts）
     */
    importExportService!: ImportExportService;

    /**
     * 通知/错误提示服务（实现见 src/services/feedback.ts）
     */
    private feedbackService!: FeedbackService;

    /**
     * 事件监听器统一簿记（实现见 src/services/listener-registry.ts）
     */
    private listenerRegistry!: ListenerRegistry;

    /**
     * 跨窗口广播服务（传输/窗口保活/业务分发实现见 services/sync.ts）
     * onLayoutReady 中创建并启动；业务消息按 type 查表分发到 handlers 注册表（见构造处）。
     */
    syncService: BroadcastService | null = null;


    // ================================ 插件配置 ================================
    // 值来自配置文件 plugin-config.json（ConfigService.init 按 configItems 条目逐项覆盖）；
    // 初始值仅占位（与 config-service.ts 条目 defaultValue 一致）。

    /** CSS 代码片段实时预览（须与 snippet.type === "css" 一起使用） */
    realTimePreview = true;

    /** 新建代码片段时默认启用 */
    newSnippetEnabled = true;

    /** 在开发者工具中输出插件日志 */
    consoleDebug = false;

    /** JS 修改后自动重新加载界面 */
    autoReloadUIAfterModifyJS = true;

    /** 点击代码片段选项的行为：0 无操作 / 1 切换开关 / 2 打开编辑器 */
    snippetOptionClickBehavior = 1;

    /** 代码片段排序方式（排序逻辑见 domain/snippet.ts sortSnippets） */
    snippetSortType = "customSort";

    /** 代码片段搜索类型：0 不搜索 / 1 标题 / 2 内容 / 3 标题或内容 */
    snippetSearchType = 1;

    /** 是否显示创建副本按钮 */
    showDuplicateButton = false;

    /** 是否显示删除按钮 */
    showDeleteButton = true;

    /** 是否显示编辑按钮 */
    showEditButton = true;

    /** 发布开关显示策略：0 跟随发布服务 / 1 总是显示 / 2 总是隐藏 */
    showPublishCheckbox = 0;

    /** 新建片段时的默认类型 */
    defaultSnippetsType: SnippetType = "css";

    /** 编辑器缩进单位（CodeMirror 解析见 ui/editor-manager.ts getEditorIndentUnit） */
    editorIndentUnit = "followSiyuan";

    /** 是否允许同时打开多个代码片段编辑器 */
    multipleSnippetEditors = true;

    /** 文件夹监听模式：disabled 禁用 / enabled 监听 / loadOnly 仅启动时加载 */
    fileWatchEnabled = "disabled";

    /** 文件夹监听路径 */
    fileWatchPath = "data/snippets";

    /** 文件夹监听间隔（秒） */
    fileWatchInterval = 5;

    /** 顶栏按钮位置 */
    topBarPosition: "left" | "right" = "right";

    /** “修改 JS 后重新加载界面”通知开关（feedback.ts 按 i18n 键动态读取 *Notice 字段） */
    reloadUIAfterModifyJSNotice = true;


    // ================================ 运行态 ================================
    // 运行期会话状态（菜单/文件监听/编辑对话框等各模块直连读取；插件重载后以内核数据或配置默认值重建）。

    /**
     * 是否需要重新加载界面（JS 修改后提示用户重载的呼吸标志；属菜单 UI 运行态，界面刷新后自然复位）
     */
    isReloadUIRequired = false;


    /**
     * 代码片段列表缓存（以内核 /api/snippet/getSnippet 为权威：菜单打开/保存/删除/排序等场景自拉刷新；
     * 仅作同页会话缓存，插件重载后由下一次自拉重建）
     */
    snippetsList: Snippet[] = [];

    /**
     * 用户会话中切换过的代码片段类型缓存（重载后回退配置默认值 defaultSnippetsType）
     */
    private snippetsTypeCache: SnippetType | undefined;

    /**
     * 当前代码片段类型（用户切换过则用缓存值，否则用配置默认值）
     */
    get snippetsType(): SnippetType {
        const type = this.snippetsTypeCache ?? this.defaultSnippetsType;
        if (type !== "css" && type !== "js") {
            return "css";
        }
        return type;
    }
    set snippetsType(value: SnippetType) { this.snippetsTypeCache = value; }

    /**
     * 控制台输出（log 仅在开启"开发者工具调试输出"配置时打印）
     */
    console = {
        log: (...args: any[]) => {
            if (this.consoleDebug) {
                console.log(...args);
            }
        },
        warn: (...args: any[]) => console.warn(...args),
        error: (...args: any[]) => console.error(...args),
    };


    /**
     * 启用插件
     */
    public async onload() {
        // 初始化代码片段列表 Store（后端为插件实例 snippetsList 缓存：以内核为权威，菜单打开/保存后自拉刷新）
        this.snippetStore = new SnippetStore({
            get: () => this.snippetsList,
            set: (snippetsList) => {
                this.snippetsList = snippetsList;
            },
        }, () => {
            // 列表变更后刷新菜单计数
            this.menuView.setMenuSnippetCount();
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

        // 初始化文件监听服务（直连本实例，配置字段经实例读取）
        this.fileWatchService = new FileWatchService(this);

        // 初始化导入导出服务（直连本实例，列表读写/菜单刷新经服务内转发）
        this.importExportService = new ImportExportService(this);

        // 初始化通知/错误提示服务（直连本实例，配置开关经实例字段读取）
        this.feedbackService = new FeedbackService(this);

        // 初始化事件监听器簿记（监听器登记与元素清理见 src/services/listener-registry.ts）
        this.listenerRegistry = new ListenerRegistry(this);

        // 初始化对话框管理器（代码片段编辑对话框/确认对话框/按元素关闭等；直连本实例）
        this.snippetsDialog = new SnippetsDialog(this);
    }

    /**
     * 思源布局就绪
     */
    public async onLayoutReady() {
        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";

        // 优先初始化插件设置，因为顶栏按钮位置需要根据插件设置来决定
        await this.configService.init();
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

        // 初始化跨窗口同步服务用于跨窗口通信（需要等插件设置加载完成；传输 + 窗口保活收敛于 services/sync.ts）
        this.syncService = new BroadcastService({
            logger: this.console,
            // 业务分发注册表见 SnippetManager.buildSyncHandlers（src/services/snippet-manager.ts）：
            // 各消息键把远程广播映射到同一方法并传 origin 为 "remote"，接收窗口按 snippetId 自拉权威数据
            handlers: this.snippetManager.buildSyncHandlers(),
        });
        await this.syncService.start();

        console.log(this.displayName, "plugin onloaded");
    }

    /**
     * 插件存储数据变更
     * 在思源 v3.8.3 之后同时包含：客户端同步后配置变更、同内核其他前端实例修改配置变更
     */
    public async onDataChanged() {
        // 重新读取配置并热应用（applyConfig 内部按值 diff，无变化不触发 onApply 副作用）
        await this.configService.reloadFromStorage();
    }

    /**
     * 禁用插件
     */
    public onunload() {
        // 关闭跨窗口同步服务（发送下线通知并断开连接）
        this.syncService?.stop();

        // 停止主题模式监听
        this.editorManager?.stopThemeModeWatch();

        // 移除菜单
        this.menuView.close();

        // 停止文件监听
        this.fileWatchService.stop();

        console.log(this.displayName, "plugin unloaded");
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

        console.log(this.displayName, "plugin uninstalled");
    }

    /**
     * 打开插件设置窗口（装配与交互见 src/ui/setting-dialog.ts SettingDialog）
     * 方法名固定为 openSetting，支持通过菜单按钮打开、被思源调用打开
     */
    public openSetting() {
        this.settingDialog.open();
    }


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
     * 发送重新加载界面请求
     */
    postReloadUI() {
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
    getCustomKeymapByCommand(command: string): string {
        return window.siyuan.config.keymap.plugin?.[PLUGIN_NAME]?.[command]?.custom || "";
    }

    // 全局键盘按下/移除事件监听与开合判断（globalKeyDownHandler/destroyGlobalKeyDownHandler/isDialogAndMenuOpen）
    // 见 src/ui/menu.ts SnippetsMenu


    // ================================ 事件监听管理 ================================

    /**
     * 添加事件监听器（统一簿记见 src/services/listener-registry.ts）
     * @param element 元素
     * @param event 事件
     * @param fn 回调函数
     * @param options 监听器选项
     */
    addListener(element: HTMLElement, event: string, fn: (event?: Event) => void, options?: AddEventListenerOptions) {
        this.listenerRegistry.add(element, event, fn, options);
    }

    /**
     * 移除事件监听器（统一簿记见 src/services/listener-registry.ts）
     * @param element 元素
     * @param event 事件
     * @param fn 回调函数
     * @param options 监听器选项
     */
    removeListener(element: HTMLElement, event?: string, fn?: (event?: Event) => void, options?: AddEventListenerOptions) {
        this.listenerRegistry.remove(element, event, fn, options);
    }
}
