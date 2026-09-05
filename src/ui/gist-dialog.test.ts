// ui/gist-dialog.ts 对话框装配与交互单测
// 覆盖：导入对话框（拉取渲染 → 勾选 → 按模式导入）、conf 特例渲染、发布对话框
// （无 Token 拦截 / 装配默认勾选 / secret 发布直接执行）。
// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {showMessage} from "siyuan";
import type PluginSnippets from "../index";
import type {GistImportData} from "../services/gist-sync";
import type {Snippet} from "../types";
import {GistDialog} from "./gist-dialog";

/** 供对话框读取的最小 i18n 键集（文本值不影响断言路径） */
const i18n: Record<string, string> = {
    cancel: "取消",
    emptySnippet: "暂无代码片段",
    gistImport: "从 Gist 导入",
    gistImportButton: "从 Gist 导入",
    gistImportUrlPlaceholder: "粘贴链接",
    gistImportFetch: "获取",
    gistImportFetching: "获取中",
    gistImportTokenHint: "提示",
    gistImportInvalidUrl: "无效",
    gistImportModeMerge: "合并",
    gistImportModeOverwrite: "覆盖",
    gistImportModeFork: "新增",
    gistImportEmpty: "空",
    gistImportNoId: "无 ID",
    gistImportNoCheck: "未勾选",
    gistImportFetchFirst: "先获取",
    gistImportActionNew: "新增",
    gistImportActionUpdate: "更新",
    gistImportActionOverwrite: "覆盖",
    gistImportSuccess: "成功新增 ${added} 更新 ${updated}",
    gistImportTruncatedFailed: "超限",
    gistImportConfirm: "导入",
    gistErrorNotFound: "不存在",
    gistErrorUnauthorized: "未授权",
    gistErrorRateLimit: "限流",
    gistErrorNetwork: "网络",
    gistPublish: "发布到 Gist",
    gistPublishButton: "发布",
    gistPublishTokenRequired: "需要 Token",
    gistPublishTooLarge: "过大",
    gistPublishTooMany: "过多",
    gistPublishNoCheck: "未勾选",
    gistPublishInvalidGistId: "无效 id",
    gistPublishFilterAll: "全部",
    gistPublishFilterEnabled: "已启用",
    gistPublishDisabled: "已停用",
    gistPublishSelectedCount: "已勾选 ${count} 个",
    gistPublishSelectAll: "全选",
    gistPublishSelectNone: "取消全选",
    gistPublishFilterEmpty: "筛选无结果",
    gistPublishFilesPreview: "将写入",
    gistPublishTargetNewSecret: "新建 secret",
    gistPublishTargetNewPublic: "新建公开",
    gistPublishTargetUpdateLast: "更新上次",
    gistPublishTargetUpdate: "更新指定",
    gistPublishGistIdPlaceholder: "gist id",
    gistPublishConfirm: "确认",
    gistPublishPublicConfirm: "公开确认",
    gistPublishDeleteConfirm: "删除 ${count}",
    gistPublishSuccess: "已发布 ${url}",
};

const makeSnippet = (id: string, name: string, enabled: boolean, type: "css" | "js" = "css", content = "c"): Snippet => ({id, name, content, type, enabled});

/**
 * 构造替身插件与 GistDialog（对话框相关依赖全部桩化）
 */
const setup = (options: {
    snippets?: Snippet[];
    token?: string;
    importData?: GistImportData;
    modals?: HTMLElement[];
    publishResult?: {gistId: string; html_url: string; public: boolean; files: Record<string, unknown>};
} = {}) => {
    const snippets = options.snippets ?? [makeSnippet("a-20250101000000-aaa", "片段A", true), makeSnippet("b-20250101000001-bbb", "片段B", false)];
    const importData = options.importData;
    const gistSyncService = {
        token: options.token ?? "ghp_xxx",
        loadPublishState: vi.fn(async () => undefined),
        savePublishState: vi.fn(async () => undefined),
        fetchImportData: importData ? vi.fn(async () => importData) : vi.fn(async () => {
            throw new Error("no data");
        }),
        publishToGist: vi.fn(async () => options.publishResult ?? {gistId: "gist-new", html_url: "https://gist.github.com/x/gist-new", public: false, files: {}}),
    };
    const snippetsDialog = {
        getAllModalElements: vi.fn(() => options.modals ?? []),
        closeByElement: vi.fn(),
        openConfirm: vi.fn(),
    };
    const importExportService = {
        importSnippetsFromData: vi.fn(async () => ({addedCount: 1, updatedCount: 1})),
    };
    const plugin = {
        displayName: "Snippets",
        i18n,
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
        showErrorMessage: vi.fn(),
        snippetsList: snippets,
        snippetManager: {refreshSnippetsList: vi.fn(async () => true)},
        menuView: {close: vi.fn()},
        snippetsDialog,
        gistTokenService: {token: options.token ?? "ghp_xxx", hasToken: !!(options.token ?? "ghp_xxx")},
        gistSyncService,
        importExportService,
        addListener: vi.fn((element: HTMLElement, event: string, fn: (event: Event) => void, options?: AddEventListenerOptions) => {
            element.addEventListener(event, fn as EventListener, options);
        }),
        removeListener: vi.fn(),
    } as unknown as PluginSnippets;
    return {dialog: new GistDialog(plugin), plugin, gistSyncService, snippetsDialog, importExportService};
};

/** 点击元素（原生 click：对 radio/checkbox 触发切换默认行为） */
const click = (element: HTMLElement) => {
    element.click();
};

/** 输入元素值并触发 input/change */
const setInputValue = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("change", {bubbles: true}));
};

/** 等待异步链 */
const waitChain = () => new Promise<void>(resolve => setTimeout(resolve, 20));

const GIST_ID = "6cad326836d38bd3a7ae";
const GIST_URL = `https://gist.github.com/octocat/${GIST_ID}`;

const makeImportData = (): GistImportData => ({
    gistId: GIST_ID,
    gistUrl: GIST_URL,
    description: null,
    public: false,
    updatedAt: "2026-01-01T00:00:00Z",
    files: [
        {fileName: "样式 20250101000000-abc1234.css", name: "样式", id: "20250101000000-abc1234", type: "css", content: "body{}", truncated: false, isConf: false},
        {fileName: "README.md", name: "README", type: "css", content: "# hi", truncated: false, isConf: false},
    ],
});

describe("GistDialog.openImport", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.clearAllMocks();
    });

    it("拉取渲染普通文件行：css/js 默认勾选、说明文件不勾选，导入按 merge 传片段", async () => {
        const {dialog, plugin, importExportService} = setup({importData: makeImportData()});
        dialog.openImport();
        await waitChain();

        // 渲染行：两个文件（样式勾选 + README 不勾选）
        const urlInput = document.querySelector("input[data-action='gistUrl']") as HTMLInputElement;
        const fetchButton = document.querySelector("[data-action='gistFetch']") as HTMLElement;
        setInputValue(urlInput, GIST_URL);
        click(fetchButton);
        await waitChain();

        const result = document.querySelector(".jcsm-gist-result") as HTMLElement;
        const checkboxes = Array.from(result.querySelectorAll("input[data-gist-row]")) as HTMLInputElement[];
        expect(checkboxes).toHaveLength(2);
        expect(checkboxes[0].checked).toBe(true);
        expect(checkboxes[1].checked).toBe(false);

        // 点击「导入」
        const importButton = document.querySelector("[data-action='gistImport']") as HTMLElement;
        click(importButton);
        await waitChain();

        expect(importExportService.importSnippetsFromData).toHaveBeenCalledTimes(1);
        const [imported, mode] = (importExportService.importSnippetsFromData as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(mode).toBe("merge");
        expect(imported).toHaveLength(1);
        expect(imported[0]).toMatchObject({id: "20250101000000-abc1234", name: "样式", type: "css", content: "body{}", enabled: false});
        expect(plugin.snippetsDialog.closeByElement).toHaveBeenCalled();
    });

    it("conf 特例按片段逐条渲染且保留原 id/enabled", async () => {
        const confData: GistImportData = {
            gistId: GIST_ID,
            gistUrl: GIST_URL,
            description: null,
            public: false,
            updatedAt: "2026-01-01T00:00:00Z",
            confSnippets: [makeSnippet("conf-1", "片段一", true), makeSnippet("conf-2", "片段二", false, "js")],
            files: [{fileName: "snippets.json", name: "snippets", type: "css", content: "[]", truncated: false, isConf: true}],
        };
        const {dialog} = setup({importData: confData});
        dialog.openImport();
        await waitChain();
        const urlInput = document.querySelector("input[data-action='gistUrl']") as HTMLInputElement;
        const fetchButton = document.querySelector("[data-action='gistFetch']") as HTMLElement;
        setInputValue(urlInput, GIST_ID);
        click(fetchButton);
        await waitChain();

        const result = document.querySelector(".jcsm-gist-result") as HTMLElement;
        const checkboxes = Array.from(result.querySelectorAll("input[data-gist-row]")) as HTMLInputElement[];
        expect(checkboxes).toHaveLength(2);
        expect(checkboxes[0].checked).toBe(true);
    });

    it("来源设置对话框自身不计入模态守卫（能从设置面板按钮打开）", async () => {
        const {dialog, plugin, snippetsDialog} = setup({importData: makeImportData()});
        const settingElement = document.createElement("div");
        // 模拟 getAllModalElements 会把来源设置对话框自身也返回
        (snippetsDialog.getAllModalElements as ReturnType<typeof vi.fn>).mockReturnValue([settingElement]);
        dialog.openImport(settingElement);
        await waitChain();
        // 对话框已打开（包含 URL 输入框），且来源对话框被关闭、菜单被关闭
        expect(document.querySelector("input[data-action='gistUrl']")).not.toBeNull();
        expect(snippetsDialog.closeByElement).toHaveBeenCalledWith(settingElement);
        expect(plugin.menuView.close).toHaveBeenCalled();
        expect(plugin.showErrorMessage).not.toHaveBeenCalled();
    });

    it("存在其它模态对话框（非来源）时仍拒绝打开", async () => {
        const {dialog, plugin, snippetsDialog} = setup({importData: makeImportData()});
        const otherModal = document.createElement("div");
        (snippetsDialog.getAllModalElements as ReturnType<typeof vi.fn>).mockReturnValue([otherModal]);
        dialog.openImport();
        await waitChain();
        expect(document.querySelector("input[data-action='gistUrl']")).toBeNull();
        expect(snippetsDialog.closeByElement).not.toHaveBeenCalled();
        expect(plugin.showErrorMessage).not.toHaveBeenCalled();
    });
});

describe("GistDialog.openPublish", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.clearAllMocks();
    });

    it("未配置 Token：提示且不打开对话框", async () => {
        const {dialog, plugin} = setup({token: ""});
        await dialog.openPublish();
        expect(plugin.showErrorMessage).toHaveBeenCalledWith(i18n.gistPublishTokenRequired);
        expect(document.querySelector(".b3-dialog--open")).toBeNull();
    });

    it("装配：默认勾选已启用片段并显示计数；secret 新建直接发布成功", async () => {
        const {dialog, plugin, gistSyncService} = setup({});
        await dialog.openPublish();
        await waitChain();

        const list = document.querySelector(".jcsm-gist-publish-list") as HTMLElement;
        const checkboxes = Array.from(list.querySelectorAll("input[data-pub-id]")) as HTMLInputElement[];
        expect(checkboxes).toHaveLength(2);
        // 列表位于弹窗正文末尾（目标选项/摘要之前的内容在其上方）
        const content = document.querySelector(".b3-dialog__content") as HTMLElement;
        const listIndex = Array.from(content.children).indexOf(list);
        const targetGroup = content.querySelector("[data-action='gistPublishTarget']");
        const summary = content.querySelector("[data-action='gistPublishSummary']");
        expect(listIndex).toBeGreaterThan(Array.from(content.children).indexOf(targetGroup as HTMLElement));
        expect(listIndex).toBeGreaterThan(Array.from(content.children).indexOf(summary as HTMLElement));
        // gist id 输入框默认隐藏（仅「更新指定 Gist」时显示）
        const gistIdRow = document.querySelector("[data-action='gistPublishGistIdRow']") as HTMLElement;
        const gistIdInput = document.querySelector("input[data-action='gistPublishGistId']") as HTMLInputElement;
        expect(gistIdRow.classList.contains("fn__none")).toBe(true);
        expect(gistIdInput.disabled).toBe(false);
        // 仅已启用片段默认勾选
        const checkedIds = checkboxes.filter(input => input.checked).map(input => input.dataset.pubId);
        expect(checkedIds).toEqual(["a-20250101000000-aaa"]);

        const count = document.querySelector("[data-action='gistPublishCount']") as HTMLElement;
        expect(count.textContent).toContain("1");

        // 默认目标为新建 secret：点击发布直接调用（无二次确认）
        const publishButton = document.querySelector("[data-action='gistPublish']") as HTMLElement;
        click(publishButton);
        await waitChain();

        expect(gistSyncService.publishToGist).toHaveBeenCalledTimes(1);
        const [options] = (gistSyncService.publishToGist as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(options.target).toEqual({kind: "create", publicGist: false});
        expect(options.snippets.map((snippet: Snippet) => snippet.id)).toEqual(["a-20250101000000-aaa"]);
        expect(plugin.snippetsDialog.closeByElement).toHaveBeenCalled();
        expect(showMessage).toHaveBeenCalledWith(expect.stringContaining("gist-new"), 6000, "info");
    });

    it("gist id 输入行仅在选中「更新指定 Gist」时显示", async () => {
        const {dialog} = setup({});
        await dialog.openPublish();
        await waitChain();

        const gistIdRow = document.querySelector("[data-action='gistPublishGistIdRow']") as HTMLElement;
        // 默认新建 secret：输入行隐藏
        expect(gistIdRow.classList.contains("fn__none")).toBe(true);

        // 选中「更新指定 Gist」：输入行显示
        const updateRadio = document.querySelector("input[value='update']") as HTMLInputElement;
        updateRadio.click();
        await waitChain();
        expect(gistIdRow.classList.contains("fn__none")).toBe(false);

        // 切回新建 secret：输入行重新隐藏
        const secretRadio = document.querySelector("input[value='new-secret']") as HTMLInputElement;
        secretRadio.click();
        await waitChain();
        expect(gistIdRow.classList.contains("fn__none")).toBe(true);
    });

    it("全选按钮：初始未全选显示全选，点击后全选可见片段并变取消全选，再点恢复", async () => {
        const {dialog} = setup({});
        await dialog.openPublish();
        await waitChain();

        const list = document.querySelector(".jcsm-gist-publish-list") as HTMLElement;
        const toggleAll = document.querySelector("[data-action='gistPublishToggleAll']") as HTMLElement;
        // 仅已启用片段默认勾选 → 未全选，按钮显示「全选」
        expect(toggleAll.textContent).toBe(i18n.gistPublishSelectAll);

        // 全选：两个可见片段全部勾选，计数 2，按钮变「取消全选」
        click(toggleAll);
        await waitChain();
        const afterSelectAll = Array.from(list.querySelectorAll("input[data-pub-id]")) as HTMLInputElement[];
        expect(afterSelectAll.every(input => input.checked)).toBe(true);
        expect(toggleAll.textContent).toBe(i18n.gistPublishSelectNone);
        expect(document.querySelector("[data-action='gistPublishCount']")?.textContent).toContain("2");

        // 取消全选：计数 0，按钮恢复「全选」
        click(toggleAll);
        await waitChain();
        const afterSelectNone = Array.from(list.querySelectorAll("input[data-pub-id]")) as HTMLInputElement[];
        expect(afterSelectNone.every(input => !input.checked)).toBe(true);
        expect(toggleAll.textContent).toBe(i18n.gistPublishSelectAll);
        expect(document.querySelector("[data-action='gistPublishCount']")?.textContent).toContain("0");
    });

    it("全选作用于当前筛选：JS 筛选下只全选 JS 片段，不影响 CSS 片段", async () => {
        const {dialog} = setup({
            snippets: [
                makeSnippet("a-20250101000000-aaa", "片段A", false, "css"),
                makeSnippet("b-20250101000001-bbb", "片段B", false, "js"),
            ],
        });
        await dialog.openPublish();
        await waitChain();

        // 默认两个片段：a 为 css、b 为 js
        const filterSelect = document.querySelector("select[data-action='gistPublishFilter']") as HTMLSelectElement;
        const list = document.querySelector(".jcsm-gist-publish-list") as HTMLElement;
        const toggleAll = document.querySelector("[data-action='gistPublishToggleAll']") as HTMLElement;

        // 切到 JS 筛选
        filterSelect.value = "js";
        filterSelect.dispatchEvent(new Event("change", {bubbles: true}));
        await waitChain();
        expect(Array.from(list.querySelectorAll("input[data-pub-id]"))).toHaveLength(1);

        // 全选 JS 片段
        click(toggleAll);
        await waitChain();
        expect((list.querySelector("input[data-pub-id]") as HTMLInputElement).checked).toBe(true);

        // 切回全部：CSS 片段仍未被勾选（全选只作用于当时的 JS 筛选结果）
        filterSelect.value = "all";
        filterSelect.dispatchEvent(new Event("change", {bubbles: true}));
        await waitChain();
        const checkboxes = Array.from(list.querySelectorAll("input[data-pub-id]")) as HTMLInputElement[];
        const byId = Object.fromEntries(checkboxes.map(input => [input.dataset.pubId, input.checked]));
        expect(byId["a-20250101000000-aaa"]).toBe(false); // CSS 片段未受影响
        expect(byId["b-20250101000001-bbb"]).toBe(true);   // JS 片段保持勾选
    });

    it("公开新建：需要二次确认（openConfirm）后才发布", async () => {
        const {dialog, plugin, gistSyncService} = setup({});
        await dialog.openPublish();
        await waitChain();

        const publicRadio = document.querySelector("input[value='new-public']") as HTMLInputElement;
        click(publicRadio);
        const publishButton = document.querySelector("[data-action='gistPublish']") as HTMLElement;
        click(publishButton);
        await waitChain();

        // 触发确认框而未直接发布
        expect(plugin.snippetsDialog.openConfirm).toHaveBeenCalled();
        expect(gistSyncService.publishToGist).not.toHaveBeenCalled();
        // 触发确认回调后发布
        const confirmCallback = (plugin.snippetsDialog.openConfirm as ReturnType<typeof vi.fn>).mock.calls[0][5] as () => void;
        confirmCallback();
        await waitChain();
        const [options] = (gistSyncService.publishToGist as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(options.target).toEqual({kind: "create", publicGist: true});
    });

    it("来源设置对话框自身不计入模态守卫（能从设置面板按钮打开）", async () => {
        const {dialog, plugin, snippetsDialog} = setup({});
        const settingElement = document.createElement("div");
        (snippetsDialog.getAllModalElements as ReturnType<typeof vi.fn>).mockReturnValue([settingElement]);
        await dialog.openPublish(settingElement);
        await waitChain();
        expect(document.querySelector("[data-action='gistPublish']")).not.toBeNull();
        expect(snippetsDialog.closeByElement).toHaveBeenCalledWith(settingElement);
        expect(plugin.menuView.close).toHaveBeenCalled();
    });

    it("存在其它模态对话框（非来源）时仍拒绝打开", async () => {
        const {dialog, snippetsDialog} = setup({});
        const otherModal = document.createElement("div");
        (snippetsDialog.getAllModalElements as ReturnType<typeof vi.fn>).mockReturnValue([otherModal]);
        await dialog.openPublish();
        await waitChain();
        expect(document.querySelector("[data-action='gistPublish']")).toBeNull();
        expect(snippetsDialog.closeByElement).not.toHaveBeenCalled();
    });
});
