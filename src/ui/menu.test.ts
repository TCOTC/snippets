// ui/menu.ts SnippetsMenu 轻量单测（不打开完整菜单 open 流）
// 覆盖：isShowPublishCheckbox 三分支、genMenuSnippetsItems（排序/按钮显隐/发布开关隐藏/名称安全转义）、
//       setMenuSnippetCount（计数与 99+ 截断）、setMenuSnippetsType、clearMenuSelection 与编辑按钮高亮、
//       setReloadUIButtonBreathing 幂等、setSnippetsTypeSwitchBreathing、isDialogAndMenuOpen、
//       globalKeyDownHandler（模态对话框路由 Esc/Enter、非模态 Esc 按 zIndex 路由、编辑器内阻止冒泡）。
// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type PluginSnippets from "../index";
import {SnippetsConfig} from "../config/config";
import type {Snippet, SnippetType} from "../types";
import {SnippetsMenu} from "./menu";
import {getDialogKeyHandler, setDialogKeyHandler} from "../utils";

/** 构造 SnippetsMenu 替身插件（覆盖测试用到的全部读取路径） */
const createPlugin = (overrides: Partial<Record<string, unknown>> = {}) => {
    const plugin = {
        isMobile: false,
        isReloadUIRequired: false,
        snippetsList: [] as Snippet[],
        snippetsType: "css" as SnippetType,
        config: new SnippetsConfig(),
        i18n: {
            emptySnippet: "空片段",
            snippetDisabledInPublish: "发布显示",
            add: "添加",
        },
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
        showErrorMessage: vi.fn(),
        showNotification: vi.fn(),
        snippetManager: {getSnippetById: vi.fn()},
        snippetsDialog: {getAllModalElements: vi.fn(() => [])},
        addListener: vi.fn(),
        removeListener: vi.fn(),
        ...overrides,
    } as unknown as PluginSnippets;
    return plugin;
};

/** 注入 window.siyuan.config 运行态（菜单相关读取） */
const stubSiyuanConfig = (partial: {publishEnable?: boolean; enabledCSS?: boolean; enabledJS?: boolean; keymap?: unknown}) => {
    (window as unknown as {siyuan: {config: Record<string, unknown>}}).siyuan = {
        config: {
            publish: {enable: partial.publishEnable ?? false},
            snippet: {enabledCSS: partial.enabledCSS ?? true, enabledJS: partial.enabledJS ?? true},
            keymap: partial.keymap ?? {},
        },
    };
};

const makeSnippet = (id: string, type: SnippetType, name = id, enabled = true): Snippet =>
    ({id, name, type, content: "content", enabled});

describe("SnippetsMenu", () => {
    let plugin: PluginSnippets;
    let menu: SnippetsMenu;

    beforeEach(() => {
        document.body.innerHTML = "";
        document.documentElement.innerHTML = "";
        plugin = createPlugin();
        stubSiyuanConfig({});
        menu = new SnippetsMenu(plugin);
        // SnippetsMenu 构造会读取 isTouchDevice（jsdom 非触摸）
    });

    afterEach(() => {
        document.body.innerHTML = "";
        document.documentElement.innerHTML = "";
    });

    describe("isShowPublishCheckbox", () => {
        it("配置 0：跟随发布服务开关", () => {
            plugin.config.showPublishCheckbox = 0;
            stubSiyuanConfig({publishEnable: true});
            expect(menu.isShowPublishCheckbox()).toBe(true);
            stubSiyuanConfig({publishEnable: false});
            expect(menu.isShowPublishCheckbox()).toBe(false);
        });

        it("配置 1：总是显示；配置 2：总是隐藏", () => {
            plugin.config.showPublishCheckbox = 1;
            expect(menu.isShowPublishCheckbox()).toBe(true);
            plugin.config.showPublishCheckbox = 2;
            expect(menu.isShowPublishCheckbox()).toBe(false);
        });
    });

    describe("genMenuSnippetsItems", () => {
        it("默认按配置排序方式生成片段项 HTML", () => {
            plugin.snippetsList = [
                makeSnippet("20250201000000-b", "css", "b"),
                makeSnippet("20250101000000-a", "css", "a"),
            ];
            plugin.config.snippetSortType = "fileNameASC";
            const html = menu.genMenuSnippetsItems();
            // 排序生效：a 在 b 前
            expect(html.indexOf("data-id=\"20250101000000-a\"")).toBeLessThan(html.indexOf("data-id=\"20250201000000-b\""));
        });

        it("传入指定列表时不排序、按给定顺序生成", () => {
            const html = menu.genMenuSnippetsItems([
                makeSnippet("2", "css", "second"),
                makeSnippet("1", "css", "first"),
            ]);
            expect(html.indexOf("data-id=\"2\"")).toBeLessThan(html.indexOf("data-id=\"1\""));
        });

        it("片段名称经 textContent 安全转义（防 XSS）", () => {
            plugin.config.snippetSortType = "customSort";
            plugin.snippetsList = [makeSnippet("1", "css", "<img src=x onerror=alert(1)>")];
            const html = menu.genMenuSnippetsItems();
            expect(html).not.toContain("<img");
            expect(html).toContain("&lt;img");
        });

        it("按钮显隐随 show* 配置（隐藏按钮带 fn__none）", () => {
            plugin.config.showDeleteButton = false;
            plugin.config.showDuplicateButton = true;
            plugin.config.showEditButton = true;
            const html = menu.genMenuSnippetsItems([makeSnippet("1", "css")]);
            expect(html).toContain("data-type=\"delete\"");
            expect(html).toContain("fn__none");
            const deleteBtn = html.match(/<button[^>]*data-type="delete"[^>]*>/)?.[0] ?? "";
            expect(deleteBtn).toContain("fn__none");
            const dupBtn = html.match(/<button[^>]*data-type="duplicate"[^>]*>/)?.[0] ?? "";
            expect(dupBtn).not.toContain("fn__none");
        });

        it("发布开关按显示策略隐藏（fn__none）", () => {
            plugin.config.showPublishCheckbox = 2; // 总是不显示
            const html = menu.genMenuSnippetsItems([makeSnippet("1", "css")]);
            const publishHtml = html.match(/<input[^>]*data-type="publishSwitch"[^>]*>/)?.[0] ?? "";
            expect(publishHtml).toContain("fn__none");
            expect(html).toContain("checked"); // snippetSwitch 默认启用勾选
        });
    });

    describe("setMenuSnippetCount", () => {
        const mountMenuItems = (): HTMLElement => {
            const items = document.createElement("div");
            items.innerHTML = `
                <span class="jcsm-tab-count-css"></span>
                <span class="jcsm-tab-count-js"></span>
            `;
            menu.menuItems = items;
            return items;
        };

        it("菜单未打开时直接返回", () => {
            menu.menu = undefined;
            menu.menuItems = document.createElement("div");
            expect(() => menu.setMenuSnippetCount()).not.toThrow();
        });

        it("按类型统计计数并写入（超过 99 显示 99+）", () => {
            menu.menu = {} as never;
            mountMenuItems();
            plugin.snippetsList = [
                ...Array.from({length: 100}, (_, i) => makeSnippet(`c${i}`, "css")),
                makeSnippet("j1", "js"),
            ];
            menu.setMenuSnippetCount();
            const items = menu.menuItems;
            expect(items.querySelector(".jcsm-tab-count-css")!.textContent).toBe("99+");
            expect(items.querySelector(".jcsm-tab-count-js")!.textContent).toBe("1");
        });
    });

    describe("setMenuSnippetsType / 选中与编辑按钮", () => {
        const mountMenuItems = (): HTMLElement => {
            const items = document.createElement("div");
            items.innerHTML = `
                <div class="jcsm-top-container" data-type="css">
                    <input class="jcsm-all-snippets-switch" type="checkbox">
                    <button data-type="new"></button>
                </div>
                <div class="jcsm-snippet-item b3-menu__item" data-type="css" data-id="1">
                    <button data-type="edit"></button>
                </div>
            `;
            menu.menuItems = items;
            return items;
        };

        it("切换类型更新全局开关勾选、新建按钮提示与容器 data-type", () => {
            mountMenuItems();
            stubSiyuanConfig({enabledJS: false});
            menu.setMenuSnippetsType("js");
            const items = menu.menuItems;
            expect((items.querySelector(".jcsm-all-snippets-switch") as HTMLInputElement).checked).toBe(false);
            expect(items.querySelector(".jcsm-top-container")!.getAttribute("data-type")).toBe("js");
            expect(items.querySelector("button[data-type='new']")!.getAttribute("aria-label")).toBe("添加 JS");
        });

        it("编辑按钮高亮设置与移除", () => {
            mountMenuItems();
            menu.setSnippetEditButtonActive("1");
            expect(menu.menuItems.querySelector(".jcsm-snippet-item button[data-type='edit']")!.classList.contains("jcsm-active")).toBe(true);
            menu.removeSnippetEditButtonActive("1");
            expect(menu.menuItems.querySelector(".jcsm-snippet-item button[data-type='edit']")!.classList.contains("jcsm-active")).toBe(false);
        });

        it("空 id 编辑按钮操作直接返回", () => {
            mountMenuItems();
            expect(() => menu.setSnippetEditButtonActive("")).not.toThrow();
            expect(() => menu.removeSnippetEditButtonActive("")).not.toThrow();
        });

        it("clearMenuSelection 清除选中类", () => {
            const items = mountMenuItems();
            items.querySelector(".jcsm-snippet-item")!.classList.add("b3-menu__item--current");
            menu.clearMenuSelection();
            expect(items.querySelector(".jcsm-snippet-item")!.classList.contains("b3-menu__item--current")).toBe(false);
        });
    });

    describe("呼吸动画", () => {
        it("setReloadUIButtonBreathing 置位并添加呼吸类（幂等不重复）", async () => {
            const items = document.createElement("div");
            items.innerHTML = '<div class="jcsm-top-container"><button data-type="reload"></button></div>';
            menu.menuItems = items;
            await menu.setReloadUIButtonBreathing();
            expect(plugin.isReloadUIRequired).toBe(true);
            expect(items.querySelector("button[data-type='reload']")!.classList.contains("jcsm-breathing")).toBe(true);
            await menu.setReloadUIButtonBreathing(); // 已置位 → 直接返回
            expect(items.querySelector("button[data-type='reload']")!.classList.contains("jcsm-breathing")).toBe(true);
        });

        it("setSnippetsTypeSwitchBreathing 添加一次性呼吸类并在动画后移除", async () => {
            vi.useFakeTimers();
            const items = document.createElement("div");
            items.innerHTML = '<div class="jcsm-top-container"><input class="jcsm-all-snippets-switch"></div>';
            menu.menuItems = items;
            menu.setSnippetsTypeSwitchBreathing();
            const input = items.querySelector(".jcsm-all-snippets-switch")!;
            expect(input.classList.contains("jcsm-input-breathing--once")).toBe(true);
            await vi.advanceTimersByTimeAsync(700);
            expect(input.classList.contains("jcsm-input-breathing--once")).toBe(false);
            vi.useRealTimers();
        });
    });

    describe("isDialogAndMenuOpen / globalKeyDownHandler", () => {
        it("存在打开的插件对话框或菜单时返回 true", () => {
            expect(menu.isDialogAndMenuOpen()).toBe(false);
            const dialog = document.createElement("div");
            dialog.className = "b3-dialog--open";
            dialog.dataset.key = "jcsm-setting-dialog";
            document.body.appendChild(dialog);
            expect(menu.isDialogAndMenuOpen()).toBe(true);
        });

        it("有最顶层模态对话框时路由按键到其登记的键盘处理器", () => {
            const dialog = document.createElement("div");
            dialog.className = "b3-dialog--open";
            dialog.dataset.key = "jcsm-setting-dialog";
            document.body.appendChild(dialog);
            const handler = vi.fn();
            setDialogKeyHandler(dialog, handler);
            (plugin.snippetsDialog.getAllModalElements as ReturnType<typeof vi.fn>).mockReturnValue([dialog]);

            const event = {key: "Escape", stopPropagation: vi.fn()} as unknown as KeyboardEvent;
            menu.globalKeyDownHandler(event);
            expect(event.stopPropagation).toHaveBeenCalled();
            expect(handler).toHaveBeenCalledWith("Escape");
        });

        it("无模态对话框时 Esc 按 zIndex 路由到最高的非模态编辑对话框", () => {
            const editDialog = document.createElement("div");
            editDialog.className = "b3-dialog b3-dialog--open";
            editDialog.dataset.key = "jcsm-snippet-dialog";
            editDialog.dataset.snippetId = "1";
            editDialog.style.zIndex = "50";
            document.body.appendChild(editDialog);
            const handler = vi.fn();
            setDialogKeyHandler(editDialog, handler);

            const event = {key: "Escape", stopPropagation: vi.fn()} as unknown as KeyboardEvent;
            menu.globalKeyDownHandler(event);
            expect(handler).toHaveBeenCalledWith("Escape");
            expect(plugin.snippetsDialog.getAllModalElements).toHaveBeenCalled();
            void getDialogKeyHandler;
        });

        it("焦点在代码编辑对话框内时按键阻止冒泡", () => {
            const editDialog = document.createElement("div");
            editDialog.className = "b3-dialog b3-dialog--open";
            editDialog.dataset.key = "jcsm-snippet-dialog";
            editDialog.dataset.snippetId = "1";
            document.body.appendChild(editDialog);
            const input = document.createElement("input");
            editDialog.appendChild(input);
            input.focus();

            const event = {key: "a", stopPropagation: vi.fn()} as unknown as KeyboardEvent;
            menu.globalKeyDownHandler(event);
            expect(event.stopPropagation).toHaveBeenCalled();
        });
    });
});
