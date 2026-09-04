import type {Snippet, SnippetType} from "../types";

/**
 * 跨窗口广播协议与传输服务（services 层，阶段 3）
 * 广播信封统一为 { type, windowId, timestamp, ...payload }，由 BroadcastService.broadcast 自动附加。
 * 硬性约束：payload 不得携带代码片段 content 原文（可能含敏感信息）；唯一豁免为 CSS 编辑中实时预览
 * （snippet_element_update 且 previewState: true，内容未保存、接收窗口无法自拉）。
 */

/**
 * 广播通道名称
 */
export const BROADCAST_CHANNEL_NAME = "snippets-plugin-sync";

/**
 * 广播消息信封：所有消息共有的发送窗口标识与时间戳
 * 由 BroadcastService.broadcast 自动附加并保证覆盖，上层读取时用于识别消息来源。
 */
export interface BroadcastEnvelope {
    /** 发送窗口的唯一标识 */
    windowId: string;
    /** 发送时间戳 */
    timestamp: number;
}

/** 切换代码片段开关状态载荷 */
export interface SnippetTogglePayload {
    snippetId: string;
    enabled: boolean;
}

/** 切换代码片段发布服务开关状态载荷（enabled 即 disabledInPublish，与现有代码语义保持一致） */
export interface SnippetTogglePublishPayload {
    snippetId: string;
    enabled: boolean;
}

/** 切换全局开关状态载荷 */
export interface SnippetToggleGlobalPayload {
    snippetType: SnippetType;
    enabled: boolean;
    previewingSnippetIds: string[];
}

/** 保存代码片段载荷（已去原文化，不含 content，接收方按 snippetId 自拉权威数据） */
export interface SnippetSavePayload {
    snippetId: string;
    isCopy: boolean;
    copySnippetId?: string;
}

/** 删除代码片段载荷 */
export interface SnippetDeletePayload {
    snippetId: string;
    snippetType: SnippetType;
    previewState: boolean;
}

/**
 * 更新注入元素载荷
 * previewState 为 true（CSS 编辑中预览）：携带 snippet 原文（豁免禁原文，内容未保存无法自拉）；
 * previewState 为 false（退出预览）：只携带 snippetId，接收方自拉已保存片段恢复。
 */
export interface SnippetElementUpdatePayload {
    snippet?: Snippet;
    snippetId?: string;
    previewState?: boolean;
}

/** 移除注入元素载荷 */
export interface SnippetElementRemovePayload {
    snippetId: string;
    snippetType: SnippetType;
}

/** 应用插件配置载荷（跨窗口同步插件配置用） */
export interface SettingApplyPayload {
    config: Record<string, unknown>;
}

/**
 * 消息体（不含信封字段）
 * 发送侧（BroadcastService.broadcast）传入该类型：type 为协议字面量，payload 随 type 自动获得类型校验；
 * 因消息体成员均无信封字段，fresh 字面量无法携带 windowId / timestamp，信封只能由服务附加。
 */
export type SnippetBroadcastBody =
    | {type: "window_online"}
    | {type: "window_online_feedback"}
    | {type: "window_offline"}
    | ({type: "snippet_toggle"} & SnippetTogglePayload)
    | ({type: "snippet_toggle_publish"} & SnippetTogglePublishPayload)
    | ({type: "snippet_toggle_global"} & SnippetToggleGlobalPayload)
    | ({type: "snippet_save"} & SnippetSavePayload)
    | ({type: "snippet_delete"} & SnippetDeletePayload)
    | ({type: "snippet_element_update"} & SnippetElementUpdatePayload)
    | ({type: "snippet_element_remove"} & SnippetElementRemovePayload)
    | {type: "snippets_sort"} // 排序消息无载荷，接收方全量重拉列表
    | ({type: "setting_apply"} & SettingApplyPayload);

/**
 * 给联合类型每个成员附加信封字段（分布式条件类型，按成员逐一展开）
 */
type WithEnvelope<T> = T extends unknown ? T & BroadcastEnvelope : never;

/**
 * 全部广播消息（信封 + 消息体）联合类型
 * 接收侧按此类型解析：type 收窄后可直接读取对应载荷与信封来源；业务分发按 type 分发到对应 handler。
 */
export type SnippetBroadcastMessage = WithEnvelope<SnippetBroadcastBody>;

/** 窗口保活消息（由 BroadcastService 内部处理，上层无需感知）：载荷即信封，用于标识发送窗口自身 */
export type WindowKeepaliveMessage = BroadcastEnvelope & (
    | {type: "window_online"}
    | {type: "window_online_feedback"}
    | {type: "window_offline"}
);

/**
 * 业务消息（去掉窗口保活三类后的协议子集）
 * 上层（插件）的业务分发只处理该子集；保活消息在 BroadcastService 内部消化。
 */
export type SnippetBusinessMessage = Exclude<SnippetBroadcastMessage, WindowKeepaliveMessage>;

/**
 * 广播日志器最小接口
 * 与插件实例的自定义 console（log/warn/error）对齐，避免服务直接依赖插件实例。
 */
export interface BroadcastLogger {
    log(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
}

/**
 * 业务消息处理回调
 * 收到来自其他窗口的业务消息（已过滤自身消息与窗口保活消息）时调用。
 */
export type BroadcastMessageHandler = (message: SnippetBusinessMessage) => void | Promise<void>;

/**
 * BroadcastService 构造参数
 */
export interface BroadcastServiceOptions {
    logger: BroadcastLogger;
    onBusinessMessage: BroadcastMessageHandler;
}

/**
 * 基于思源内核 broadcast API 的跨窗口广播服务（阶段 3：传输 + 窗口保活 + 类型化广播收敛于此）
 * - 统一维护当前窗口唯一标识、其他窗口在线集合与 WebSocket 连接（含自动重连与页面卸载通知）；
 * - 内部消化窗口保活（window_online / window_online_feedback / window_offline），上层无需感知；
 * - 业务消息统一经 onBusinessMessage 回调交给上层分发；
 * - 发送侧受 SnippetBroadcastBody 协议约束：调用方传字面量 type 即自动获得对应 payload 的类型校验，
 *   信封字段（windowId / timestamp）由本服务自动附加。
 */
export class BroadcastService {
    private readonly logger: BroadcastLogger;
    private readonly onBusinessMessage: BroadcastMessageHandler;

    /** 当前窗口的唯一标识 */
    private windowId = "";

    /** WebSocket 连接，用于接收广播消息 */
    private websocket: WebSocket | null = null;

    /** 重连间隔（毫秒） */
    private readonly reconnectInterval = 3000;

    /** 重连定时器 */
    private reconnectTimer: number | null = null;

    /** 其他窗口 ID 集合，用于跟踪其他窗口的在线状态 */
    private readonly otherWindowIds: Set<string> = new Set();

    /** 页面卸载监听：窗口关闭前发送下线通知 */
    private readonly beforeunloadHandler: () => void;

    constructor(options: BroadcastServiceOptions) {
        this.logger = options.logger;
        this.onBusinessMessage = options.onBusinessMessage;
        this.beforeunloadHandler = () => {
            this.sendOfflineNotification();
        };
    }

    /**
     * 启动广播服务：订阅广播通道、宣告本窗口上线、注册页面卸载监听
     * 应在插件配置加载完成后调用，与插件 onLayoutReady 对齐。
     */
    async start(): Promise<void> {
        // 生成当前窗口的唯一标识
        this.windowId = BROADCAST_CHANNEL_NAME + "-" + window.Lute.NewNodeID();

        await this.subscribe();

        this.logger.log("Broadcast Channel has been initialized, Window ID:", this.windowId);

        // 发送上线通知到其他窗口（用于发现其他窗口，强制发送）
        this.broadcast({type: "window_online"}, true);

        // 监听页面卸载事件，确保窗口关闭时发送下线通知
        window.addEventListener("beforeunload", this.beforeunloadHandler);
    }

    /**
     * 停止广播服务：发送下线通知、断开连接并清理页面卸载监听
     */
    stop(): void {
        this.sendOfflineNotification();

        this.clearReconnectTimer();

        // 清理窗口跟踪数据
        this.otherWindowIds.clear();

        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }

        window.removeEventListener("beforeunload", this.beforeunloadHandler);
    }

    /**
     * 发送广播消息到其他窗口
     * 信封字段（windowId / timestamp）由本服务自动附加并保证覆盖，调用方无需传入；
     * 消息体受 SnippetBroadcastBody 协议约束：传 type 字面量与不匹配的载荷会直接编译报错。
     * @param message 消息体：type 为协议字面量，payload 随 type 自动获得类型校验
     * @param force 是否强制发送（忽略其他窗口在线检查；窗口保活消息必须强制发送）
     */
    broadcast<T extends SnippetBroadcastBody>(message: T, force = false): void {
        // TODO功能: 试试能不能支持发布服务，实时应用变更到发布服务窗口 https://github.com/TCOTC/snippets/issues/33
        // 需要注意 disabledInPublish 的代码片段不能被广播到发布服务窗口。看看哪些消息需要禁止发送

        // 如果不是强制发送且不存在其他窗口，则跳过广播
        if (!force && this.otherWindowIds.size === 0) return;

        // 组装信封：windowId/timestamp 由本服务保证覆盖（消息体类型上已无这两个字段）
        const envelope = {
            ...message,
            windowId: this.windowId,
            timestamp: Date.now(),
        } as SnippetBroadcastMessage;

        this.postMessage(JSON.stringify(envelope));
        this.logger.log("Send cross-window message:", envelope);
    }

    /**
     * 订阅广播通道
     */
    private subscribe(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // 构建 WebSocket URL
                const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
                const wsUrl = `${protocol}//${window.location.host}/ws/broadcast?channel=${encodeURIComponent(BROADCAST_CHANNEL_NAME)}`;

                // 创建 WebSocket 连接
                this.websocket = new WebSocket(wsUrl);

                // 监听连接打开
                this.websocket.onopen = () => {
                    this.logger.log("Broadcast channel connected");
                    this.clearReconnectTimer();
                    resolve(); // 连接建立后 resolve Promise
                };

                // 监听消息
                this.websocket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data) as SnippetBroadcastMessage;
                        this.handleIncomingMessage(message);
                    } catch (error) {
                        this.logger.error("Failed to parse broadcast message:", error);
                    }
                };

                // 监听连接错误
                this.websocket.onerror = (error) => {
                    this.logger.error("Broadcast channel connection error:", error);
                    this.scheduleReconnect();
                    reject(error); // 连接错误时 reject Promise
                };

                // 监听连接关闭
                this.websocket.onclose = (event) => {
                    this.logger.log("Broadcast channel connection closed:", event.code, event.reason);
                    this.scheduleReconnect();
                };
            } catch (error) {
                this.logger.error("Failed to subscribe to broadcast channel:", error);
                this.scheduleReconnect();
                reject(error);
            }
        });
    }

    /**
     * 处理收到的广播消息：忽略自身消息、维护其他窗口在线集合；
     * 窗口保活消息在此消化，业务消息转交上层回调
     * @param message 消息数据
     */
    private handleIncomingMessage(message: SnippetBroadcastMessage) {
        this.logger.log("Received broadcast message:", message);

        // 忽略来自当前窗口的消息
        if (message.windowId === this.windowId) {
            this.logger.log("Ignoring message from current window:", message.windowId);
            return;
        }

        // 记录其他窗口 ID
        this.otherWindowIds.add(message.windowId);

        switch (message.type) {
            case "window_online":
                // 向新上线的窗口发送反馈，告知自己的存在
                this.logger.log("New window detected:", message.windowId);
                this.broadcast({type: "window_online_feedback"});
                break;
            case "window_online_feedback":
                this.logger.log("Received online feedback from:", message.windowId);
                break;
            case "window_offline":
                this.handleWindowOffline(message.windowId);
                break;
            default:
                // 业务消息：转交上层分发（TS 穷尽后此处即为 SnippetBusinessMessage）
                void this.onBusinessMessage(message);
        }
    }

    /**
     * 处理窗口下线通知
     * @param windowId 下线的窗口 ID
     */
    private handleWindowOffline(windowId: string) {
        // 立即从跟踪列表中移除该窗口
        this.otherWindowIds.delete(windowId);
        this.logger.log("Window offline notification received, removed from tracking:", windowId);
    }

    /**
     * 发送窗口下线通知
     */
    private sendOfflineNotification() {
        // 在页面卸载前发送下线通知
        try {
            this.broadcast({type: "window_offline"}, true);
        } catch (error) {
            // 忽略错误，因为页面即将卸载
            this.logger.error("Failed to send offline notification:", error);
        }
    }

    /**
     * 安排重连
     */
    private scheduleReconnect() {
        this.clearReconnectTimer();
        this.reconnectTimer = window.setTimeout(() => {
            this.logger.log("Attempting to reconnect to broadcast channel...");
            this.subscribe().catch(error => {
                this.logger.error("Failed to reconnect to broadcast channel:", error);
            });
        }, this.reconnectInterval);
    }

    /**
     * 清除重连定时器
     */
    private clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * 通过 WebSocket 连接发送广播消息
     * @param message 消息内容
     */
    private postMessage(message: string) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(message);
        } else {
            this.logger.error("WebSocket connection is not ready, cannot send message");
        }
    }
}
