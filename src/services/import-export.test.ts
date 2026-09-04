// services/import-export.ts ImportExportService 单测
// 覆盖：exportSnippetsToFile 全流（读取失败/导出失败/重命名失败/成功下载）、
//       importSnippets 的 json 追加/覆盖（含备份）与 zip 解压链路、
//       非法 JSON/格式校验失败/空文件的错误提示。
// 文件输入经创建 <input type=file> 并派发 change 事件驱动；底层 API 经 siyuan fetchPost mock 分发。
// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fetchPost, saveExportFile, showMessage} from "siyuan";
import type PluginSnippets from "../index";
import type {Snippet} from "../types";
import {ImportExportService} from "./import-export";

/**
 * 构造导入导出替身插件
 * @param serverSnippets 当前工作空间片段列表（getSnippetsList 返回）
 */
const setup = (serverSnippets: Snippet[] = []) => {
    const plugin = {
        snippetsList: [...serverSnippets],
        displayName: "Snippets",
        i18n: {
            snippet: "代码片段",
            getSnippetsListFailed: "获取代码片段列表失败",
            uploadImportFileFailed: "上传导入文件失败",
            unzipFailed: "解压失败",
            noValidJsonFileFound: "未找到有效 JSON",
            readUnzippedJsonFileFailed: "读取解压 JSON 失败",
            importFileContentEmpty: "导入文件为空",
            importFileNotValidJson: "不是有效的 JSON",
            importSnippetsInvalidFormat: "导入格式无效",
            importSnippetsFailed: "导入失败",
            importSnippetsOverwriteSuccess: "覆盖成功",
            importSnippetsAppendSuccess: "追加成功",
            backupCreateFailed: "备份失败",
            exportSnippetsFailed: "导出失败",
        },
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
        showErrorMessage: vi.fn(),
        snippetManager: {
            getSnippetsList: vi.fn(async () => [...serverSnippets]),
            saveSnippetsList: vi.fn(async () => undefined),
            applyImportedSnippets: vi.fn(async () => undefined),
        },
        snippetStore: {replaceAll: vi.fn()},
        menuView: {menu: undefined, setMenuSnippetsType: vi.fn()},
    } as unknown as PluginSnippets;

    const service = new ImportExportService(plugin);
    return {service, plugin};
};

/** 等待异步链路完成（FileReader/多级 await） */
const waitChain = () => new Promise<void>(resolve => setTimeout(resolve, 30));

/** 以文件触发 file input 的 change 事件 */
const triggerFileChange = async (input: HTMLInputElement, file: File) => {
    Object.defineProperty(input, "files", {value: [file], configurable: true});
    input.dispatchEvent(new Event("change"));
    await waitChain();
};

describe("ImportExportService", () => {
    let fetchPostMock: ReturnType<typeof vi.mocked<typeof fetchPost>>;

    /** 配置 fetchPost 分发器（getFile 内容 / 各 API 响应可配置） */
    const setFetchMock = (options: {
        confContent?: unknown;
        exportResp?: {code: number; msg?: string; data?: {path: string}};
        renameResp?: {code: number; msg?: string};
        readDirEntries?: Array<{name: string; isDir: boolean; path: string}>;
        zipContent?: unknown;
    }) => {
        fetchPostMock.mockImplementation((url: string, body: unknown = {}, callback?: (r: unknown) => void) => {
            switch (url) {
                case "/api/file/getFile": {
                    const path = (body as {path: string}).path;
                    if (path === "data/snippets/conf.json") {
                        callback?.(options.confContent as unknown);
                    } else if (options.zipContent !== undefined) {
                        callback?.(options.zipContent as unknown);
                    } else {
                        callback?.(undefined);
                    }
                    return undefined;
                }
                case "/api/file/renameFile":
                    callback?.(options.renameResp ?? {code: 0});
                    return undefined;
                case "/api/export/exportResources":
                    callback?.(options.exportResp ?? {code: 0, data: {path: "temp/export/abc.json.zip"}});
                    return undefined;
                case "/api/archive/unzip":
                    callback?.({code: 0});
                    return undefined;
                case "/api/file/readDir":
                    callback?.({code: 0, data: options.readDirEntries ?? []});
                    return undefined;
                case "/api/file/putFile":
                    callback?.({code: 0});
                    return undefined;
                default:
                    callback?.({code: 0});
                    return undefined;
            }
        });
    };

    const inputOf = () => document.querySelector("input[type='file']") as HTMLInputElement;

    beforeEach(() => {
        document.body.innerHTML = "";
        fetchPostMock = vi.mocked(fetchPost);
        fetchPostMock.mockClear();
        vi.mocked(saveExportFile).mockClear();
        vi.mocked(showMessage).mockClear();
        (window as unknown as {Lute: {NewNodeID: () => string}}).Lute = {NewNodeID: () => "newid"};
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("exportSnippetsToFile", () => {
        it("读取 conf.json 失败时提示获取失败", async () => {
            const {service, plugin} = setup();
            setFetchMock({confContent: undefined});
            await service.exportSnippetsToFile();
            expect(plugin.showErrorMessage).toHaveBeenCalledWith("获取代码片段列表失败");
        });

        it("exportResources 返回非 0 时提示导出失败", async () => {
            const {service, plugin} = setup();
            setFetchMock({confContent: "[]", exportResp: {code: 1, msg: "boom"}});
            await service.exportSnippetsToFile();
            expect(plugin.showErrorMessage).toHaveBeenCalledWith("Export failed: boom");
            expect(plugin.console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to export resources"), expect.anything());
        });

        it("成功导出：重命名干净文件名并下载", async () => {
            const {service} = setup();
            setFetchMock({confContent: "[]"});
            await service.exportSnippetsToFile();
            expect(saveExportFile).toHaveBeenCalledTimes(1);
            const [downloadUrl] = vi.mocked(saveExportFile).mock.calls[0];
            expect(downloadUrl).toMatch(/^\/export\/.+/);
            expect(downloadUrl).toContain(".json.zip");
            // 重命名后的干净文件名不含随机前缀（zip 文件与导出名同基名）
            expect(downloadUrl).not.toContain("-代码片段");
        });

        it("重命名失败时抛出并被捕获提示", async () => {
            const {service, plugin} = setup();
            setFetchMock({confContent: "[]", renameResp: {code: 1, msg: "denied"}});
            await service.exportSnippetsToFile();
            expect(plugin.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("导出失败"));
            expect(saveExportFile).not.toHaveBeenCalled();
        });
    });

    describe("importSnippets json 追加/覆盖", () => {
        const importedJson = JSON.stringify([{
            id: "imp-1", name: "导入片段", content: "body {}", type: "css", enabled: true,
        }]);

        it("追加模式：导入片段置于现有片段之前并整表替换", async () => {
            const server = [{id: "s-1", name: "原有", content: "p {}", type: "css", enabled: true}] as Snippet[];
            const {service, plugin} = setup(server);
            setFetchMock({});
            const promise = service.importSnippets(false);
            const input = inputOf();
            await triggerFileChange(input, new File([importedJson], "snippets.json", {type: "application/json"}));
            await promise;

            const newList = vi.mocked(plugin.snippetManager.applyImportedSnippets).mock.calls[0][0] as Snippet[];
            expect(newList.map(s => s.id)).toEqual(["imp-1", "s-1"]);
            expect(plugin.snippetManager.saveSnippetsList).toHaveBeenCalledWith(newList);
            expect(showMessage).toHaveBeenCalledWith("Snippets: 追加成功", 3000, "info");
            // 追加模式不创建备份
            expect(fetchPostMock.mock.calls.filter(([u]) => u === "/api/file/putFile")).toHaveLength(0);
        });

        it("覆盖模式：先备份现有片段再整表替换为导入片段", async () => {
            const server = [{id: "s-1", name: "原有", content: "p {}", type: "css", enabled: true}] as Snippet[];
            const {service, plugin} = setup(server);
            setFetchMock({});
            const promise = service.importSnippets(true);
            await triggerFileChange(inputOf(), new File([importedJson], "snippets.json"));
            await promise;

            const newList = vi.mocked(plugin.snippetManager.applyImportedSnippets).mock.calls[0][0] as Snippet[];
            expect(newList.map(s => s.id)).toEqual(["imp-1"]);
            // 备份写入 /temp/plugin-snippets/
            const putCalls = fetchPostMock.mock.calls.filter(([u]) => u === "/api/file/putFile");
            expect(putCalls).toHaveLength(1);
            const backupForm = putCalls[0][1] as FormData;
            expect((backupForm.get("path") as string)).toMatch(/^\/temp\/plugin-snippets\/snippets_backup_.*\.json$/);
            expect(showMessage).toHaveBeenCalledWith("Snippets: 覆盖成功", 3000, "info");
        });

        it("导入内容不是有效 JSON 时提示", async () => {
            const {service, plugin} = setup();
            setFetchMock({});
            const promise = service.importSnippets(false);
            await triggerFileChange(inputOf(), new File(["not-json{{{"], "bad.json"));
            await promise;
            expect(plugin.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("不是有效的 JSON"));
        });

        it("导入格式非法（非数组）时提示格式错误", async () => {
            const {service, plugin} = setup();
            setFetchMock({});
            const promise = service.importSnippets(false);
            await triggerFileChange(inputOf(), new File(['{"a":1}'], "obj.json"));
            await promise;
            expect(plugin.showErrorMessage).toHaveBeenCalledWith("导入格式无效");
        });

        it("导入格式非法（片段缺必填字段）时提示格式错误", async () => {
            const {service, plugin} = setup();
            setFetchMock({});
            const promise = service.importSnippets(false);
            await triggerFileChange(inputOf(), new File([JSON.stringify([{id: "x", name: "缺字段"}])], "bad.json"));
            await promise;
            expect(plugin.showErrorMessage).toHaveBeenCalledWith("导入格式无效");
        });

        it("导入片段缺少 id 或与现有冲突时重新生成不冲突 ID", async () => {
            const server = [{id: "s-1", name: "原有", content: "p {}", type: "css", enabled: true}] as Snippet[];
            const {service, plugin} = setup(server);
            setFetchMock({});
            const genId = vi.fn()
                .mockReturnValueOnce("s-1")   // 片段1 冲突：生成 s-1 仍与现有重复
                .mockReturnValueOnce("gen-2") // 片段1 重生成成功
                .mockReturnValueOnce("gen-3"); // 片段2 缺 id 直接生成
            (window as unknown as {Lute: {NewNodeID: () => string}}).Lute = {NewNodeID: genId};

            const promise = service.importSnippets(false);
            const data = JSON.stringify([
                {id: "s-1", name: "冲突", content: "a {}", type: "css", enabled: true}, // id 与现有冲突 → 重生成
                {name: "无id", content: "b {}", type: "js", enabled: true},             // 缺 id → 重生成
            ]);
            await triggerFileChange(inputOf(), new File([data], "s.json"));
            await promise;

            const newList = vi.mocked(plugin.snippetManager.applyImportedSnippets).mock.calls[0][0] as Snippet[];
            // 追加模式：导入的两条（重生成后）在前，现有片段在后
            expect(newList.map(s => s.id)).toEqual(["gen-2", "gen-3", "s-1"]);
            // 重生成后不与现有/彼此重复
            const importedIds = newList.slice(0, 2).map(s => s.id);
            expect(new Set(importedIds).size).toBe(2);
        });
    });

    describe("importSnippets zip 链路", () => {
        it("zip 上传解压后递归定位 JSON 并导入", async () => {
            const server = [{id: "s-1", name: "原有", content: "p {}", type: "css", enabled: true}] as Snippet[];
            const {service, plugin} = setup(server);
            const zipDirList = [{name: "sub", isDir: true, path: "temp/export/import-x/sub"}];
            const subDirList = [{name: "conf.json", isDir: false, path: "temp/export/import-x/sub/conf.json"}];
            let dirCalls = 0;
            fetchPostMock.mockImplementation((url: string, _body: unknown = {}, callback?: (r: unknown) => void) => {
                switch (url) {
                    case "/api/file/putFile":
                        callback?.({code: 0});
                        return undefined;
                    case "/api/archive/unzip":
                        callback?.({code: 0});
                        return undefined;
                    case "/api/file/readDir":
                        callback?.({code: 0, data: dirCalls++ === 0 ? zipDirList : subDirList});
                        return undefined;
                    case "/api/file/getFile":
                        // conf.json 内容为数组对象（服务端 JSON 解析形态）
                        callback?.([{id: "z-1", name: "zip片段", content: "x {}", type: "css", enabled: true}]);
                        return undefined;
                    default:
                        callback?.({code: 0});
                        return undefined;
                }
            });

            const promise = service.importSnippets(false);
            await triggerFileChange(inputOf(), new File(["binary"], "backup.zip", {type: "application/zip"}));
            await promise;

            const newList = vi.mocked(plugin.snippetManager.applyImportedSnippets).mock.calls[0][0] as Snippet[];
            expect(newList.map(s => s.id)).toEqual(["z-1", "s-1"]);
            // putFile 上传了 zip
            expect(fetchPostMock.mock.calls.filter(([u]) => u === "/api/file/putFile")).toHaveLength(1);
        });
    });
});
