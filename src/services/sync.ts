import type {Snippet, SnippetType} from "../types";

/**
 * 跨窗口广播协议与传输服务
 * 广播信封统一为 { type, windowId, ...payload }（windowId 供接收方识别并忽略自身消息），
 * 由 BroadcastService.broadcast 自动附加；服务不跟踪其他窗口在线状态——广播始终发送，
 * 内核通道无其他接收窗口时自然丢弃，因此无需窗口保活握手协议。
 * 硬性约束：payload 不得携带代码片段 content 原文（可能含敏感信息）；唯一豁免为 CSS 编辑中实时预览
 * （snippet_element_update 且 previewState: true，内容未保存、接收窗口无法自拉）。
 */

/**
 * 广播通道名称
 */
export const BROADCAST_CHANNEL_NAME = "snippets-plugin-sync";

/**
 * 广播消息信封：消息共有的发送窗口标识（接收方据此识别并忽略自身窗口的消息）
 * 由 BroadcastService.broadcast 自动附加并保证覆盖。
 */
export interface BroadcastEnvelope {
    /** 发送窗口的唯一标识 */
    windowId: string;
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

/**
 * 消息体（不含信封字段）
 * 发送侧（BroadcastService.broadcast）传入该类型：type 为协议字面量，payload 随 type 自动获得类型校验；
 * 因消息体成员均无信封字段，fresh 字面量无法携带 windowId / timestamp，信封只能由服务附加。
 */
export type SnippetBroadcastBody =
    | ({type: "snippet_toggle"} & SnippetTogglePayload)
    | ({type: "snippet_toggle_publish"} & SnippetTogglePublishPayload)
    | ({type: "snippet_toggle_global"} & SnippetToggleGlobalPayload)
    | ({type: "snippet_save"} & SnippetSavePayload)
    | ({type: "snippet_delete"} & SnippetDeletePayload)
    | ({type: "snippet_element_update"} & SnippetElementUpdatePayload)
    | ({type: "snippet_element_remove"} & SnippetElementRemovePayload)
    | {type: "snippets_sort"} // 排序消息无载荷，接收方全量重拉列表
    | {type: "snippets_import"}; // 导入消息无载荷，接收方全量重拉列表并对齐注入元素与菜单

/**
 * 给联合类型每个成员附加信封字段（分布式条件类型，按成员逐一展开）
 */
type WithEnvelope<T> = T extends unknown ? T & BroadcastEnvelope : never;

/**
 * 全部广播消息（信封 + 消息体）联合类型
 * 接收侧按此类型解析：type 收窄后可直接读取对应载荷与信封来源；业务分发按 type 分发到对应 handler。
 */
export type SnippetBroadcastMessage = WithEnvelope<SnippetBroadcastBody>;

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
 * 业务消息处理器注册表
 * 键为协议消息 type，值为该消息对应的处理函数（参数为该 type 收窄后的载荷，无需处理信封）；
 * 由 BroadcastService 收到业务消息后查表分发，上层（插件）只负责实现各键的业务映射。
 */
export interface BroadcastHandlers {
    snippet_toggle: (payload: SnippetTogglePayload) => void | Promise<void>;
    snippet_toggle_publish: (payload: SnippetTogglePublishPayload) => void | Promise<void>;
    snippet_toggle_global: (payload: SnippetToggleGlobalPayload) => void | Promise<void>;
    snippet_save: (payload: SnippetSavePayload) => void | Promise<void>;
    snippet_delete: (payload: SnippetDeletePayload) => void | Promise<void>;
    snippet_element_update: (payload: SnippetElementUpdatePayload) => void | Promise<void>;
    snippet_element_remove: (payload: SnippetElementRemovePayload) => void | Promise<void>;
    snippets_sort: () => void | Promise<void>;
    snippets_import: () => void | Promise<void>;
}

/**
 * BroadcastService 构造参数
 */
export interface BroadcastServiceOptions {
    logger: BroadcastLogger;
    /** 业务消息处理器注册表（可缺省部分 type，未注册的 type 仅记录告警） */
    handlers: Partial<BroadcastHandlers>;
}

/**
 * 基于思源内核 broadcast API 的跨窗口广播服务
 * - 维护当前窗口唯一标识与 WebSocket 连接（含自动重连），业务消息按 type 查表分发到 handlers；
 * - 广播始终发送、不跟踪其他窗口（内核通道无接收窗口时自然丢弃），因此无窗口保活握手；
 * - 发送侧受 SnippetBroadcastBody 协议约束：调用方传 type 字面量即获得对应 payload 的类型校验，
 *   信封字段 windowId 由本服务自动附加。
 */
export class BroadcastService {
    private readonly logger: BroadcastLogger;
    private readonly handlers: Partial<BroadcastHandlers>;

    /** 当前窗口的唯一标识 */
    private windowId = "";

    /** WebSocket 连接，用于接收广播消息 */
    private websocket: WebSocket | null = null;

    /** 重连间隔（毫秒） */
    private readonly reconnectInterval = 3000;

    /** 重连定时器 */
    private reconnectTimer: number | null = null;

    /** 是否已停止（stop 后不再重连） */
    private stopped = false;

    constructor(options: BroadcastServiceOptions) {
        this.logger = options.logger;
        this.handlers = options.handlers;
    }

    /**
     * 启动广播服务：订阅广播通道
     * 应在插件配置加载完成后调用，与插件 onLayoutReady 对齐。
     */
    async start(): Promise<void> {
        this.stopped = false;
        // 生成当前窗口的唯一标识
        this.windowId = BROADCAST_CHANNEL_NAME + "-" + window.Lute.NewNodeID();

        await this.subscribe();

        this.logger.log("Broadcast Channel has been initialized, Window ID:", this.windowId);
    }

    /**
     * 停止广播服务：断开连接并禁止后续重连
     */
    stop(): void {
        this.stopped = true;
        this.clearReconnectTimer();

        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
    }

    /**
     * 发送广播消息到其他窗口
     * 信封字段 windowId 由本服务自动附加并保证覆盖；广播始终发送（内核通道无其他接收窗口时自然丢弃），
     * 调用方无需关心其他窗口是否在线。
     * @param message 消息体：type 为协议字面量，payload 随 type 自动获得类型校验
     */
    broadcast<T extends SnippetBroadcastBody>(message: T): void {
        // 已知限制：发布服务会话（window.siyuan.isPublish 为 true，内核按只读角色注入）无法实时接收本广播——
        // 内核 /ws/broadcast 与 /es/broadcast/subscribe 等通道要求管理员角色（CheckAdminRole），发布会话握手即 403，
        // 且内核自身推送同样跳过发布会话。因此编辑端到"已打开发布页"的实时同步不可行：发布页片段由发布渲染
        // 按 DisabledInPublish 过滤后静态注入，刷新页面即取最新内容（发布服务会话支持见
        // https://github.com/TCOTC/snippets/issues/33 ）

        // 组装信封：windowId 由本服务保证覆盖（消息体类型上已无该字段）
        const envelope = {
            ...message,
            windowId: this.windowId,
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

                // 监听连接错误（WS 错误后必然触发 onclose，重连统一由 onclose 调度）
                this.websocket.onerror = (error) => {
                    this.logger.error("Broadcast channel connection error:", error);
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
     * 处理收到的广播消息：忽略自身窗口消息，其余按 type 查表分发到 handlers
     * @param message 消息数据
     */
    private handleIncomingMessage(message: SnippetBroadcastMessage) {
        this.logger.log("Received broadcast message:", message);

        // 忽略来自当前窗口的消息（本窗口的变更已由本地操作路径处理）
        if (message.windowId === this.windowId) {
            this.logger.log("Ignoring message from current window:", message.windowId);
            return;
        }

        const handler = this.handlers[message.type] as ((payload: SnippetBroadcastMessage) => void | Promise<void>) | undefined;
        if (handler) {
            void handler(message);
        } else {
            this.logger.warn("No handler registered for broadcast message type:", message.type);
        }
    }

    /**
     * 安排重连（stop 后不再重连）
     */
    private scheduleReconnect() {
        if (this.stopped) return;
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
