// ui/menu-groups.ts SnippetsMenu 分组视图单测（不打开完整菜单 open 流）
// 覆盖：isGroupedView、genGroupedMenuHtml（组头/组内成员顺序/未分组兜底/名称转义/折叠态）、
//       分组 CRUD（新建/重命名/删除组并入未分组）与 store.save 落盘、折叠状态持久化。
// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type PluginSnippets from "../index";
import {SnippetsConfig} from "../config/config";
import type {Snippet, SnippetType} from "../types";
import type {SnippetGroup} from "../domain/snippet-groups";
import {SnippetsMenu} from "./menu";

/** 构造启用分组视图的 SnippetsMenu 替身插件 */
const createGroupedPlugin = (groups: SnippetGroup[], snippetsList: Snippet[]) => {
    const store = {
        groups,
        load: vi.fn(async () => undefined),
        save: vi.fn(async () => undefined),
    };
    const openPrompt = vi.fn();
    const openConfirm = vi.fn();
    // 视图偏好存储替身（折叠 map + 落库回调）
    const uiStorage = {
        groupCollapsed: {} as Record<string, boolean>,
        snippetsType: undefined as SnippetType | undefined,
        load: vi.fn(async () => undefined),
        saveGroupCollapsed: vi.fn(async () => undefined),
        saveSnippetsType: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
    };
    const plugin = {
        isMobile: false,
        isReloadUIRequired: false,
        snippetsList,
        snippetsType: "css" as SnippetType,
        config: new SnippetsConfig(),
        uiStorage,
        i18n: {
            add: "添加",
            emptySnippet: "空片段",
            snippetDisabledInPublish: "发布显示",
            groupNew: "新建分组",
            groupRename: "重命名",
            groupDelete: "删除分组",
            groupUngrouped: "未分组",
            groupEmptyName: "未命名分组",
            groupNamePlaceholder: "输入分组名",
            groupNewTitle: "新建分组",
            groupRenameTitle: "重命名分组",
            groupDeleteDescription: "确定删除分组“${x}”吗？组内代码片段将移至未分组",
            groupNameRequired: "分组名不能为空",
            delete: "删除",
            addFirstCSSSnippet: "添加第一个 CSS 代码片段",
            addFirstJSSnippet: "添加第一个 JS 代码片段",
        },
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
        showErrorMessage: vi.fn(),
        showNotification: vi.fn(),
        snippetGroupStore: store,
        snippetManager: {getSnippetById: vi.fn(), refreshSnippetsList: vi.fn(async () => true), saveSnippetsList: vi.fn(async () => undefined)},
        snippetsDialog: {getAllModalElements: vi.fn(() => []), openPrompt, openConfirm},
        addListener: vi.fn(),
        removeListener: vi.fn(),
    } as unknown as PluginSnippets;
    return {plugin, store, openPrompt, openConfirm, uiStorage};
};

/** 注入 window.siyuan.config 运行态（isShowPublishCheckbox 读取）与 Lute（新建分组 id 生成） */
const stubRuntime = () => {
    (window as unknown as {siyuan: {config: {publish: {enable: boolean}; snippet: {enabledCSS: boolean; enabledJS: boolean}}}}).siyuan = {
        config: {publish: {enable: false}, snippet: {enabledCSS: true, enabledJS: true}},
    };
    (window as unknown as {Lute: {NewNodeID: () => string}}).Lute = {NewNodeID: () => "20260905120000-groupid"};
};

const makeSnippet = (id: string, type: SnippetType, name = id): Snippet =>
    ({id, name, type, content: "content", enabled: true});

/** 解析分组 HTML 为元素，便于 DOM 断言 */
const parseHtml = (html: string): HTMLElement => {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
};

describe("SnippetsMenu 分组视图", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        localStorage.clear();
        stubRuntime();
    });

    afterEach(() => {
        document.body.innerHTML = "";
        localStorage.clear();
    });

    it("isGroupedView 由是否存在分组决定（无分组即平铺）", () => {
        const {plugin} = createGroupedPlugin([], []);
        const menu = new SnippetsMenu(plugin);
        expect(menu.isGroupedView()).toBe(false);
        // 加入首个分组后进入分组视图
        plugin.snippetGroupStore.groups = [{id: "g1", type: "css", name: "样式组", snippetIds: []}];
        expect(menu.isGroupedView()).toBe(true);
    });

    it("genGroupedMenuHtml 输出组头 + 组内成员（按 snippetIds 序）+ 未分组兜底", () => {
        const cssInGroup = makeSnippet("c1", "css", "组内CSS");
        const ungroupedCss = makeSnippet("c2", "css", "散装CSS");
        const jsMember = makeSnippet("j1", "js", "JS片段");
        const groups: SnippetGroup[] = [
            {id: "g1", type: "css", name: "样式组", snippetIds: ["c1"]},
            {id: "g2", type: "js", name: "JS组", snippetIds: ["j1"]},
        ];
        const {plugin} = createGroupedPlugin(groups, [cssInGroup, ungroupedCss, jsMember]);
        const menu = new SnippetsMenu(plugin);

        const html = menu.genGroupedMenuHtml();
        // CSS 组头与成员
        expect(html).toContain("data-group-id=\"g1\"");
        expect(html).toContain("样式组");
        expect(html).toContain("data-id=\"c1\"");
        // 组内片段出现在组名之后（组内按 snippetIds 序输出）
        expect(html.indexOf("样式组")).toBeLessThan(html.indexOf("data-id=\"c1\""));
        // 未分组兜底收纳 c2
        expect(html).toContain("未分组");
        expect(html).toContain("data-id=\"c2\"");
        // JS 分区独立分组
        expect(html).toContain("data-group-id=\"g2\"");
        expect(html).toContain("data-snippet-type=\"js\"");
    });

    it("某类型无用户分组时不渲染“未分组”标题，其片段平铺显示", () => {
        // 仅 CSS 有用户分组；JS 尚无分组
        const groups: SnippetGroup[] = [{id: "g1", type: "css", name: "样式组", snippetIds: []}];
        const {plugin} = createGroupedPlugin(groups, [makeSnippet("c1", "css"), makeSnippet("j1", "js")]);
        const menu = new SnippetsMenu(plugin);

        const html = menu.genGroupedMenuHtml();
        // CSS 有用户分组 → 显示“未分组”；JS 无用户分组 → 不显示“未分组”，但 JS 片段照常平铺出现
        const container = parseHtml(html);
        expect(container.querySelector(".jcsm-snippet-item[data-id=\"j1\"]")).toBeTruthy();
        // 未分组区段只有一个（属于 CSS），JS 无未分组区段
        const ungroupedSections = container.querySelectorAll(".jcsm-group-section[data-ungrouped=\"true\"]");
        expect(ungroupedSections.length).toBe(1);
        expect((ungroupedSections[0] as HTMLElement).dataset.snippetType).toBe("css");
        // JS 片段不在任何分组区段内（平铺）
        expect(container.querySelector(".jcsm-group-section[data-snippet-type=\"js\"]")).toBeNull();
        expect(container.querySelector(".jcsm-snippet-item[data-id=\"c1\"]")).toBeTruthy();
    });

    it("组名与片段名经转义（防 XSS）", () => {
        const groups: SnippetGroup[] = [
            {id: "g1", type: "css", name: "<img src=x onerror=alert(1)>", snippetIds: []},
        ];
        const {plugin} = createGroupedPlugin(groups, []);
        const menu = new SnippetsMenu(plugin);
        const html = menu.genGroupedMenuHtml();
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
    });

    it("外部数据变更后重建菜单：删除最后一个分组时不被 isGroupedView 拦截（回退平铺）", () => {
        // 场景：其他实例删除了最后一个分组 → 本实例收到 storage 推送后分组缓存为空
        const {plugin} = createGroupedPlugin([], [makeSnippet("c1", "css")]);
        const menu = new SnippetsMenu(plugin);
        // 模拟菜单已打开：预置带旧分组界面的容器
        const menuItemsEl = document.createElement("div");
        menuItemsEl.innerHTML = '<div class="jcsm-snippets-container jcsm-grouped"><section class="jcsm-group-section" data-group-id="g1"></section></div>';
        menu.menuItems = menuItemsEl;

        expect(menu.isGroupedView()).toBe(false);
        menu.refreshSnippetsContainerAfterExternalChange();

        const container = menuItemsEl.querySelector(".jcsm-snippets-container") as HTMLElement;
        // 已重建为平铺：不再带 jcsm-grouped，也无残留的旧分组区段
        expect(container.classList.contains("jcsm-grouped")).toBe(false);
        expect(menuItemsEl.querySelector(".jcsm-group-section")).toBeNull();
        expect(container.querySelector(".jcsm-snippet-item[data-id=\"c1\"]")).toBeTruthy();
    });

    it("外部数据变更后重建菜单：菜单未打开（menuItems 缺省）时安全早退", () => {
        const {plugin} = createGroupedPlugin([{id: "g1", type: "css", name: "样式组", snippetIds: []}], []);
        const menu = new SnippetsMenu(plugin);
        menu.menuItems = undefined as unknown as HTMLElement;
        expect(() => menu.refreshSnippetsContainerAfterExternalChange()).not.toThrow();
    });

    it("折叠状态按 uiStorage map 渲染 jcsm-collapsed 且成员仍在结构内", () => {
        const member = makeSnippet("c1", "css", "样式");
        const groups: SnippetGroup[] = [{id: "g1", type: "css", name: "样式组", snippetIds: ["c1"]}];
        const {plugin} = createGroupedPlugin(groups, [member]);
        plugin.uiStorage.groupCollapsed["css.g1"] = true;
        const menu = new SnippetsMenu(plugin);

        const section = parseHtml(menu.genGroupedMenuHtml()).querySelector(".jcsm-group-section[data-group-id=\"g1\"]") as HTMLElement;
        expect(section).toBeTruthy();
        expect(section.classList.contains("jcsm-collapsed")).toBe(true);
        // 成员仍存在于 DOM（折叠由 CSS 隐藏），data-id 可定位
        expect(section.querySelector(".jcsm-snippet-item[data-id=\"c1\"]")).toBeTruthy();
    });

    it("toggleGroupSectionCollapsed 切换折叠并写入 uiStorage map", () => {
        const {plugin, uiStorage} = createGroupedPlugin([], []);
        const menu = new SnippetsMenu(plugin) as unknown as {toggleGroupSectionCollapsed: (section: HTMLElement) => void};
        const section = parseHtml('<section class="jcsm-group-section" data-snippet-type="css" data-group-id="g1"></section>').querySelector(".jcsm-group-section") as HTMLElement;
        menu.toggleGroupSectionCollapsed(section);
        expect(section.classList.contains("jcsm-collapsed")).toBe(true);
        expect(plugin.uiStorage.groupCollapsed["css.g1"]).toBe(true);
        expect(uiStorage.saveGroupCollapsed).toHaveBeenCalledWith({ "css.g1": true });
        menu.toggleGroupSectionCollapsed(section);
        expect(section.classList.contains("jcsm-collapsed")).toBe(false);
        expect(plugin.uiStorage.groupCollapsed["css.g1"]).toBeUndefined();
        expect(uiStorage.saveGroupCollapsed).toHaveBeenLastCalledWith({});
    });

    it("组头不带 b3-menu__item 类（避免 current 高亮与菜单项样式干扰）", () => {
        const groups: SnippetGroup[] = [{id: "g1", type: "css", name: "样式组", snippetIds: ["c1"]}];
        const {plugin} = createGroupedPlugin(groups, [makeSnippet("c1", "css")]);
        const menu = new SnippetsMenu(plugin);
        const html = menu.genGroupedMenuHtml();
        const header = parseHtml(html).querySelector(".jcsm-group-header[data-group-id=\"g1\"]") as HTMLElement;
        expect(header).toBeTruthy();
        expect(header.classList.contains("b3-menu__item")).toBe(false);
        // 真实分组里的片段项仍保留 b3-menu__item
        expect(html).toContain("jcsm-snippet-item b3-menu__item");
    });

    it("方向键定位折叠组内片段前展开该组（expandSectionForItem）", () => {
        const {plugin, uiStorage} = createGroupedPlugin([], []);
        plugin.uiStorage.groupCollapsed["css.g1"] = true;
        const menu = new SnippetsMenu(plugin) as unknown as {expandSectionForItem: (item: HTMLElement) => void};
        const section = parseHtml(
            '<section class="jcsm-group-section jcsm-collapsed" data-snippet-type="css" data-group-id="g1"><div class="jcsm-snippet-item" data-id="c1"></div></section>'
        ).querySelector(".jcsm-group-section") as HTMLElement;
        const item = section.querySelector(".jcsm-snippet-item") as HTMLElement;

        menu.expandSectionForItem(item);
        expect(section.classList.contains("jcsm-collapsed")).toBe(false);
        expect(plugin.uiStorage.groupCollapsed["css.g1"]).toBeUndefined();
        expect(uiStorage.saveGroupCollapsed).toHaveBeenCalled();
    });

    it("expandSectionForItem 对已展开分组不改变状态", () => {
        const {plugin, uiStorage} = createGroupedPlugin([], []);
        const menu = new SnippetsMenu(plugin) as unknown as {expandSectionForItem: (item: HTMLElement) => void};
        const section = parseHtml(
            '<section class="jcsm-group-section" data-snippet-type="css" data-group-id="g1"><div class="jcsm-snippet-item" data-id="c1"></div></section>'
        ).querySelector(".jcsm-group-section") as HTMLElement;
        const item = section.querySelector(".jcsm-snippet-item") as HTMLElement;
        menu.expandSectionForItem(item);
        expect(section.classList.contains("jcsm-collapsed")).toBe(false);
        expect(plugin.uiStorage.groupCollapsed["css.g1"]).toBeUndefined();
        expect(uiStorage.saveGroupCollapsed).not.toHaveBeenCalled();
    });

    it("新建分组：openPrompt 收集名称后 addGroup 追加真实组并 save（含未分组占位）", () => {
        const {plugin, store, openPrompt} = createGroupedPlugin([], []);
        const menu = new SnippetsMenu(plugin);

        menu.addGroup();
        // 捕获确认回调并输入名称
        const confirmCb = openPrompt.mock.calls[0][3] as (value: string) => void;
        confirmCb("主题组");
        // commitGroups 经 withUngroupedAnchors 补齐未分组占位（id=default）
        expect(store.groups).toHaveLength(2);
        expect(store.groups[0].name).toBe("主题组");
        expect(store.groups[0].type).toBe("css");
        expect(store.groups[1].id).toBe("default");
        expect(store.groups[1].snippetIds).toEqual([]);
        expect(store.save).toHaveBeenCalledTimes(1);
    });

    it("新建分组空名弹错误提示不落盘", () => {
        const {plugin, store, openPrompt} = createGroupedPlugin([], []);
        const menu = new SnippetsMenu(plugin);

        menu.addGroup();
        const confirmCb = openPrompt.mock.calls[0][3] as (value: string) => void;
        confirmCb("   ");
        expect(plugin.showErrorMessage).toHaveBeenCalled();
        expect(store.groups).toHaveLength(0);
        expect(store.save).not.toHaveBeenCalled();
    });

    it("重命名分组：openPrompt 预填当前名并 renameGroup 后 save", () => {
        const {plugin, store, openPrompt} = createGroupedPlugin([{id: "g1", type: "css", name: "旧名", snippetIds: []}], []);
        const menu = new SnippetsMenu(plugin);

        menu.renameGroup("g1");
        expect(openPrompt.mock.calls[0][2]).toBe("旧名"); // 预填当前名称
        const confirmCb = openPrompt.mock.calls[0][3] as (value: string) => void;
        confirmCb("新名");
        expect(store.groups[0].name).toBe("新名");
        expect(store.save).toHaveBeenCalledTimes(1);
    });

    it("删除分组：二次确认后移除组且保留组内片段（不删片段本身）", () => {
        const {plugin, store, openConfirm} = createGroupedPlugin(
            [{id: "g1", type: "css", name: "样式组", snippetIds: ["c1"]}],
            [makeSnippet("c1", "css")]
        );
        const menu = new SnippetsMenu(plugin);

        menu.deleteGroup("g1");
        const confirmCb = openConfirm.mock.calls[0][5] as () => void;
        confirmCb();
        expect(store.groups).toHaveLength(0); // 分组已删
        // 片段仍保留（分组文件不含片段本体，仅移出引用；snippetsList 未被触碰）
        expect(plugin.snippetsList).toHaveLength(1);
        expect(store.save).toHaveBeenCalledTimes(1);
    });

    it("删除分组时清理该分组的折叠持久化状态", () => {
        const {plugin, uiStorage, openConfirm} = createGroupedPlugin(
            [{id: "g1", type: "css", name: "样式组", snippetIds: []}],
            []
        );
        // 预置折叠态（折叠键 "<type>.<groupId>"）
        plugin.uiStorage.groupCollapsed = { "css.g1": true, "js.other": true };
        const menu = new SnippetsMenu(plugin);

        menu.deleteGroup("g1");
        const confirmCb = openConfirm.mock.calls[0][5] as () => void;
        confirmCb();
        // g1 的折叠键被移除，其它组/未分组不受影响；并落库
        expect(plugin.uiStorage.groupCollapsed["css.g1"]).toBeUndefined();
        expect(plugin.uiStorage.groupCollapsed["js.other"]).toBe(true);
        expect(uiStorage.saveGroupCollapsed).toHaveBeenCalledWith({ "js.other": true });
    });

    describe("分组视图 initSnippetsContainer 的“添加第一个”空态入口", () => {
        const mountContainer = (menu: SnippetsMenu) => {
            // initSnippetsContainer 读写 SnippetsMenu.menuItems（容器内先放一个旧容器供其移除）
            const menuItemsEl = document.createElement("div");
            menuItemsEl.appendChild(document.createElement("div"));
            menu.menuItems = menuItemsEl;
            return menuItemsEl;
        };

        it("存在 CSS 片段时不追加“添加第一个 CSS 代码片段”入口", () => {
            const {plugin} = createGroupedPlugin(
                [{id: "g1", type: "css", name: "样式组", snippetIds: ["c1"]}],
                [makeSnippet("c1", "css")]
            );
            const menu = new SnippetsMenu(plugin);
            const menuItemsEl = mountContainer(menu);

            menu.initSnippetsContainer();
            const container = menuItemsEl.querySelector(".jcsm-snippets-container") as HTMLElement;
            // CSS 已有片段：不显示其空态入口；JS 无片段：仍显示 JS 空态入口
            expect(container.querySelector("[data-snippet-type=\"css\"][data-type=\"new\"]")).toBeNull();
            expect(container.querySelector("[data-snippet-type=\"js\"][data-type=\"new\"]")).toBeTruthy();
        });

        it("存在 JS 片段时不追加“添加第一个 JS 代码片段”入口", () => {
            // 需要一个分组使菜单进入分组模式（此处用空的 CSS 分组），JS 片段则在 JS 未分组区段
            const {plugin} = createGroupedPlugin(
                [{id: "g1", type: "css", name: "样式组", snippetIds: []}],
                [makeSnippet("j1", "js")]
            );
            const menu = new SnippetsMenu(plugin);
            const menuItemsEl = mountContainer(menu);

            menu.initSnippetsContainer();
            const container = menuItemsEl.querySelector(".jcsm-snippets-container") as HTMLElement;
            expect(container.querySelector("[data-snippet-type=\"js\"][data-type=\"new\"]")).toBeNull();
            expect(container.querySelector("[data-snippet-type=\"css\"][data-type=\"new\"]")).toBeTruthy();
        });

        it("某类型完全无片段时仍显示其空态入口", () => {
            // 有一个空 CSS 分组使菜单进入分组模式，但两种类型都还没有任何片段
            const {plugin} = createGroupedPlugin(
                [{id: "g1", type: "css", name: "样式组", snippetIds: []}],
                []
            );
            const menu = new SnippetsMenu(plugin);
            const menuItemsEl = mountContainer(menu);

            menu.initSnippetsContainer();
            const container = menuItemsEl.querySelector(".jcsm-snippets-container") as HTMLElement;
            expect(container.querySelector("[data-snippet-type=\"css\"][data-type=\"new\"]")).toBeTruthy();
            expect(container.querySelector("[data-snippet-type=\"js\"][data-type=\"new\"]")).toBeTruthy();
        });
    });
});
