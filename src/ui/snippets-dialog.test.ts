// ui/snippets-dialog.ts SnippetsDialog 核心公开方法单测
// 覆盖：reloadUI（无变更直接重载/有变更弹确认再重载）、openDeleteDialog 确认回调、
//       closeByElement（空参防御/无 dialogObject 防御/编辑对话框清理与延迟兜底销毁）、
//       getAllModalElements/closeAllDialogs。
// 不覆盖 openEditDialog 的 CodeMirror 装配流（依赖编辑器实例化）。
// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type PluginSnippets from "../index";
import {SnippetsConfig} from "../config/config";
import type {Snippet, SnippetType} from "../types";
import {SnippetsDialog} from "./snippets-dialog";
import {attachDialogObject} from "../utils";

/** 构造 SnippetsDialog 替身插件 */
const createPlugin = () => {
    const plugin = {
        isMobile: false,
        snippetsList: [] as Snippet[],
        snippetsType: "css" as SnippetType,
        config: new SnippetsConfig(),
        i18n: {
            confirm: "确定",
            cancel: "取消",
            deleteConfirm: "确认删除",
            deleteConfirmDescription: "将删除片段 ${x}",
            delete: "删除",
            reloadUIConfirm: "重载",
            reloadUIConfirmDescription: "存在未保存变更",
        },
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
        postReloadUI: vi.fn(),
        addListener: (element: HTMLElement, event: string, fn: (e: Event) => void, options?: AddEventListenerOptions) => {
            element.addEventListener(event, fn as EventListener, options);
        },
        removeListener: vi.fn(),
        menuView: {
            removeSnippetEditButtonActive: vi.fn(),
            destroyGlobalKeyDownHandler: vi.fn(),
        },
        editorManager: {checkAndManageThemeWatch: vi.fn()},
    } as unknown as PluginSnippets;
    return plugin;
};

const stubWindowSiyuan = () => {
    (window as unknown as {siyuan: {menus: {menu: {element: {style: {zIndex: string}}}}; dialogs: unknown[]}}).siyuan = {
        menus: {menu: {element: {style: {zIndex: "100"}}}},
        dialogs: [],
    };
};

const makeSnippet = (id: string, name = id, content = ""): Snippet =>
    ({id, name, type: "css", content, enabled: true});

/** 构造一个已挂 Dialog 对象、属性完整的编辑对话框元素 */
const makeOpenDialogElement = (key = "jcsm-snippet-dialog", snippetId = "1") => {
    const element = document.createElement("div");
    element.className = "b3-dialog b3-dialog--open";
    element.dataset.key = key;
    element.dataset.snippetId = snippetId;
    // closeByElement 依赖 element.querySelector(".b3-dialog").style
    const inner = document.createElement("div");
    inner.className = "b3-dialog";
    element.appendChild(inner);
    const dialogObject = {
        id: "dialog-" + snippetId,
        destroyNative: vi.fn(),
        destroyCallback: undefined as (() => void) | undefined,
    };
    attachDialogObject(element, dialogObject as never);
    document.body.appendChild(element);
    return {element, dialogObject};
};

describe("SnippetsDialog", () => {
    let plugin: PluginSnippets;
    let dialog: SnippetsDialog;

    beforeEach(() => {
        document.body.innerHTML = "";
        plugin = createPlugin();
        stubWindowSiyuan();
        dialog = new SnippetsDialog(plugin);
    });

    afterEach(() => {
        document.body.innerHTML = "";
        vi.useRealTimers();
    });

    describe("reloadUI", () => {
        it("无未保存变更（无对话框/无改动）时直接重载", () => {
            dialog.reloadUI();
            expect(plugin.postReloadUI).toHaveBeenCalledTimes(1);
        });

        it("已存在片段标题与内容均未变更时直接重载", () => {
            const {element} = makeOpenDialogElement();
            plugin.snippetsList = [makeSnippet("1", "名", "")];
            const nameInput = document.createElement("input");
            nameInput.className = "jcsm-dialog-name";
            nameInput.value = "名";
            element.appendChild(nameInput);
            dialog.reloadUI();
            expect(plugin.postReloadUI).toHaveBeenCalledTimes(1);
        });

        it("存在未保存变更时弹确认框，确认后重载", () => {
            const {element} = makeOpenDialogElement();
            plugin.snippetsList = [makeSnippet("1", "原名称", "")];
            const nameInput = document.createElement("input");
            nameInput.className = "jcsm-dialog-name";
            nameInput.value = "改过的名称"; // 与列表中的名称不同 → 未保存变更
            element.appendChild(nameInput);
            dialog.reloadUI();
            expect(plugin.postReloadUI).not.toHaveBeenCalled();

            // 确认框已打开
            const confirmDialog = document.body.querySelector('.b3-dialog--open[data-key="jcsm-reload-ui-confirm"]') as HTMLElement;
            expect(confirmDialog).not.toBeNull();
            const confirmButton = confirmDialog.querySelector("button[data-type='confirm']") as HTMLButtonElement;
            confirmButton.dispatchEvent(new MouseEvent("click", {bubbles: true}));
            expect(plugin.postReloadUI).toHaveBeenCalledTimes(1);
        });
    });

    describe("openDeleteDialog", () => {
        it("点击确认执行删除回调", () => {
            const onConfirm = vi.fn();
            dialog.openDeleteDialog("片段名", onConfirm);
            const confirmDialog = document.body.querySelector('.b3-dialog--open[data-key="jcsm-snippet-delete"]') as HTMLElement;
            expect(confirmDialog).not.toBeNull();
            (confirmDialog.querySelector("button[data-type='confirm']") as HTMLButtonElement)
                .dispatchEvent(new MouseEvent("click", {bubbles: true}));
            expect(onConfirm).toHaveBeenCalledTimes(1);
        });
    });

    describe("closeByElement", () => {
        it("空参数时记录错误并返回", () => {
            dialog.closeByElement(undefined as unknown as HTMLElement);
            expect(plugin.console.error).toHaveBeenCalledWith(expect.stringContaining("undefined"));
        });

        it("未挂 Dialog 对象的元素移除监听后记录错误并返回", () => {
            const orphan = document.createElement("div");
            orphan.dataset.key = "jcsm-snippet-dialog";
            // 编辑对话框分支先执行：移除编辑按钮高亮与监听器，随后发现无 dialogObject 记录错误
            dialog.closeByElement(orphan);
            expect(plugin.console.error).toHaveBeenCalledWith(expect.stringContaining("dialogObject not found"));
            expect(plugin.removeListener).toHaveBeenCalledWith(orphan);
            expect(plugin.menuView.destroyGlobalKeyDownHandler).not.toHaveBeenCalled();
        });

        it("编辑对话框：清理编辑按钮高亮、移除监听并调用 destroyNative，兜底销毁在 1s 后执行", () => {
            vi.useFakeTimers();
            const {element, dialogObject} = makeOpenDialogElement();
            dialog.closeByElement(element);
            expect(plugin.menuView.removeSnippetEditButtonActive).toHaveBeenCalledWith("1");
            expect(plugin.removeListener).toHaveBeenCalledWith(element);
            expect(dialogObject.destroyNative).toHaveBeenCalled();
            // destroyNative 不触发回调 → 1s 兜底执行 destroyEventHandler
            expect(plugin.menuView.destroyGlobalKeyDownHandler).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1000);
            expect(plugin.menuView.destroyGlobalKeyDownHandler).toHaveBeenCalled();
            expect(plugin.editorManager.checkAndManageThemeWatch).toHaveBeenCalled();
            // 延迟 200ms 后元素移除
            vi.advanceTimersByTime(Constants_TIMEOUT);
            expect(document.body.contains(element)).toBe(false);
        });
    });

    describe("getAllModalElements / closeAllDialogs", () => {
        it("getAllModalElements 仅收集 jcsm- 开头的打开对话框", () => {
            makeOpenDialogElement("jcsm-setting-dialog", "s");
            makeOpenDialogElement("jcsm-snippet-dialog", "1");
            const foreign = document.createElement("div");
            foreign.className = "b3-dialog--open";
            foreign.dataset.key = "other-dialog";
            document.body.appendChild(foreign);
            const result = dialog.getAllModalElements();
            expect(result).toHaveLength(2);
            expect(result.every(el => (el.dataset.key ?? "").startsWith("jcsm-"))).toBe(true);
        });

        it("closeAllDialogs 逐个关闭打开的 jcsm 对话框", () => {
            const {dialogObject: d1} = makeOpenDialogElement("jcsm-setting-dialog", "s");
            const {dialogObject: d2} = makeOpenDialogElement("jcsm-snippet-dialog", "1");
            const spy = vi.spyOn(dialog, "closeByElement");
            dialog.closeAllDialogs();
            expect(spy).toHaveBeenCalledTimes(2);
            expect(d1.destroyNative).toHaveBeenCalled();
            expect(d2.destroyNative).toHaveBeenCalled();
        });
    });
});

/** Constants.TIMEOUT_DBLCLICK 测试内取值（mock 中为 200） */
const Constants_TIMEOUT = 200;
