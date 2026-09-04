// services/sync.ts BroadcastService 单测
// 覆盖：start 建连与窗口标识、broadcast 信封附加、本窗口消息忽略、按 type 查表分发、
//       未注册 type 告警、非法载荷告警、连接未就绪不发送、stop 禁重连、onclose 自动重连。
// 浏览器环境（window/WebSocket）以桩替代；模块本身无 siyuan 运行时依赖。
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BROADCAST_CHANNEL_NAME, BroadcastService} from "./sync";
import type {BroadcastHandlers, BroadcastLogger} from "./sync";
import type {SnippetTogglePayload} from "./sync";

/**
 * 最小 WebSocket 桩：登记实例、可控触发 open/message/close 事件
 */
class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    static instances: FakeWebSocket[] = [];

    static reset(): void {
        FakeWebSocket.instances = [];
    }

    url: string;
    readyState = FakeWebSocket.CONNECTING;
    sent: string[] = [];
    onopen: ((event?: unknown) => void) | null = null;
    onmessage: ((event?: {data: string}) => void) | null = null;
    onerror: ((event?: unknown) => void) | null = null;
    onclose: ((event?: {code: number; reason: string}) => void) | null = null;

    constructor(url: string) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.({code: 1000, reason: ""});
    }

    /** 测试辅助：模拟连接建立 */
    open(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.({});
    }

    /** 测试辅助：模拟收到服务端消息 */
    receive(data: string): void {
        this.onmessage?.({data});
    }
}

describe("BroadcastService", () => {
    let service: BroadcastService;
    let logger: BroadcastLogger;
    let handlers: Partial<BroadcastHandlers>;

    /** 启动服务并等待连接建立（触发 onopen 以 resolve subscribe） */
    const startService = async (): Promise<FakeWebSocket> => {
        const startPromise = service.start();
        const ws = FakeWebSocket.instances[0];
        expect(ws).toBeDefined();
        ws.open();
        await startPromise;
        return ws;
    };

    beforeEach(() => {
        FakeWebSocket.reset();
        logger = {log: vi.fn(), warn: vi.fn(), error: vi.fn()};
        handlers = {
            snippet_toggle: vi.fn(),
            snippets_sort: vi.fn(),
        };
        service = new BroadcastService({logger, handlers});
        vi.stubGlobal("window", {
            // 固定窗口 id，使 windowId 可预期：BROADCAST_CHANNEL_NAME + "-" + NewNodeID()
            Lute: {NewNodeID: vi.fn(() => "test-node-id")},
            location: {protocol: "http:", host: "localhost:6806"},
            // 委托全局定时器，便于 vi.useFakeTimers 接管重连调度
            setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
            clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
        });
        vi.stubGlobal("WebSocket", FakeWebSocket);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("start 建立连接并生成唯一窗口标识", async () => {
        await startService();
        const ws = FakeWebSocket.instances[0];
        expect(ws.url).toBe("ws://localhost:6806/ws/broadcast?channel=" + BROADCAST_CHANNEL_NAME);
        // 完成初始化日志（windowId 为两参数形式）
        expect(logger.log).toHaveBeenCalledWith(
            "Broadcast Channel has been initialized, Window ID:",
            BROADCAST_CHANNEL_NAME + "-test-node-id"
        );
    });

    it("https 协议下使用 wss 连接", async () => {
        vi.stubGlobal("window", {
            Lute: {NewNodeID: vi.fn(() => "test-node-id")},
            location: {protocol: "https:", host: "example.com"},
            setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
            clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
        });
        const startPromise = service.start();
        FakeWebSocket.instances[0].open();
        await startPromise;
        expect(FakeWebSocket.instances[0].url).toBe("wss://example.com/ws/broadcast?channel=" + BROADCAST_CHANNEL_NAME);
    });

    it("broadcast 自动附加 windowId 信封并经 WebSocket 发送", async () => {
        const ws = await startService();
        service.broadcast({type: "snippets_sort"});
        expect(ws.sent).toHaveLength(1);
        const sent = JSON.parse(ws.sent[0]);
        expect(sent).toEqual({type: "snippets_sort", windowId: BROADCAST_CHANNEL_NAME + "-test-node-id"});
    });

    it("broadcast 携带类型化载荷时一并序列化", async () => {
        const ws = await startService();
        const payload: SnippetTogglePayload = {snippetId: "20250101000000-a", enabled: true};
        service.broadcast({type: "snippet_toggle", ...payload});
        const sent = JSON.parse(ws.sent[0]);
        expect(sent).toMatchObject({type: "snippet_toggle", ...payload, windowId: expect.any(String)});
    });

    it("忽略来自本窗口的消息，不分发到 handler", async () => {
        const ws = await startService();
        ws.receive(JSON.stringify({
            type: "snippet_toggle",
            snippetId: "20250101000000-a",
            enabled: true,
            windowId: BROADCAST_CHANNEL_NAME + "-test-node-id",
        }));
        expect(handlers.snippet_toggle).not.toHaveBeenCalled();
    });

    it("来自其他窗口的消息按 type 分发到对应 handler", async () => {
        const ws = await startService();
        ws.receive(JSON.stringify({
            type: "snippet_toggle",
            snippetId: "20250101000000-a",
            enabled: false,
            windowId: "other-window-id",
        }));
        expect(handlers.snippet_toggle).toHaveBeenCalledTimes(1);
        expect(handlers.snippet_toggle).toHaveBeenCalledWith({
            type: "snippet_toggle",
            snippetId: "20250101000000-a",
            enabled: false,
            windowId: "other-window-id",
        });
        // 无关 handler 不被调用
        expect(handlers.snippets_sort).not.toHaveBeenCalled();
    });

    it("snippets_import 无载荷消息分发到对应 handler", async () => {
        handlers.snippets_import = vi.fn();
        const ws = await startService();
        ws.receive(JSON.stringify({type: "snippets_import", windowId: "other-window-id"}));
        expect(handlers.snippets_import).toHaveBeenCalledTimes(1);
        expect(handlers.snippets_import).toHaveBeenCalledWith({type: "snippets_import", windowId: "other-window-id"});
    });

    it("未注册 handler 的消息类型记录告警", async () => {
        const ws = await startService();
        ws.receive(JSON.stringify({type: "snippet_element_remove", snippetId: "x", snippetType: "css", windowId: "other"}));
        expect(logger.warn).toHaveBeenCalledWith(
            "No handler registered for broadcast message type:",
            "snippet_element_remove"
        );
    });

    it("非法 JSON 载荷记录错误且不影响后续消息", async () => {
        const ws = await startService();
        ws.receive("{not-json");
        expect(logger.error).toHaveBeenCalledWith("Failed to parse broadcast message:", expect.anything());
    });

    it("连接未就绪时 broadcast 不发送并记录错误", async () => {
        // start 后不触发 onopen（连接仍为 CONNECTING）
        const startPromise = service.start();
        const ws = FakeWebSocket.instances[0];
        service.broadcast({type: "snippets_sort"});
        expect(ws.sent).toHaveLength(0);
        expect(logger.error).toHaveBeenCalledWith("WebSocket connection is not ready, cannot send message");
        // 清理挂起的 subscribe Promise
        ws.open();
        await startPromise;
    });

    it("stop 后断开连接且不再安排重连", async () => {
        const ws = await startService();
        const closeSpy = vi.spyOn(ws, "close");
        vi.useFakeTimers();
        service.stop();
        expect(closeSpy).toHaveBeenCalledTimes(1);
        // stop 后触发 onclose（模拟延迟关闭事件）也不应重连
        ws.onclose?.({code: 1006, reason: "abnormal"});
        await vi.advanceTimersByTimeAsync(3000);
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(logger.log).not.toHaveBeenCalledWith(expect.stringContaining("Attempting to reconnect"));
    });

    it("连接关闭后自动重连（按固定间隔）", async () => {
        const ws = await startService();
        vi.useFakeTimers();
        ws.onclose?.({code: 1006, reason: "abnormal"});
        await vi.advanceTimersByTimeAsync(2999);
        expect(FakeWebSocket.instances).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        // 重连调度触发新连接
        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(logger.log).toHaveBeenCalledWith("Attempting to reconnect to broadcast channel...");
        // 新连接建立后 resolve 内部 Promise，避免测试悬挂
        FakeWebSocket.instances[1].open();
    });

    it("连接出错时记录错误", async () => {
        const startPromise = service.start();
        const ws = FakeWebSocket.instances[0];
        ws.onerror?.("boom");
        await expect(startPromise).rejects.toBe("boom");
    });
});
