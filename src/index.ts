import "./index.scss";
import {Snippet, SnippetType} from "./types";
import {SnippetStore} from "./domain/snippet-store";
import {SnippetsConfig} from "./config/config";
import {ConfigService, STORAGE_NAME} from "./config/config-service";
import {settleWriteResponse} from "./utils";
import {BroadcastService} from "./services/sync";
import {FileWatchService} from "./services/file-watch";
import {ImportExportService} from "./services/import-export";
import {FeedbackService} from "./services/feedback";
import {ListenerRegistry} from "./services/listener-registry";
import {SnippetManager} from "./services/snippet-manager";
import {GistTokenService} from "./services/gist-token";
import {WsMainSnippetSync} from "./services/ws-main";
import {SnippetsMenu} from "./ui/menu";

import {
    fetchPost,
    getFrontend,
    Plugin
} from "siyuan";

// CodeMirror 编辑器工厂与生命周期管理见 src/ui/editor-manager.ts，编辑对话框见 src/ui/snippets-dialog.ts
import {EditorManager} from "./ui/editor-manager";
import {SettingDialog} from "./ui/setting-dialog";
import {SnippetsDialog} from "./ui/snippets-dialog";

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
     * 插件配置对象（字段默认值见 src/config/config.ts SnippetsConfig；
     * 装配/持久化/热应用经 ConfigService，UI 模块统一经本字段类型化读取）
     */
    config!: SnippetsConfig;

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
     * onload 中创建并启动（plugin.json disabledInPublish 为 true，发布会话不加载本插件，普通会话恒可用）；
     * 业务消息按 type 查表分发到 handlers 注册表。
     */
    syncService: BroadcastService | null = null;

    /**
     * GitHub Token 加密存储服务（实现见 src/services/gist-token.ts；
     * Token 密文独立落盘，绝不进入 plugin-config.json）
     */
    gistTokenService!: GistTokenService;

    /**
     * ws-main 消息同步服务（监听思源内核 setSnippet 广播刷新列表与已打开菜单，
     * 实现见 src/services/ws-main.ts；start 于布局无关装配段调用）
     */
    wsMainSync!: WsMainSnippetSync;

    // ================================ 运行态 ================================
    // 运行期会话状态（供菜单/文件监听/编辑对话框等各模块读取；插件重载后以内核数据或配置默认值重建）。
    // 插件配置字段已收敛到 config 对象（src/config/config.ts），不再挂在插件根上。

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
        const type = this.snippetsTypeCache ?? this.config.defaultSnippetsType;
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
            if (this.config.consoleDebug) {
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
        // 初始化配置对象（字段默认值见 config.ts，装配/持久化经 ConfigService）
        this.config = new SnippetsConfig();

        // 初始化代码片段列表 Store（后端为插件实例 snippetsList 缓存：以内核为权威，菜单打开/保存后自拉刷新；
        // 变更后统一经 Store 刷新菜单计数）
        this.snippetStore = new SnippetStore(this);

        // 初始化代码片段管理器（运行态延迟到调用时读取）
        this.snippetManager = new SnippetManager(this);

        // 初始化顶栏菜单管理器（运行态延迟到调用时读取）
        this.menuView = new SnippetsMenu(this);

        // 初始化编辑器对话框生命周期管理器（editorIndentUnit 等调用时读取）
        this.editorManager = new EditorManager(this);

        // 初始化配置服务（配置读写经本模块自持存储键名与插件生命周期数据方法）
        this.configService = new ConfigService(this);

        // 初始化设置对话框管理器
        this.settingDialog = new SettingDialog(this);

        // 初始化文件监听服务（配置字段经插件实例读取）
        this.fileWatchService = new FileWatchService(this);

        // 初始化导入导出服务（列表读写/菜单刷新经服务内转发）
        this.importExportService = new ImportExportService(this);

        // 初始化 GitHub Token 加密存储服务（Token 独立密文落盘，见 src/services/gist-token.ts）
        this.gistTokenService = new GistTokenService(this);

        // 初始化通知/错误提示服务（配置开关经实例字段读取）
        this.feedbackService = new FeedbackService(this);

        // 初始化事件监听器簿记（监听器登记与元素清理见 src/services/listener-registry.ts）
        this.listenerRegistry = new ListenerRegistry(this);

        // 初始化对话框管理器（代码片段编辑对话框/确认对话框/按元素关闭等）
        this.snippetsDialog = new SnippetsDialog(this);

        // 初始化 ws-main 消息同步服务（运行态经插件实例引用，start 见下方布局无关装配段）
        this.wsMainSync = new WsMainSnippetSync(this);

        // ================================ 布局无关装配 ================================
        // 以下初始化只依赖内核 HTTP / window.siyuan.config / window.Lute / document.body 静态骨架，
        // 不依赖布局就绪后的 DOM（顶栏 #barPlugins 等）；思源保证 onload 先于 onLayoutReady 完成，
        // 因此前移到 onload，让配置与跨窗口服务尽早可用。

        // 是否为移动端（getFrontend 只读 UA 与静态骨架，官方样例即在 onload 调用）
        this.isMobile = ["mobile", "browser-mobile"].includes(getFrontend());

        // 顶栏按钮图标（iconJcsm symbol 注册见 SnippetsMenu.initIcons，src/ui/menu.ts；
        // addIcons 仅向 body 注入隐藏 svg defs，须先于 initTopBar 调用）
        this.menuView.initIcons();

        // 注册快捷键（都默认置空；addCommand 只写 window.siyuan.config.keymap，无布局依赖）
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

        // 初始化插件设置（loadData 走内核 HTTP，不依赖布局 DOM；顶栏按钮位置等运行期再读取配置）
        await this.configService.init();
        // 插件设置加载之后启动文件监听
        if (this.config.fileWatchEnabled && this.config.fileWatchEnabled !== "disabled") {
            this.fileWatchService.start();
        }

        // 初始化跨窗口同步服务用于跨窗口通信（传输 + 窗口保活收敛于 services/sync.ts）
        this.syncService = new BroadcastService({
            logger: this.console,
            // 业务分发注册表见 SnippetManager.buildSyncHandlers（src/services/snippet-manager.ts）：
            // 各消息键把远程广播映射到同一方法并传 origin 为 "remote"，接收窗口按 snippetId 自拉权威数据
            handlers: this.snippetManager.buildSyncHandlers(),
        });
        await this.syncService.start();

        // 监听内核 ws-main setSnippet 广播（数据同步/他窗口或思源原生修改片段后刷新插件列表与菜单，
        // 实现见 src/services/ws-main.ts）
        this.wsMainSync.start();

        // 预热 GitHub Token 到会话缓存（磁盘无密文时静默；密文损坏时提示重配，见 gist-token.ts）
        void this.gistTokenService.loadToken();

        console.log(this.displayName, "plugin onloaded");
    }

    /**
     * 思源布局就绪
     */
    public async onLayoutReady() {
        // 初始化顶栏按钮（addTopBar 依赖布局就绪后的顶栏 DOM #barPlugins，须在 onLayoutReady 中调用；
        // 按钮位置取自已加载完成的插件设置）
        void this.menuView.initTopBar();
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
     * 运行时 DOM/资源清理统一收敛于此：对话框、编辑器注入样式、监听器、菜单、文件监听等
     * 均属插件自理范围（宿主只清理其登记过的顶栏按钮/停靠栏等），禁用与卸载路径都必须覆盖。
     */
    public onunload() {
        // 关闭跨窗口同步服务（发送下线通知并断开连接）
        this.syncService?.stop();

        // 停止监听内核 ws-main 消息（防止插件实例重载后旧监听器残留）
        this.wsMainSync?.stop();

        // 关闭全部插件模态对话框（含 CodeMirror 编辑器销毁、对话框监听器移除；
        // 实现见 SnippetsDialog.closeAllDialogs，静默关闭不弹确认）
        this.snippetsDialog.closeAllDialogs();

        // 移除 CodeMirror 编辑器样式（编辑对话框运行中向 document.head 注入的 .cm-content 样式，
        // 实现见 EditorManager.cleanupEditorStyles）
        this.editorManager.cleanupEditorStyles();

        // 停止主题模式监听（对话框已关闭，observer 若仍在则兜底断开）
        this.editorManager.stopThemeModeWatch();

        // 移除菜单
        this.menuView.close();

        // 停止文件监听
        this.fileWatchService.stop();

        // 移除所有登记的监听器（兜底：含 document 级全局键盘等宿主流元素上的监听器，
        // 实现见 listener-registry.ts ListenerRegistry.destroy）
        this.listenerRegistry.destroy();

        // 清空 GitHub Token 会话缓存（只清内存，不删除磁盘密文，下次加载自动恢复）
        this.gistTokenService.clear();

        console.log(this.displayName, "plugin unloaded");
    }

    /**
     * 卸载插件
     * 思源卸载流程先执行 onunload 再执行本方法，因此这里只保留卸载专属逻辑：删除配置文件。
     */
    public async uninstall() {
        // 移除配置文件：removeData 在只读模式/插件已销毁等场景会 reject，归一为 { code: 非 0 } 后统一判定
        const removeResponse = await settleWriteResponse(this.removeData(STORAGE_NAME));
        if (removeResponse.code !== 0) {
            // 写入失败
            this.showErrorMessage(this.i18n.removeConfigFailed + " [" + removeResponse.code + ": " + removeResponse.msg + "]", 20000, "error");
            return;
        }

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
        fetchPost("/api/ui/reloadUI", (response: { status: number }) => {
            if (response.status !== 200) {
                this.showErrorMessage(this.i18n.reloadUIFailed);
            }
        });
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
