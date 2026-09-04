// ui/setting-dialog.ts SettingDialog 单测
// 覆盖：open 的设置项装配（row/column 方向、actionElement/createActionElement 插入、data-key 标记）、
//       鼠标路径点击（confirm→saveFromDialog、cancel/scrim/close→closeByElement）、
//       settingsSnippets 跳转（原生设置对话框打开 + #codeSnippet 点击 + 样式清理）、
//       键盘路径（对话框级 key handler 登记：Esc 关闭、Enter 保存）。
// Dialog/openSetting 经 mock；rAF 以同步 stub 替代。
// @vitest-environment jsdom
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {openSetting} from "siyuan";
import type PluginSnippets from "../index";
import {SettingDialog} from "./setting-dialog";
import type {SettingItem} from "../types";

/** 构造 SettingDialog 替身插件 */
const createPlugin = (overrides: Partial<Record<string, unknown>> = {}) => {
    const plugin = {
        displayName: "Snippets",
        isMobile: false,
        i18n: {cancel: "取消", save: "保存", reloadUI: "重新加载界面"},
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
        configService: {setting: undefined, saveFromDialog: vi.fn()},
        snippetsDialog: {closeByElement: vi.fn()},
        menuView: {close: vi.fn()},
        importExportService: {
            exportSnippetsToFile: vi.fn(async () => {}),
            importSnippets: vi.fn(async () => {}),
        },
        app: {},
        addListener: (element: HTMLElement, event: string, fn: (e: Event) => void, options?: AddEventListenerOptions) => {
            element.addEventListener(event, fn as EventListener, options);
        },
        ...overrides,
    } as unknown as PluginSnippets;
    return plugin;
};

/** 构造一个可用的设置项列表 */
const makeItems = (): SettingItem[] => [
    {title: "开关项", direction: "row", actionElement: document.createElement("input") as unknown as HTMLElement},
    {
        title: "按钮项",
        direction: "column",
        createActionElement: () => {
            const span = document.createElement("span");
            span.dataset.action = "settingsSnippets";
            return span;
        },
    },
    {title: "文本项", description: "说明", createActionElement: () => document.createElement("input")},
];

describe("SettingDialog", () => {
    let plugin: PluginSnippets;

    beforeAll(() => {
        // jsdom 无 rAF；同步 stub 以便点击回调立即执行
        vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
            cb();
            return 1;
        });
    });

    afterEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
        vi.mocked(openSetting).mockReset();
        vi.mocked(openSetting).mockReturnValue(undefined);
    });

    const open = () => {
        const dialog = new SettingDialog(plugin);
        dialog.open();
        return dialog;
    };

    describe("open 装配", () => {
        it("按设置项渲染标题并插入控件元素", () => {
            plugin = createPlugin();
            (plugin.configService as unknown as {setting: unknown}).setting = {items: makeItems()};
            open();

            const dialogElement = document.body.querySelector(".b3-dialog") as HTMLElement;
            expect(dialogElement).not.toBeNull();
            expect(dialogElement.dataset.key).toBe("jcsm-setting-dialog");
            expect(dialogElement.dataset.modal).toBe("true");
            const content = dialogElement.querySelector(".b3-dialog__content")!;
            expect(content.innerHTML).toContain("开关项");
            expect(content.innerHTML).toContain("按钮项");
            // actionElement（data-action=settingsSnippets）已插入
            expect(content.querySelector('[data-action="settingsSnippets"]')).not.toBeNull();
            // Dialog 实例已挂到元素上
            expect((dialogElement as unknown as {dialogObject?: unknown}).dialogObject).toBeDefined();
        });
    });

    describe("鼠标点击路径", () => {
        beforeEach(() => {
            plugin = createPlugin();
            (plugin.configService as unknown as {setting: unknown}).setting = {items: makeItems()};
        });

        const dialogElement = () => document.body.querySelector(".b3-dialog") as HTMLElement;

        it("点击确认按钮保存并关闭由 saveFromDialog 负责", () => {
            open();
            const confirm = dialogElement().querySelector('button[data-type="confirm"]') as HTMLButtonElement;
            confirm.dispatchEvent(new MouseEvent("click", {bubbles: true}));
            expect(plugin.configService.saveFromDialog).toHaveBeenCalledWith(dialogElement());
        });

        it("点击取消按钮关闭对话框", () => {
            open();
            const cancel = dialogElement().querySelector('button[data-type="cancel"]') as HTMLButtonElement;
            cancel.dispatchEvent(new MouseEvent("click", {bubbles: true}));
            expect(plugin.snippetsDialog.closeByElement).toHaveBeenCalledWith(dialogElement());
        });

        it("点击遮罩（scrim）关闭对话框", () => {
            open();
            const scrim = document.createElement("div");
            scrim.className = "b3-dialog__scrim";
            dialogElement().appendChild(scrim);
            scrim.dispatchEvent(new MouseEvent("click", {bubbles: true}));
            expect(plugin.snippetsDialog.closeByElement).toHaveBeenCalled();
        });

        it("点击 settingsSnippets 动作跳转原生代码片段设置", () => {
            vi.useRealTimers();
            const nativeElement = document.createElement("div");
            const codeSnippetButton = document.createElement("button");
            codeSnippetButton.id = "codeSnippet";
            nativeElement.appendChild(codeSnippetButton);
            const nativeDialog = {element: nativeElement, destroy: vi.fn()};
            vi.mocked(openSetting).mockReturnValue(nativeDialog as never);

            plugin = createPlugin();
            (plugin.configService as unknown as {setting: unknown}).setting = {items: makeItems()};
            open();

            const action = document.querySelector('[data-action="settingsSnippets"]') as HTMLElement;
            action.dispatchEvent(new MouseEvent("click", {bubbles: true}));

            expect(plugin.menuView.close).toHaveBeenCalled();
            expect(openSetting).toHaveBeenCalledWith(plugin.app, "appearance");
            expect(nativeDialog.destroy).toHaveBeenCalled();

            // 跳转期间注入隐藏样式，动画结束后（Constants.TIMEOUT_DBLCLICK=200ms）移除
            return new Promise<void>(resolve => setTimeout(() => {
                expect(document.head.innerHTML).not.toContain("dialog-setting");
                resolve();
            }, 250));
        });
    });

    describe("键盘路径", () => {
        it("登记对话框级键盘动作：Esc 关闭、Enter 无焦点按钮时保存", async () => {
            plugin = createPlugin();
            (plugin.configService as unknown as {setting: unknown}).setting = {items: makeItems()};
            const {getDialogKeyHandler} = await import("../utils");
            open();

            const dialogElement = document.body.querySelector(".b3-dialog") as HTMLElement;
            const handler = getDialogKeyHandler(dialogElement);
            expect(handler).toBeDefined();
            handler?.("Escape");
            expect(plugin.snippetsDialog.closeByElement).toHaveBeenCalled();
            handler?.("Enter");
            expect(plugin.configService.saveFromDialog).toHaveBeenCalled();
        });
    });
});
