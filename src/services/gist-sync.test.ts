// services/gist-sync.ts 映射逻辑单测：文件名解析、conf 特例、截断 raw 兜底
import {describe, expect, it, vi} from "vitest";
import type {Gist} from "./gist";
import {isSnippetArray, mapGistToImportData} from "./gist-sync";

const makeGist = (files: Record<string, any>, overrides: Partial<Gist> = {}): Gist => ({
    id: "gist-1",
    description: null,
    public: false,
    html_url: "https://gist.github.com/x/gist-1",
    updated_at: "2026-01-01T00:00:00Z",
    files,
    ...overrides,
});

describe("isSnippetArray", () => {
    it("识别 conf 片段数组结构", () => {
        expect(isSnippetArray([{id: "a", name: "n", content: "c", type: "css", enabled: false}])).toBe(true);
        expect(isSnippetArray([{name: "n", content: "c", type: "js", enabled: true}])).toBe(true);
        expect(isSnippetArray([])).toBe(true);
        expect(isSnippetArray("x")).toBe(false);
        expect(isSnippetArray([{name: 1, content: "c", type: "css", enabled: false}])).toBe(false);
        expect(isSnippetArray([{name: "n", content: "c", type: "html", enabled: false}])).toBe(false);
    });
});

describe("mapGistToImportData 普通多文件", () => {
    it("逐文件解析名称/ID/类型", async () => {
        const gist = makeGist({
            "我的样式 20250813161014-se1mend.css": {filename: "我的样式 20250813161014-se1mend.css", content: "body{}"},
            "injector 20250813161014-se1mend.js": {filename: "injector 20250813161014-se1mend.js", content: "console.log(1)"},
            "README.md": {filename: "README.md", content: "# readme"},
        });
        const data = await mapGistToImportData(gist);
        expect(data.files).toHaveLength(3);
        expect(data.files[0]).toMatchObject({fileName: "我的样式 20250813161014-se1mend.css", name: "我的样式", id: "20250813161014-se1mend", type: "css", content: "body{}", truncated: false, isConf: false});
        expect(data.files[1].type).toBe("js");
        // 无 ID 文件不带 id
        expect(data.files[2]).toMatchObject({name: "README", type: "css"});
        expect(data.files[2].id).toBeUndefined();
        expect(data.confSnippets).toBeUndefined();
    });
});

describe("mapGistToImportData conf 特例", () => {
    it("单个 .json 内容为片段数组 → confSnippets", async () => {
        const snippets = [
            {id: "20250101000000-abc1234", name: "片段一", content: "x", type: "css", enabled: true},
            {id: "20250101000001-abc1234", name: "片段二", content: "y", type: "js", enabled: false},
        ];
        const gist = makeGist({
            "snippets.json": {filename: "snippets.json", content: JSON.stringify(snippets)},
        });
        const data = await mapGistToImportData(gist);
        expect(data.confSnippets).toHaveLength(2);
        expect(data.confSnippets![0].id).toBe("20250101000000-abc1234");
        expect(data.files[0].isConf).toBe(true);
    });

    it("单个 .json 内容非片段数组 → 按普通文件处理", async () => {
        const gist = makeGist({
            "data.json": {filename: "data.json", content: '{"a":1}'},
        });
        const data = await mapGistToImportData(gist);
        expect(data.confSnippets).toBeUndefined();
        expect(data.files[0]).toMatchObject({fileName: "data.json", isConf: false, type: "css"});
    });

    it("多个文件时不触发 conf 特例", async () => {
        const gist = makeGist({
            "a.json": {filename: "a.json", content: "[]"},
            "b.css": {filename: "b.css", content: "x"},
        });
        const data = await mapGistToImportData(gist);
        expect(data.confSnippets).toBeUndefined();
        expect(data.files).toHaveLength(2);
    });
});

describe("mapGistToImportData 截断 raw 兜底", () => {
    it("truncated 文件经 raw_url 取全文", async () => {
        const fetchImpl = vi.fn(async () => new Response("full content", {status: 200}));
        const gist = makeGist({
            "big.css": {filename: "big.css", content: "part", truncated: true, raw_url: "https://raw/big.css"},
        });
        const data = await mapGistToImportData(gist, fetchImpl as unknown as typeof fetch);
        expect(fetchImpl).toHaveBeenCalledWith("https://raw/big.css", expect.anything());
        expect(data.files[0].content).toBe("full content");
        expect(data.files[0].truncated).toBe(false);
    });

    it("raw 拉取失败 → 标记 fetchError 并保留截断内容", async () => {
        const fetchImpl = vi.fn(async () => new Response("", {status: 500}));
        const gist = makeGist({
            "big.css": {filename: "big.css", content: "part", truncated: true, raw_url: "https://raw/big.css"},
        });
        const data = await mapGistToImportData(gist, fetchImpl as unknown as typeof fetch);
        expect(data.files[0].content).toBe("part");
        expect(data.files[0].truncated).toBe(true);
        expect(data.files[0].fetchError).toBeTruthy();
    });
});
