// services/ws-main.ts WsMainSnippetSync 单测
// 覆盖：start/stop 以同一引用注册与注销 ws-main 监听、非 setSnippet 命令忽略、
//       setSnippet 触发权威列表自拉刷新、菜单已打开时重渲列表项/全局开关/计数、
//       自拉失败保持现状、自身全局开关回环广播抑制（时间窗内跳过、过期后恢复）。
import {afterEach, describe, expect, it, vi} from "vitest";
import type {IWebSocketData} from "siyuan";
import type PluginSnippets from "../index";
import type {SnippetType} from "../types";
import {WsMainSnippetSync} from "./ws-main";

/** 内核 setSnippet 广播消息（data 为全局开关状态 Snpt） */
const setSnippetDetail = (): IWebSocketData =>
    ({cmd: "setSnippet", msg: "", code: 0, data: {enabledCSS: true, enabledJS: true}});

/**
 * 构造服务最小插件替身
 * @returns {service, plugin, eventBus, refreshSnippetsList, menuView}
 */
const setup = () => {
    const eventBus = {on: vi.fn(), off: vi.fn()};
    const refreshSnippetsList = vi.fn(async () => true);
    const menuView = {
        menuItems: null as HTMLElement | null,
        initSnippetsContainer: vi.fn(),
        setMenuSnippetsType: vi.fn(),
        setMenuSnippetCount: vi.fn(),
    };
    const plugin = {
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
        eventBus,
        snippetsType: "css" as SnippetType,
        snippetManager: {refreshSnippetsList},
        menuView,
    } as unknown as PluginSnippets;
    const service = new WsMainSnippetSync(plugin);
    return {service, plugin, eventBus, refreshSnippetsList, menuView};
};

/** 触发已注册的 ws-main 处理器（start 后调用） */
const fireWsMain = (eventBus: {on: ReturnType<typeof vi.fn>}, detail?: IWebSocketData) => {
    const handler = eventBus.on.mock.calls[0][1] as (event: {detail?: IWebSocketData}) => void;
    handler({detail});
};

describe("WsMainSnippetSync", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("start 注册 ws-main 监听，stop 以同一引用注销", () => {
        const {service, eventBus} = setup();
        service.start();
        expect(eventBus.on).toHaveBeenCalledWith("ws-main", expect.any(Function));
        const handler = eventBus.on.mock.calls[0][1];
        service.stop();
        expect(eventBus.off).toHaveBeenCalledWith("ws-main", handler);
    });

    it("非 setSnippet 命令忽略，不触发列表刷新", async () => {
        const {service, eventBus, refreshSnippetsList} = setup();
        service.start();
        fireWsMain(eventBus, {cmd: "setConf", msg: "", code: 0, data: null});
        fireWsMain(eventBus, undefined);
        await Promise.resolve();
        expect(refreshSnippetsList).not.toHaveBeenCalled();
    });

    it("收到 setSnippet 后自拉权威列表刷新缓存", async () => {
        const {service, eventBus, refreshSnippetsList, plugin} = setup();
        service.start();
        fireWsMain(eventBus, setSnippetDetail());
        await vi.waitFor(() => expect(refreshSnippetsList).toHaveBeenCalledTimes(1));
        expect(plugin.snippetManager.refreshSnippetsList).toBe(refreshSnippetsList);
    });

    it("菜单已打开时重渲列表项、全局开关状态与计数", async () => {
        const {service, eventBus, refreshSnippetsList, menuView} = setup();
        // 模拟菜单已打开（menuItems 已挂载）
        menuView.menuItems = {} as HTMLElement;
        service.start();
        fireWsMain(eventBus, setSnippetDetail());
        await vi.waitFor(() => expect(refreshSnippetsList).toHaveBeenCalledTimes(1));
        expect(menuView.initSnippetsContainer).toHaveBeenCalledTimes(1);
        expect(menuView.setMenuSnippetsType).toHaveBeenCalledWith("css");
        expect(menuView.setMenuSnippetCount).toHaveBeenCalledTimes(1);
    });

    it("菜单未打开时只刷新缓存，不触碰菜单 DOM", async () => {
        const {service, eventBus, refreshSnippetsList, menuView} = setup();
        service.start();
        fireWsMain(eventBus, setSnippetDetail());
        await vi.waitFor(() => expect(refreshSnippetsList).toHaveBeenCalledTimes(1));
        expect(menuView.initSnippetsContainer).not.toHaveBeenCalled();
        expect(menuView.setMenuSnippetCount).not.toHaveBeenCalled();
    });

    it("自拉失败时保持现状，不刷新菜单", async () => {
        const {service, eventBus, refreshSnippetsList, menuView} = setup();
        menuView.menuItems = {} as HTMLElement;
        refreshSnippetsList.mockResolvedValueOnce(false);
        service.start();
        fireWsMain(eventBus, setSnippetDetail());
        await vi.waitFor(() => expect(refreshSnippetsList).toHaveBeenCalledTimes(1));
        expect(menuView.initSnippetsContainer).not.toHaveBeenCalled();
    });

    it("suppressOwnBroadcast 时间窗内跳过自身回环广播", async () => {
        const {service, eventBus, refreshSnippetsList} = setup();
        const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
        service.start();
        // 模拟本窗口全局开关即将调 /api/setting/setSnippet：抑制随后回环广播
        service.suppressOwnBroadcast();
        fireWsMain(eventBus, setSnippetDetail());
        await Promise.resolve();
        expect(refreshSnippetsList).not.toHaveBeenCalled();
        // 抑制过期后恢复正常处理
        nowSpy.mockReturnValue(1000 + 2001);
        fireWsMain(eventBus, setSnippetDetail());
        await vi.waitFor(() => expect(refreshSnippetsList).toHaveBeenCalledTimes(1));
    });

    it("suppressOwnBroadcast 支持自定义抑制时长", async () => {
        const {service, eventBus, refreshSnippetsList} = setup();
        const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
        service.start();
        service.suppressOwnBroadcast(500);
        nowSpy.mockReturnValue(1000 + 501);
        fireWsMain(eventBus, setSnippetDetail());
        await vi.waitFor(() => expect(refreshSnippetsList).toHaveBeenCalledTimes(1));
    });
});
