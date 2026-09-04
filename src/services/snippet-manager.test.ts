// services/snippet-manager.ts SnippetManager 单测
// 覆盖：updateSnippetElement/removeSnippetElement 的注入元素增删改与 JS 重载提示、
//       saveSnippet 本地新增/仅改名更新/复制与远程分支、deleteSnippet、
//       toggleSnippet/toggleSnippetPublish/globalToggleSnippet 的本地/远程语义、
//       buildSyncHandlers 广播分发（禁原文约束：接收方按 ID 自拉）。
// 浏览器环境 jsdom；fetchPost/fetchSyncPost 经 alias mock 注入响应。
// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import {fetchPost, fetchSyncPost} from "siyuan";
import type {Menu} from "siyuan";
import type PluginSnippets from "../index";
import {SnippetsConfig} from "../config/config";
import type {Snippet, SnippetType} from "../types";
import {SnippetManager} from "./snippet-manager";

/**
 * 构造代码片段
 * @param id 片段 id
 * @param type 类型
 * @param content 内容
 * @param enabled 是否启用
 * @param name 名称
 * @returns 代码片段
 */
const makeSnippet = (id: string, type: SnippetType, content = "body {}", enabled = true, name = id): Snippet =>
    ({id, name, type, content, enabled});

/**
 * 构造 SnippetManager 最小插件替身
 * @param serverSnippets 内核 /api/snippet/getSnippet 返回的片段列表（权威源）
 * @returns {manager, plugin, broadcastMock}
 */
const setup = (serverSnippets: Snippet[] = []) => {
    const broadcast = vi.fn();
    const plugin = {
        snippetsList: [] as Snippet[],
        snippetsType: "css" as SnippetType,
        config: new SnippetsConfig(),
        i18n: {
            duplicate: "副本",
            getSnippetFailed: "获取代码片段失败",
            getSnippetsListFailed: "获取代码片段列表失败",
            saveSnippetsListFailed: "保存代码片段失败",
            deleteSnippetFailed: "删除代码片段失败",
            updateSnippetElementParamError: "代码片段参数错误",
            invalidJavaScriptCode: "无效的 JS 代码",
            invalidCssSnippetContent: "CSS 内容违规",
        },
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
        showErrorMessage: vi.fn(),
        snippetStore: {upsert: vi.fn(), remove: vi.fn(), insertBefore: vi.fn(), replaceAll: vi.fn()},
        menuView: {
            menu: undefined,
            menuItems: undefined,
            genMenuSnippetsItems: vi.fn(() => ""),
            initSnippetsContainer: vi.fn(),
            setSnippetsTypeSwitchBreathing: vi.fn(),
            promptJSReloadRequired: vi.fn(async () => {}),
        },
        snippetsDialog: {openEditDialog: vi.fn()},
        syncService: {broadcast},
    } as unknown as PluginSnippets;

    vi.mocked(fetchSyncPost).mockResolvedValue({code: 0, msg: "", data: {snippets: serverSnippets}});
    // 回调形 fetchPost：立即以成功响应回调（saveSnippetsList 依赖回调 resolve）
    vi.mocked(fetchPost).mockImplementation(((_url: string, _body: unknown, callback?: (response: {code: number}) => void) => {
        callback?.({code: 0});
        return undefined;
    }) as never);

    // 注入 window.siyuan 运行态（jsdom window 需保留 document，不能整窗 stub）
    (window as unknown as {siyuan: {config: {snippet: {enabledCSS: boolean; enabledJS: boolean}}}}).siyuan = {
        config: {snippet: {enabledCSS: true, enabledJS: true}},
    };

    // snippetsList 以内核权威列表初始化（个别用例验证“列表为空时远程自拉”可显式置空）
    plugin.snippetsList = [...serverSnippets];

    const manager = new SnippetManager(plugin);
    return {manager, plugin, broadcast};
};

describe("SnippetManager", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
    });

    /** 断言注入元素存在（CSS → style、JS → script，id 为 snippetCSS/JS + id） */
    const expectInjected = (snippetId: string, type: SnippetType, content: string) => {
        const tag = type === "css" ? "style" : "script";
        const element = document.getElementById(`snippet${type.toUpperCase()}${snippetId}`);
        expect(element).not.toBeNull();
        expect(element!.tagName.toLowerCase()).toBe(tag);
        expect(element!.textContent).toBe(content);
    };

    describe("updateSnippetElement 注入元素", () => {
        it("CSS 片段启用且全局启用时注入 style 元素", async () => {
            const {manager} = setup();
            (window.siyuan as unknown as {config: {snippet: {enabledCSS: boolean}}}).config.snippet.enabledCSS = true;
            await manager.updateSnippetElement(makeSnippet("css-1", "css", "body {}"));
            expectInjected("css-1", "css", "body {}");
        });

        it("同内容重复更新不重建元素（保留原元素）", async () => {
            const {manager} = setup();
            window.siyuan.config.snippet.enabledCSS = true;
            const snippet = makeSnippet("css-1", "css", "body {}");
            await manager.updateSnippetElement(snippet);
            const first = document.getElementById("snippetCSScss-1");
            await manager.updateSnippetElement(snippet);
            expect(document.getElementById("snippetCSScss-1")).toBe(first);
        });

        it("内容变化时替换元素", async () => {
            const {manager} = setup();
            window.siyuan.config.snippet.enabledCSS = true;
            await manager.updateSnippetElement(makeSnippet("css-1", "css", "body {}"));
            await manager.updateSnippetElement(makeSnippet("css-1", "css", "p {}"));
            expectInjected("css-1", "css", "p {}");
        });

        it("JS 片段启用且全局启用时注入 script 元素", async () => {
            const {manager} = setup();
            window.siyuan.config.snippet.enabledJS = true;
            await manager.updateSnippetElement(makeSnippet("js-1", "js", "console.log(1)", true));
            expectInjected("js-1", "js", "console.log(1)");
        });

        it("JS 内容无效时仍注入但提示无效代码", async () => {
            const {manager, plugin} = setup();
            window.siyuan.config.snippet.enabledJS = true;
            // 顶层字面量 123 被判定为无意义表达式（见 domain/snippet.ts isValidJavaScriptCode）
            await manager.updateSnippetElement(makeSnippet("js-1", "js", "123", true));
            expectInjected("js-1", "js", "123");
            expect(plugin.showErrorMessage).toHaveBeenCalledWith("无效的 JS 代码");
        });

        it("片段禁用时移除已注入元素", async () => {
            const {manager} = setup();
            window.siyuan.config.snippet.enabledCSS = true;
            await manager.updateSnippetElement(makeSnippet("css-1", "css", "body {}", true));
            expect(document.getElementById("snippetCSScss-1")).not.toBeNull();
            await manager.updateSnippetElement(makeSnippet("css-1", "css", "body {}", false));
            expect(document.getElementById("snippetCSScss-1")).toBeNull();
        });

        it("全局类型开关关闭时不注入（非预览状态）", async () => {
            const {manager} = setup();
            window.siyuan.config.snippet.enabledCSS = false;
            await manager.updateSnippetElement(makeSnippet("css-1", "css", "body {}"));
            expect(document.getElementById("snippetCSScss-1")).toBeNull();
        });

        it("参数为空时提示参数错误", async () => {
            const {manager, plugin} = setup();
            await manager.updateSnippetElement(undefined);
            await manager.updateSnippetElement(false);
            expect(plugin.showErrorMessage).toHaveBeenCalledWith("代码片段参数错误");
        });

        it("CSS 实时预览中（预览对话框存在）跳过元素更新", async () => {
            const {manager, plugin} = setup();
            window.siyuan.config.snippet.enabledCSS = false;
            // 模拟已打开该 CSS 片段的实时预览编辑对话框
            const dialog = document.createElement("div");
            dialog.className = "b3-dialog b3-dialog--open";
            dialog.dataset.key = "jcsm-snippet-dialog";
            dialog.dataset.snippetId = "css-1";
            dialog.dataset.snippetType = "css";
            document.body.appendChild(dialog);
            await manager.updateSnippetElement(makeSnippet("css-1", "css", "body {}"));
            // 预览态由对话框接管：不应新增正式注入元素，也不应触发全局开关呼吸
            expect(document.getElementById("snippetCSScss-1")).toBeNull();
            expect(plugin.menuView.setSnippetsTypeSwitchBreathing).not.toHaveBeenCalled();
        });

        it("JS 旧元素有效时更新触发 promptJSReloadRequired", async () => {
            const {manager, plugin} = setup();
            window.siyuan.config.snippet.enabledJS = true;
            await manager.updateSnippetElement(makeSnippet("js-1", "js", "console.log(1)"));
            await manager.updateSnippetElement(makeSnippet("js-1", "js", "console.log(2)"));
            expect(plugin.menuView.promptJSReloadRequired).toHaveBeenCalledWith(4000);
        });

        it("全局关闭下启用菜单内同类型片段触发全局开关呼吸", async () => {
            const {manager, plugin} = setup();
            window.siyuan.config.snippet.enabledCSS = false;
            plugin.snippetsType = "css";
            plugin.menuView.menu = {} as unknown as Menu;
            await manager.updateSnippetElement(makeSnippet("css-1", "css", "body {}", true));
            expect(plugin.menuView.setSnippetsTypeSwitchBreathing).toHaveBeenCalled();
        });
    });

    describe("removeSnippetElement", () => {
        it("参数为空时直接返回", async () => {
            const {manager, plugin} = setup();
            await manager.removeSnippetElement("", "css");
            await manager.removeSnippetElement("css-1", "");
            expect(plugin.menuView.promptJSReloadRequired).not.toHaveBeenCalled();
        });

        it("移除存在的 JS 元素并提示重载", async () => {
            const {manager, plugin} = setup();
            window.siyuan.config.snippet.enabledJS = true;
            await manager.updateSnippetElement(makeSnippet("js-1", "js", "console.log(1)"));
            await manager.removeSnippetElement("js-1", "js");
            expect(document.getElementById("snippetJSjs-1")).toBeNull();
            expect(plugin.menuView.promptJSReloadRequired).toHaveBeenCalledWith(4000);
        });
    });

    describe("saveSnippet 本地新增/更新", () => {
        it("新增片段：落库 + 注入元素 + 广播 snippet_save（不含原文）", async () => {
            const {manager, plugin, broadcast} = setup([]);
            window.siyuan.config.snippet.enabledCSS = true;
            const snippet = makeSnippet("css-new", "css", "body { color: red; }");
            await manager.saveSnippet(snippet);
            expect(plugin.snippetStore.upsert).toHaveBeenCalledWith(snippet);
            expectInjected("css-new", "css", snippet.content);
            expect(plugin.syncService?.broadcast).toHaveBeenCalledWith({
                type: "snippet_save", snippetId: "css-new", isCopy: false, copySnippetId: undefined,
            });
            void broadcast;
        });

        it("仅改名更新：落库与广播但不刷新注入元素", async () => {
            const serverList = [makeSnippet("css-1", "css", "body {}")];
            const {manager, plugin, broadcast} = setup(serverList);
            window.siyuan.config.snippet.enabledCSS = true;
            await manager.updateSnippetElement(serverList[0]);
            const firstElement = document.getElementById("snippetCSScss-1");
            await manager.saveSnippet({...serverList[0], name: "新名字"});
            expect(plugin.snippetStore.upsert).toHaveBeenCalled();
            expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({type: "snippet_save", snippetId: "css-1"}));
            // 仅改名不重建注入元素
            expect(document.getElementById("snippetCSScss-1")).toBe(firstElement);
        });

        it("无任何变化的保存不落库不广播", async () => {
            const serverList = [makeSnippet("css-1", "css", "body {}")];
            const {manager, plugin, broadcast} = setup(serverList);
            await manager.saveSnippet({...serverList[0]});
            expect(plugin.snippetStore.upsert).not.toHaveBeenCalled();
            expect(broadcast).not.toHaveBeenCalled();
        });

        it("本地保存内容含内核禁止标记的 CSS 片段时拦截（提示可定位，不落库不广播）", async () => {
            const {manager, plugin, broadcast} = setup([]);
            const badSnippet = makeSnippet("css-bad", "css", "</style><script>alert(1)</script>", true, "含脚本的CSS");
            await manager.saveSnippet(badSnippet);
            // 提示信息含片段名，可定位到具体是哪条违规
            expect(plugin.showErrorMessage).toHaveBeenCalledWith("CSS 内容违规: 含脚本的CSS");
            expect(plugin.snippetStore.upsert).not.toHaveBeenCalled();
            expect(broadcast).not.toHaveBeenCalled();
            expect(fetchPost).not.toHaveBeenCalled();
        });

        it("远程分支保存含违规内容的 CSS 片段不拦截（广播窗口已落库校验，本窗口只同步）", async () => {
            const serverList = [makeSnippet("css-bad", "css", "</style>")];
            const {manager, plugin, broadcast} = setup(serverList);
            await manager.saveSnippet(serverList[0], false, "remote");
            expect(plugin.showErrorMessage).not.toHaveBeenCalled();
            expect(plugin.snippetStore.upsert).toHaveBeenCalled();
            expect(broadcast).not.toHaveBeenCalled();
        });

        it("远程复制缺少权威副本时记录错误并返回", async () => {
            const {manager, plugin, broadcast} = setup([]);
            await manager.saveSnippet(makeSnippet("css-1", "css"), true, "remote");
            expect(plugin.console.error).toHaveBeenCalledWith(
                expect.stringContaining("copySnippet is missing"),
                expect.anything()
            );
            expect(plugin.snippetStore.upsert).not.toHaveBeenCalled();
            expect(broadcast).not.toHaveBeenCalled();
        });
    });

    describe("deleteSnippet", () => {
        it("本地删除：Store 移除 + 落库 + 移除元素 + 广播 snippet_delete", async () => {
            const serverList = [makeSnippet("js-1", "js", "console.log(1)")];
            const {manager, plugin, broadcast} = setup(serverList);
            window.siyuan.config.snippet.enabledJS = true;
            await manager.updateSnippetElement(serverList[0]);
            expect(document.getElementById("snippetJSjs-1")).not.toBeNull();

            await manager.deleteSnippet("js-1", "js");
            expect(plugin.snippetStore.remove).toHaveBeenCalledWith("js-1");
            expect(document.getElementById("snippetJSjs-1")).toBeNull();
            expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({type: "snippet_delete", snippetId: "js-1"}));
        });

        it("远程删除且广播窗口正在预览时不移除注入元素，仍同步 Store", async () => {
            const serverList = [makeSnippet("css-1", "css", "body {}")];
            const {manager, plugin} = setup(serverList);
            plugin.snippetsList = [...serverList];
            window.siyuan.config.snippet.enabledCSS = true;
            await manager.updateSnippetElement(serverList[0]);
            const element = document.getElementById("snippetCSScss-1");
            await manager.deleteSnippet("css-1", "css", "remote", true);
            // 广播窗口在预览 → 本窗口保留注入元素
            expect(document.getElementById("snippetCSScss-1")).toBe(element);
            expect(plugin.snippetStore.remove).toHaveBeenCalledWith("css-1");
        });
    });

    describe("toggleSnippet / toggleSnippetPublish", () => {
        it("本地切换开关：改状态 + 落库 + 更新元素 + 广播", async () => {
            const {manager, plugin, broadcast} = setup([]);
            plugin.snippetsList = [makeSnippet("css-1", "css", "body {}", false)];
            window.siyuan.config.snippet.enabledCSS = true;
            const snippet = plugin.snippetsList[0];
            await manager.toggleSnippet(snippet, true);
            expect(snippet.enabled).toBe(true);
            expectInjected("css-1", "css", "body {}");
            expect(broadcast).toHaveBeenCalledWith({type: "snippet_toggle", snippetId: "css-1", enabled: true});
        });

        it("本地切换但正在 CSS 实时预览时不广播", async () => {
            const {manager, plugin, broadcast} = setup([]);
            plugin.snippetsList = [makeSnippet("css-1", "css", "body {}", false)];
            window.siyuan.config.snippet.enabledCSS = true;
            const dialog = document.createElement("div");
            dialog.className = "b3-dialog b3-dialog--open";
            dialog.dataset.key = "jcsm-snippet-dialog";
            dialog.dataset.snippetId = "css-1";
            document.body.appendChild(dialog);
            await manager.toggleSnippet(plugin.snippetsList[0], true);
            expect(broadcast).not.toHaveBeenCalled();
        });

        it("远程切换：仅更新元素与菜单开关，不广播", async () => {
            const {manager, plugin, broadcast} = setup([]);
            plugin.snippetsList = [makeSnippet("css-1", "css", "body {}", false)];
            window.siyuan.config.snippet.enabledCSS = true;
            // 打开菜单（menuItems 存在）以验证开关勾选同步
            const menuItems = document.createElement("div");
            menuItems.innerHTML = "<div class=\"jcsm-snippet-item\" data-id=\"css-1\"><input type=\"checkbox\" data-type=\"snippetSwitch\"></div>";
            plugin.menuView.menuItems = menuItems as HTMLElement;
            const checkbox = menuItems.querySelector("input") as HTMLInputElement;
            await manager.toggleSnippet(plugin.snippetsList[0], true, "remote");
            expect(checkbox.checked).toBe(true);
            expectInjected("css-1", "css", "body {}");
            expect(broadcast).not.toHaveBeenCalled();
        });

        it("本地切换发布开关：改 disabledInPublish + 落库 + 广播", async () => {
            const {manager, plugin, broadcast} = setup([]);
            plugin.snippetsList = [makeSnippet("css-1", "css")];
            await manager.toggleSnippetPublish("css-1", true);
            expect(plugin.snippetsList[0].disabledInPublish).toBe(true);
            expect(broadcast).toHaveBeenCalledWith({type: "snippet_toggle_publish", snippetId: "css-1", enabled: true});
        });

        it("发布开关目标片段不存在时记录错误", async () => {
            const {manager, plugin} = setup([]);
            plugin.snippetsList = [];
            await manager.toggleSnippetPublish("missing", false);
            expect(plugin.console.error).toHaveBeenCalledWith(
                expect.stringContaining("Snippet not found"),
                expect.anything()
            );
        });
    });

    describe("globalToggleSnippet", () => {
        it("本地开启 CSS：更新内核配置镜像 + 调 setSnippet API + 广播", async () => {
            const {manager, plugin, broadcast} = setup([]);
            window.siyuan.config.snippet.enabledCSS = false;
            plugin.snippetsList = [makeSnippet("css-1", "css", "body {}", true)];
            await manager.globalToggleSnippet("css", true);
            expect(window.siyuan.config.snippet.enabledCSS).toBe(true);
            expect(fetchPost).toHaveBeenCalledWith("/api/setting/setSnippet", window.siyuan.config.snippet);
            expect(broadcast).toHaveBeenCalledWith({
                type: "snippet_toggle_global", snippetType: "css", enabled: true, previewingSnippetIds: [],
            });
        });

        it("远程关闭 JS：更新镜像并移除注入元素，不调 API 不广播", async () => {
            const {manager, plugin, broadcast} = setup([makeSnippet("js-1", "js", "console.log(1)", true)]);
            window.siyuan.config.snippet.enabledJS = true;
            await manager.updateSnippetElement(plugin.snippetsList[0]);
            expect(document.getElementById("snippetJSjs-1")).not.toBeNull();
            await manager.globalToggleSnippet("js", false, "remote");
            expect(window.siyuan.config.snippet.enabledJS).toBe(false);
            expect(document.getElementById("snippetJSjs-1")).toBeNull();
            expect(fetchPost).not.toHaveBeenCalled();
            expect(broadcast).not.toHaveBeenCalled();
        });
    });

    describe("applyImportedSnippets 导入后整表应用", () => {
        it("本地导入：Store 整表替换 + 注入新启用片段 + 广播 snippets_import", async () => {
            const {manager, plugin, broadcast} = setup([]);
            window.siyuan.config.snippet.enabledCSS = true;
            const newList = [makeSnippet("imp-1", "css", "body { color: red; }", true, "导入片段")];
            await manager.applyImportedSnippets(newList);
            expect(plugin.snippetStore.replaceAll).toHaveBeenCalledWith(newList);
            expectInjected("imp-1", "css", newList[0].content);
            expect(broadcast).toHaveBeenCalledWith({type: "snippets_import"});
        });

        it("本地导入覆盖：移除已不在列表中的旧注入元素", async () => {
            const {manager, plugin} = setup([]);
            window.siyuan.config.snippet.enabledCSS = true;
            // 预置一个旧片段元素（模拟导入前已注入生效）
            const oldElement = document.createElement("style");
            oldElement.id = "snippetCSSold-1";
            oldElement.textContent = "p {}";
            document.head.appendChild(oldElement);
            const newList = [makeSnippet("imp-1", "css", "body {}")];
            await manager.applyImportedSnippets(newList);
            expect(document.getElementById("snippetCSSold-1")).toBeNull();
            expectInjected("imp-1", "css", "body {}");
            void plugin;
        });

        it("本地导入禁用片段不注入元素", async () => {
            const {manager} = setup([]);
            window.siyuan.config.snippet.enabledCSS = true;
            await manager.applyImportedSnippets([makeSnippet("off-1", "css", "body {}", false)]);
            expect(document.getElementById("snippetCSSoff-1")).toBeNull();
        });

        it("远程导入：自拉权威列表整表应用，不广播", async () => {
            const serverList = [makeSnippet("js-1", "js", "console.log(1)", true, "服务端片段")];
            const {manager, plugin, broadcast} = setup(serverList);
            window.siyuan.config.snippet.enabledJS = true;
            await manager.applyImportedSnippets(undefined, "remote");
            // 自拉结果整表替换 Store
            expect(plugin.snippetStore.replaceAll).toHaveBeenCalledWith(serverList);
            expectInjected("js-1", "js", serverList[0].content);
            expect(broadcast).not.toHaveBeenCalled();
        });

        it("传入列表缺失时报错（本地路径防御）", async () => {
            const {manager, plugin} = setup([]);
            await manager.applyImportedSnippets(undefined);
            expect(plugin.console.error).toHaveBeenCalledWith(
                "applyImportedSnippets: Snippets list is missing"
            );
            expect(plugin.snippetStore.replaceAll).not.toHaveBeenCalled();
        });
    });

    describe("buildSyncHandlers 广播分发", () => {
        it("snippets_import 远程分发：自拉权威列表整表应用且不广播", async () => {
            const serverList = [makeSnippet("css-2", "css", "p {}", true, "导入片段")];
            const {manager, plugin, broadcast} = setup(serverList);
            window.siyuan.config.snippet.enabledCSS = true;
            const handlers = manager.buildSyncHandlers();
            await handlers.snippets_import?.();
            // 自拉结果整表替换 Store 并注入元素
            expect(plugin.snippetStore.replaceAll).toHaveBeenCalledWith(serverList);
            expectInjected("css-2", "css", "p {}");
            expect(broadcast).not.toHaveBeenCalled();
        });

        it("snippet_toggle 远程分发：自拉权威片段后按 remote 切换，不广播", async () => {
            const serverList = [makeSnippet("css-1", "css", "body {}", false)];
            const {manager, plugin, broadcast} = setup(serverList);
            window.siyuan.config.snippet.enabledCSS = true;
            const handlers = manager.buildSyncHandlers();
            await handlers.snippet_toggle?.({snippetId: "css-1", enabled: true});
            // 经自拉更新了 snippetsList 缓存
            expect(plugin.snippetsList[0].enabled).toBe(true);
            expectInjected("css-1", "css", "body {}");
            expect(broadcast).not.toHaveBeenCalled();
        });

        it("snippet_save 广播参数缺失（复制无副本 ID）时记录错误", async () => {
            const {manager, plugin} = setup([]);
            const handlers = manager.buildSyncHandlers();
            await handlers.snippet_save?.({snippetId: "css-1", isCopy: true} as never);
            expect(plugin.console.error).toHaveBeenCalledWith(
                expect.stringContaining("isCopy is missing"),
                expect.anything()
            );
        });
    });

    describe("saveSnippetsList 内核 CSS 安全校验预扫描", () => {
        it("列表含内容违规的 CSS 片段时拒绝保存并列出全部违规片段名", async () => {
            const {manager, plugin} = setup([]);
            const badCss = makeSnippet("bad-1", "css", "<script>alert(1)</script>", true, "违规甲");
            const badCss2 = makeSnippet("bad-2", "css", "p {} </style>", true, "违规乙");
            const goodCss = makeSnippet("ok-1", "css", "body {}");
            await expect(manager.saveSnippetsList([goodCss, badCss, badCss2])).rejects.toThrow("违规甲");
            expect(plugin.showErrorMessage).toHaveBeenCalledWith("CSS 内容违规: 违规甲, 违规乙");
            // 预扫描拒绝后不调用内核落库 API
            expect(fetchPost).not.toHaveBeenCalled();
        });

        it("列表全部合法时正常调用内核落库", async () => {
            const {manager} = setup([]);
            const goodCss = makeSnippet("ok-1", "css", "body {}");
            await expect(manager.saveSnippetsList([goodCss])).resolves.toBeUndefined();
            expect(fetchPost).toHaveBeenCalledWith("/api/snippet/setSnippet", { snippets: [goodCss] }, expect.any(Function));
        });
    });
});
