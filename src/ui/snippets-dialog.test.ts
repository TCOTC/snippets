// ui/snippets-dialog.ts SnippetsDialog 核心公开方法单测
// 覆盖：reloadUI（无变更直接重载/有变更弹确认再重载）、openDeleteDialog 确认回调、
//       closeByElement（空参防御/无 dialogObject 防御/编辑对话框清理与延迟兜底销毁）、
//       getAllModalElements/closeAllDialogs、openEditDialog 取消关闭后补触发待定 JS 重载（issue #40）。
// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type PluginSnippets from "../index";
import {SnippetsConfig} from "../config/config";
import type {Snippet, SnippetType} from "../types";
import {SnippetsDialog} from "./snippets-dialog";
import {attachDialogObject, getDialogKeyHandler, getDialogObject} from "../utils";
import {EditorManager} from "./editor-manager";

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
            close: vi.fn(),
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

/**
 * openEditDialog 取消关闭后补触发待定 JS 重载（issue #40）
 * 复现路径：菜单禁用 JS 代码片段时若编辑对话框仍打开，自动重载被延迟；随后在代码编辑器中
 * 关闭该片段开关并点击"取消"关闭对话框 → 应补触发自动重新加载界面。
 * 本组测试真实装配 openEditDialog（含 CodeMirror 编辑器实例化）并驱动取消流程。
 */
describe("openEditDialog 取消关闭与待定 JS 重载（issue #40）", () => {
    /** 带 CodeMirror/编辑器所需运行态的 window.siyuan 桩 */
    const stubFullWindowSiyuan = () => {
        (window as unknown as {
            siyuan: {
                menus: {menu: {element: {style: {zIndex: string}}}};
                dialogs: unknown[];
                zIndex: number;
                config: {appearance: {mode: number}; editor: {codeTabSpaces: number}};
            };
        }).siyuan = {
            menus: {menu: {element: {style: {zIndex: "100"}}}},
            dialogs: [],
            zIndex: 100,
            config: {
                appearance: {mode: 0},
                editor: {codeTabSpaces: 4},
            },
        };
    };

    /** 构造 SnippetsDialog 替身插件（编辑器管理器用真实 EditorManager，便于验证重载门控） */
    const createDialogPlugin = () => {
        const plugin = {
            isMobile: false,
            isReloadUIRequired: true,
            snippetsList: [] as Snippet[],
            snippetsType: "js" as SnippetType,
            config: new SnippetsConfig(),
            i18n: {
                save: "保存",
                cancel: "取消",
                codeSnippetJS: "输入 JS 代码片段",
                codeSnippetCSS: "输入 CSS 代码片段",
                cancelConfirm: "⚠️ 取消操作确认",
                cancelConfirmEditSnippet: "${x} 的修改未保存，确定要放弃修改代码片段${y}吗？",
                cancelConfirmNewSnippet: "有未保存的修改，确定要退出新建代码片段${y}吗？",
                continueEdit: "继续编辑",
                giveUpEdit: "放弃修改",
            },
            console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
            postReloadUI: vi.fn(),
            addListener: (element: HTMLElement, event: string, fn: (e: Event) => void, options?: AddEventListenerOptions) => {
                element.addEventListener(event, fn as EventListener, options);
            },
            removeListener: vi.fn(),
            menuView: {
                close: vi.fn(),
                isShowPublishCheckbox: () => false,
                setSnippetEditButtonActive: vi.fn(),
                removeSnippetEditButtonActive: vi.fn(),
                destroyGlobalKeyDownHandler: vi.fn(),
            },
            snippetManager: {
                getSnippetById: vi.fn(),
                removeSnippetElement: vi.fn(),
            },
            syncService: undefined,
        } as unknown as PluginSnippets;
        (plugin as unknown as {editorManager: EditorManager}).editorManager = new EditorManager(plugin);
        return plugin;
    };

    const jsSnippet = (id: string, name: string, enabled: boolean): Snippet =>
        ({id, name, type: "js", content: "", enabled, disabledInPublish: false});

    let plugin: PluginSnippets;
    let dialog: SnippetsDialog;

    beforeEach(() => {
        document.body.innerHTML = "";
        stubFullWindowSiyuan();
        // jsdom 未实现 rAF/cAF，CodeMirror 编辑器实例化需要
        (window as unknown as {requestAnimationFrame: (cb: FrameRequestCallback) => number}).requestAnimationFrame =
            (cb: FrameRequestCallback) => window.setTimeout(cb, 16);
        (window as unknown as {cancelAnimationFrame: (id: number) => void}).cancelAnimationFrame =
            (id: number) => window.clearTimeout(id);
        plugin = createDialogPlugin();
        dialog = new SnippetsDialog(plugin);
    });

    afterEach(() => {
        document.body.innerHTML = "";
        // 停止可能已启动的主题模式监听，避免跨用例残留
        (plugin as unknown as {editorManager: EditorManager}).editorManager.stopThemeModeWatch();
    });

    /** 打开 JS 片段编辑对话框并让其原生 destroy 同步移除 b3-dialog--open（对齐原生 destroy 首行行为） */
    const openAndArmDestroy = async (snippet: Snippet) => {
        await dialog.openEditDialog(snippet);
        const dialogElement = document.querySelector(`.b3-dialog--open[data-key="jcsm-snippet-dialog"][data-snippet-id="${snippet.id}"]`) as HTMLElement;
        expect(dialogElement).not.toBeNull();
        const dialogObject = getDialogObject(dialogElement)!;
        (dialogObject as unknown as {destroyNative: () => void}).destroyNative = () => {
            dialogElement.classList.remove("b3-dialog--open");
        };
        return dialogElement;
    };

    it("菜单已禁用 JS 片段（待定重载）时取消关闭编辑器 → 自动重新加载界面", async () => {
        // 步骤 1-2：菜单已禁用片段（保存态 enabled=false，isReloadUIRequired=true），打开编辑对话框时开关仍为开
        (plugin as unknown as {isReloadUIRequired: boolean}).isReloadUIRequired = true;
        (plugin as unknown as {snippetsList: Snippet[]}).snippetsList = [jsSnippet("1", "片段", false)];
        const dialogElement = await openAndArmDestroy(jsSnippet("1", "片段", true));
        const switchInput = dialogElement.querySelector("input[data-type='snippetSwitch']") as HTMLInputElement;
        expect(switchInput.checked).toBe(true);
        // 步骤 5：在代码编辑器中关闭代码片段开关（与已保存的禁用态一致）
        switchInput.checked = false;
        (plugin.snippetManager.getSnippetById as ReturnType<typeof vi.fn>).mockResolvedValue(jsSnippet("1", "片段", false));
        // 步骤 6：点击取消关闭代码编辑器 → 补触发待定重载
        (dialogElement.querySelector("button[data-action='cancel']") as HTMLButtonElement)
            .dispatchEvent(new MouseEvent("click", {bubbles: true}));
        await vi.waitFor(() => {
            expect(plugin.postReloadUI).toHaveBeenCalledTimes(1);
        });
    });

    it("无待定 JS 重载时取消关闭编辑器 → 不自动重新加载界面", async () => {
        (plugin as unknown as {isReloadUIRequired: boolean}).isReloadUIRequired = false;
        (plugin as unknown as {snippetsList: Snippet[]}).snippetsList = [jsSnippet("1", "片段", true)];
        const dialogElement = await openAndArmDestroy(jsSnippet("1", "片段", true));
        (plugin.snippetManager.getSnippetById as ReturnType<typeof vi.fn>).mockResolvedValue(jsSnippet("1", "片段", true));
        (dialogElement.querySelector("button[data-action='cancel']") as HTMLButtonElement)
            .dispatchEvent(new MouseEvent("click", {bubbles: true}));
        // 等取消流程走完（getSnippetById 被调用）后确认没有触发重载
        await vi.waitFor(() => {
            expect(plugin.snippetManager.getSnippetById).toHaveBeenCalled();
        });
        expect(plugin.postReloadUI).not.toHaveBeenCalled();
    });

    it("仍有其他编辑对话框打开时取消关闭 → 延迟重载，最后一个对话框关闭后才触发", async () => {
        (plugin as unknown as {snippetsList: Snippet[]}).snippetsList = [jsSnippet("1", "片段一", false), jsSnippet("2", "片段二", true)];
        // 打开两个编辑对话框（桌面多编辑器模式，均非模态）
        const dialogElementA = await openAndArmDestroy(jsSnippet("1", "片段一", true));
        const dialogElementB = await openAndArmDestroy(jsSnippet("2", "片段二", true));
        (plugin.snippetManager.getSnippetById as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) =>
            id === "1" ? jsSnippet("1", "片段一", false) : jsSnippet("2", "片段二", true));
        // 关闭片段一（保存态已禁用）→ 片段一开关拨到关，取消
        (dialogElementA.querySelector("input[data-type='snippetSwitch']") as HTMLInputElement).checked = false;
        (dialogElementA.querySelector("button[data-action='cancel']") as HTMLButtonElement)
            .dispatchEvent(new MouseEvent("click", {bubbles: true}));
        // 片段二仍打开 → 暂不重载
        await vi.waitFor(() => {
            expect(plugin.snippetManager.getSnippetById).toHaveBeenCalledTimes(1);
        });
        expect(plugin.postReloadUI).not.toHaveBeenCalled();
        // 取消关闭片段二 → 已无打开的编辑对话框 → 补触发重载
        (dialogElementB.querySelector("button[data-action='cancel']") as HTMLButtonElement)
            .dispatchEvent(new MouseEvent("click", {bubbles: true}));
        await vi.waitFor(() => {
            expect(plugin.postReloadUI).toHaveBeenCalledTimes(1);
        });
    });

    it("有变更取消时放弃修改确认框默认聚焦红色主按钮，回车先触发该按钮", async () => {
        (plugin as unknown as {isReloadUIRequired: boolean}).isReloadUIRequired = false;
        (plugin as unknown as {snippetsList: Snippet[]}).snippetsList = [jsSnippet("1", "片段", true)];
        const dialogElement = await openAndArmDestroy(jsSnippet("1", "片段", true));
        // 保存态内容与编辑框中内容（空）不同 → 取消时弹放弃修改确认框
        (plugin.snippetManager.getSnippetById as ReturnType<typeof vi.fn>)
            .mockResolvedValue({...jsSnippet("1", "片段", true), content: "已保存内容"});
        const closeSpy = vi.spyOn(dialog, "closeByElement");
        (dialogElement.querySelector("button[data-action='cancel']") as HTMLButtonElement)
            .dispatchEvent(new MouseEvent("click", {bubbles: true}));
        // 等待放弃修改确认框出现
        await vi.waitFor(() => {
            expect(document.body.querySelector('.b3-dialog--open[data-key="jcsm-snippet-cancel"]')).not.toBeNull();
        });
        const cancelDialog = document.body.querySelector('.b3-dialog--open[data-key="jcsm-snippet-cancel"]') as HTMLElement;
        const confirmButton = cancelDialog.querySelector("button[data-type='confirm']") as HTMLButtonElement;
        // 红色主按钮（放弃修改）默认聚焦
        expect(confirmButton.classList.contains("b3-button--remove")).toBe(true);
        expect(document.activeElement).toBe(confirmButton);
        // Enter：焦点在按钮上时对话框级键盘动作交还浏览器默认行为（激活聚焦按钮），不自行执行默认确认
        getDialogKeyHandler(cancelDialog)?.("Enter");
        expect(closeSpy).not.toHaveBeenCalled();
        // 浏览器默认行为 = 触发聚焦按钮的 click → 执行放弃修改并关闭编辑对话框
        confirmButton.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        expect(closeSpy).toHaveBeenCalledTimes(2);
        expect(dialogElement.classList.contains("b3-dialog--open")).toBe(false);
    });

    it("打开代码片段编辑器成功后关闭插件菜单", async () => {
        (plugin as unknown as {isReloadUIRequired: boolean}).isReloadUIRequired = false;
        (plugin as unknown as {snippetsList: Snippet[]}).snippetsList = [jsSnippet("1", "片段", true)];
        await openAndArmDestroy(jsSnippet("1", "片段", true));
        // 关闭动作延时至对话框 b3-dialog--open 生效后执行（防止菜单关闭回调误触发待定 JS 自动重载）
        await vi.waitFor(() => {
            expect(plugin.menuView.close).toHaveBeenCalled();
        });
    });
});

/** Constants.TIMEOUT_DBLCLICK 测试内取值（mock 中为 200） */
const Constants_TIMEOUT = 200;
