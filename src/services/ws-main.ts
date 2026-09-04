// ws-main 消息同步
// 职责：监听思源内核 ws-main 通道的 setSnippet 广播，自拉权威片段列表刷新插件缓存与已打开菜单。
// 触发场景：数据同步合并 /snippets/conf.json、他实例或思源"外观 - 代码片段"修改片段/全局开关后，
// 内核经 util.BroadcastByType 推送 setSnippet（kernel/util/websocket.go），思源前端在自身消息分发
// （case "setSnippet" 更新 config + renderSnippet）之前先 emitToPlugins("ws-main", data)
// （app/src/index.ts），插件经 Plugin.eventBus 订阅即可收到。注入元素的增删改由思源自身
// renderSnippet 全量 diff 重渲接管，本服务不触碰注入元素，只同步片段列表与菜单 UI。
// 与 services/sync.ts（插件自有 broadcast 通道）互补：sync.ts 承载插件自身业务消息，
// 本服务消费思源原生 ws-main 消息，覆盖插件未参与的片段变更（数据同步/思源原生修改），
// 避免陈旧 snippetsList 整表覆盖写回时丢失同步进来的片段。
import type {IWebSocketData} from "siyuan";
import type PluginSnippets from "../index";

/**
 * ws-main 消息同步服务
 * 监听思源内核 setSnippet 广播并刷新插件代码片段列表（start/stop 与插件生命周期对齐，
 * 防止插件实例重载后旧监听器残留）。
 */
export class WsMainSnippetSync {
    private readonly plugin: PluginSnippets;

    /** 本窗口自身全局开关操作触发内核广播的抑制截止时间（Date.now() 毫秒，见 suppressOwnBroadcast） */
    private suppressOwnBroadcastUntil = 0;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 开始监听内核 ws-main 消息（仅 setSnippet 命令会触发列表刷新）
     */
    start(): void {
        this.plugin.eventBus.on("ws-main", this.wsMainMessageHandler);
    }

    /**
     * 停止监听（插件禁用/重载/卸载前调用）
     */
    stop(): void {
        this.plugin.eventBus.off("ws-main", this.wsMainMessageHandler);
    }

    /**
     * 抑制本窗口即将触发的内核回环广播
     * 本窗口调用 /api/setting/setSnippet（菜单全局开关）后内核会向包括本窗口在内的所有实例广播
     * setSnippet；本窗口已就地更新 config 镜像与注入元素，收到回环广播时无需再自拉刷新，
     * 在调用该 API 前调用本方法即可跳过随后的回环广播处理。
     * @param timeout 抑制时长（毫秒），默认 2 秒，覆盖 HTTP 响应与广播到达的先后间隔
     */
    suppressOwnBroadcast(timeout = 2000): void {
        this.suppressOwnBroadcastUntil = Date.now() + timeout;
    }

    /**
     * ws-main 事件处理器（start/stop 注册与注销共用同一引用）
     */
    private readonly wsMainMessageHandler = (event: CustomEvent<IWebSocketData>): void => {
        const data = event.detail;
        if (!data || data.cmd !== "setSnippet") {
            return;
        }
        if (Date.now() < this.suppressOwnBroadcastUntil) {
            // 本窗口自身全局开关操作的回环广播，已就地刷新，跳过
            return;
        }
        void this.syncFromKernel();
    };

    /**
     * 自拉内核权威片段列表并刷新已打开菜单
     * 自拉失败时保持现状（getSnippetsList 已弹错误提示）；注入元素由思源 renderSnippet 接管。
     */
    private async syncFromKernel(): Promise<void> {
        this.plugin.console.log("ws-main setSnippet: 刷新代码片段列表");
        if (!(await this.plugin.snippetManager.refreshSnippetsList())) {
            return;
        }
        // 菜单已打开时重渲片段列表、全局开关状态与计数（await 返回后思源已完成 config.snippet 赋值，
        // isSnippetsTypeEnabled 可读到最新全局开关状态）
        if (!this.plugin.menuView.menuItems) {
            return;
        }
        this.plugin.menuView.initSnippetsContainer();
        this.plugin.menuView.setMenuSnippetsType(this.plugin.snippetsType);
        this.plugin.menuView.setMenuSnippetCount();
    }
}
