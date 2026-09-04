// services/file-watch.ts FileWatchService 单测
// 覆盖：start 的分支（disabled 早退/enabled 初始加载+注入+轮询定时器/loadOnly 只加载）、
//       stop 清理、handlePathChange 重载、handleIntervalChange 重设定时器、
//       CSS/JS 文件注入与无效 JS 拒绝、轮询驱动的新增/修改/删除与 JS 自动重载联动、
//       目录读取失败的错误提示。
// 依赖 getFile/fetchPostPromise（utils → siyuan fetchPost mock 按 URL/路径分发）与 jsdom DOM。
// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fetchPost} from "siyuan";
import type PluginSnippets from "../index";
import type {Snippet} from "../types";
import {FileWatchService} from "./file-watch";

/** 目录项 */
interface DirEntry {
    name: string;
    isDir: boolean;
    path: string;
}

/**
 * 构造文件监听替身插件
 * @param dirEntries 目录 readDir 返回的条目（可变：轮询场景由测试更新）
 * @param fileContents 文件路径 -> 内容（getFile 返回原始字符串）
 * @returns {service, plugin, dirEntries, fileContents}
 */
const setup = (dirEntries: DirEntry[] = [], fileContents: Map<string, string> = new Map()) => {
    const plugin = {
        config: {
            fileWatchEnabled: "enabled",
            fileWatchPath: "data/snippets",
            fileWatchInterval: 5,
            autoReloadUIAfterModifyJS: true,
        },
        snippetsList: [] as Snippet[],
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
        showErrorMessage: vi.fn(),
        i18n: {
            fileWatchInvalidPath: "目录不存在",
            fileWatchNoSupportAbsPath: "不支持绝对路径",
            fileWatchError: "监听失败",
            readFolderFailed: "读取目录失败",
        },
        menuView: {promptJSReloadRequired: vi.fn(async () => {})},
        editorManager: {maybeAutoReloadUI: vi.fn()},
    } as unknown as PluginSnippets;

    // getFile/readDir 都经 fetchPost 回调分发
    vi.mocked(fetchPost).mockImplementation((url: string, body: {path?: string} = {}, callback?: (r: unknown) => void) => {
        if (url === "/api/file/readDir") {
            callback?.({code: 0, data: dirEntries});
            return undefined;
        }
        if (url === "/api/file/getFile") {
            const path = body.path ?? "";
            const content = fileContents.get(path);
            if (content === undefined) {
                callback?.({code: 404, msg: "not found"});
            } else {
                callback?.(content);
            }
            return undefined;
        }
        callback?.({code: 0});
        return undefined;
    });

    const service = new FileWatchService(plugin);
    return {service, plugin};
};

/** flush 微任务（fake timers 下推进定时器与微任务队列） */
const flush = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
};

describe("FileWatchService", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        vi.useFakeTimers();
        // genNewSnippetId 依赖 window.Lute
        (window as unknown as {Lute: {NewNodeID: () => string}}).Lute = {NewNodeID: () => "gen" + Math.random().toString(36).slice(2, 8)};
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const readDirCalls = () => vi.mocked(fetchPost).mock.calls.filter(([url]) => url === "/api/file/readDir").length;
    const getFileCalls = () => vi.mocked(fetchPost).mock.calls.filter(([url]) => url === "/api/file/getFile").length;

    const expectWatchElement = (filePath: string, tag: "style" | "script") => {
        const encoded = encodeURIComponent(filePath);
        const element = document.head.querySelector(`[data-file-path="${encoded}"]`);
        expect(element, `watch element for ${filePath}`).not.toBeNull();
        expect(element!.tagName.toLowerCase()).toBe(tag);
        return element as HTMLElement;
    };

    describe("start", () => {
        it("disabled 模式下不加载也不设轮询定时器", async () => {
            const {service, plugin} = setup();
            plugin.config.fileWatchEnabled = "disabled";
            service.start();
            await flush(6000);
            expect(readDirCalls()).toBe(0);
            expect(document.head.children.length).toBe(0);
        });

        it("enabled 模式初始加载 CSS/JS 文件并注入元素、设置轮询定时器", async () => {
            const files = [
                {name: "a.css", isDir: false, path: "data/snippets/a.css"},
                {name: "a.js", isDir: false, path: "data/snippets/a.js"},
            ];
            const contents = new Map([
                ["data/snippets/a.css", "body { color: red; }"],
                ["data/snippets/a.js", "console.log(1)"],
            ]);
            const {service} = setup(files, contents);
            service.start();
            await flush(1);

            expectWatchElement("data/snippets/a.css", "style").textContent = "body { color: red; }";
            expectWatchElement("data/snippets/a.js", "script").textContent = "console.log(1)";
            expect(readDirCalls()).toBe(1);
            expect(getFileCalls()).toBe(2);

            // 轮询定时器生效：推进一个周期后再次 readDir
            await flush(5000);
            expect(readDirCalls()).toBe(2);
        });

        it("loadOnly 模式只加载一次，不设轮询定时器", async () => {
            const files = [{name: "a.css", isDir: false, path: "data/snippets/a.css"}];
            const contents = new Map([["data/snippets/a.css", "body {}"]]);
            const {service, plugin} = setup(files, contents);
            plugin.config.fileWatchEnabled = "loadOnly";
            service.start();
            await flush(1);
            expect(readDirCalls()).toBe(1);
            await flush(6000);
            expect(readDirCalls()).toBe(1);
        });

        it("目录为空时不注入任何元素", async () => {
            const {service} = setup([], new Map());
            service.start();
            await flush(1);
            expect(document.head.children.length).toBe(0);
            expect(readDirCalls()).toBe(1);
        });

        it("readDir 失败时提示监听错误", async () => {
            const {service, plugin} = setup();
            vi.mocked(fetchPost).mockImplementation((url: string, _body: unknown, callback?: (r: unknown) => void) => {
                if (url === "/api/file/readDir") {
                    callback?.({code: 1, msg: "boom"});
                } else {
                    callback?.({code: 0});
                }
                return undefined;
            });
            service.start();
            await flush(1);
            expect(plugin.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("boom"));
        });
    });

    describe("stop", () => {
        it("enabled 模式下停止轮询定时器", async () => {
            const files = [{name: "a.css", isDir: false, path: "data/snippets/a.css"}];
            const {service} = setup(files, new Map([["data/snippets/a.css", "body {}"]]));
            service.start();
            await flush(1);
            expect(readDirCalls()).toBe(1);
            service.stop();
            await flush(10000);
            expect(readDirCalls()).toBe(1);
        });

        it("disabled 模式下 stop 同时移除已注入的监听元素", async () => {
            const files = [{name: "a.css", isDir: false, path: "data/snippets/a.css"}];
            const {service, plugin} = setup(files, new Map([["data/snippets/a.css", "body {}"]]));
            service.start(); // enabled，先加载
            await flush(1);
            expect(document.head.children.length).toBe(1);
            plugin.config.fileWatchEnabled = "disabled";
            service.stop(); // disabled 分支：移除全部监听元素
            expect(document.head.children.length).toBe(0);
        });
    });

    describe("handlePathChange / handleIntervalChange", () => {
        it("disabled 模式 handlePathChange 不重载", async () => {
            const {service, plugin} = setup();
            plugin.config.fileWatchEnabled = "disabled";
            await service.handlePathChange();
            expect(readDirCalls()).toBe(0);
        });

        it("enabled 模式 handlePathChange 清空旧元素并重载", async () => {
            const files = [{name: "a.css", isDir: false, path: "data/snippets/a.css"}];
            const contents = new Map([["data/snippets/a.css", "body {}"]]);
            const {service} = setup(files, contents);
            service.start();
            await flush(1);
            expect(document.head.children.length).toBe(1);

            // 路径变化：新目录下只有 b.css
            files.length = 0;
            files.push({name: "b.css", isDir: false, path: "data/watch/b.css"});
            contents.clear();
            contents.set("data/watch/b.css", "p {}");
            await service.handlePathChange();
            expect(document.head.children.length).toBe(1);
            expect(document.head.querySelector('[data-file-path="data%2Fwatch%2Fb.css"]')).not.toBeNull();
        });

        it("enabled 模式 handleIntervalChange 按新间隔重置轮询", async () => {
            const files = [{name: "a.css", isDir: false, path: "data/snippets/a.css"}];
            const {service, plugin} = setup(files, new Map([["data/snippets/a.css", "body {}"]]));
            service.start();
            await flush(1);
            expect(readDirCalls()).toBe(1);

            plugin.config.fileWatchInterval = 2;
            service.handleIntervalChange();
            // 旧间隔 5s 不再触发，新间隔 2s 触发
            await flush(4000);
            // 1(初始) + 2s/4s 两次
            expect(readDirCalls()).toBe(3);
        });
    });

    describe("轮询检测文件变化", () => {
        it("检测到 JS 文件中途修改且开启自动重载时重新应用并提示", async () => {
            const files = [{name: "a.js", isDir: false, path: "data/snippets/a.js"}];
            const contents = new Map([["data/snippets/a.js", "console.log(1)"]]);
            const {service, plugin} = setup(files, contents);
            service.start();
            await flush(1);
            const first = expectWatchElement("data/snippets/a.js", "script");

            // 修改文件内容后推进一个轮询周期
            contents.set("data/snippets/a.js", "console.log(2)");
            await flush(5000);
            expect(document.querySelector('[data-file-path="data%2Fsnippets%2Fa.js"]')).not.toBe(first);
            expect(expectWatchElement("data/snippets/a.js", "script").textContent).toBe("console.log(2)");
            // JS 旧元素被替换 → 重载提示 + 自动重载
            expect(plugin.menuView.promptJSReloadRequired).toHaveBeenCalledWith(2000);
            expect(plugin.editorManager.maybeAutoReloadUI).toHaveBeenCalled();
        });

        it("JS 修改但关闭自动重载时保留旧元素不重应用", async () => {
            const files = [{name: "a.js", isDir: false, path: "data/snippets/a.js"}];
            const contents = new Map([["data/snippets/a.js", "console.log(1)"]]);
            const {service, plugin} = setup(files, contents);
            plugin.config.autoReloadUIAfterModifyJS = false;
            service.start();
            await flush(1);
            const first = expectWatchElement("data/snippets/a.js", "script");

            contents.set("data/snippets/a.js", "console.log(2)");
            await flush(5000);
            // 元素保持原样，不重新应用
            expect(document.querySelector('[data-file-path="data%2Fsnippets%2Fa.js"]')).toBe(first);
            expect(first.textContent).toBe("console.log(1)");
            expect(plugin.menuView.promptJSReloadRequired).not.toHaveBeenCalled();
        });

        it("检测到文件被删除时移除元素并提示", async () => {
            const files = [{name: "a.js", isDir: false, path: "data/snippets/a.js"}];
            const contents = new Map([["data/snippets/a.js", "console.log(1)"]]);
            const {service, plugin} = setup(files, contents);
            service.start();
            await flush(1);
            expectWatchElement("data/snippets/a.js", "script");

            files.length = 0; // 文件被删除
            await flush(5000);
            expect(document.querySelector('[data-file-path="data%2Fsnippets%2Fa.js"]')).toBeNull();
            expect(plugin.menuView.promptJSReloadRequired).toHaveBeenCalledWith(2000);
            expect(plugin.editorManager.maybeAutoReloadUI).toHaveBeenCalled();
        });

        it("检测到新增文件时注入元素", async () => {
            const files: DirEntry[] = [];
            const contents = new Map<string, string>();
            const {service} = setup(files, contents);
            service.start();
            await flush(1);
            expect(document.head.children.length).toBe(0);

            files.push({name: "c.css", isDir: false, path: "data/snippets/c.css"});
            contents.set("data/snippets/c.css", "h1 {}");
            await flush(5000);
            expectWatchElement("data/snippets/c.css", "style");
        });

        it("无效 JS 内容不注入并记录告警", async () => {
            const files = [{name: "bad.js", isDir: false, path: "data/snippets/bad.js"}];
            const contents = new Map([["data/snippets/bad.js", "123"]]); // 顶层字面量属无效代码
            const {service, plugin} = setup(files, contents);
            service.start();
            await flush(1);
            expect(document.querySelector('[data-file-path="data%2Fsnippets%2Fbad.js"]')).toBeNull();
            expect(plugin.console.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid JS code"), "data/snippets/bad.js");
        });
    });
});
