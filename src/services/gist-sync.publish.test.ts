// services/gist-sync.ts 发布纯逻辑单测：校验、文件名构建去重、更新镜像载荷规划
import {describe, expect, it} from "vitest";
import type {Gist} from "./gist";
import type {Snippet} from "../types";
import {buildPublishFiles, planUpdateFiles, validatePublishSnippets} from "./gist-sync";

const snippet = (id: string, name: string, content = "x", type: "css" | "js" = "css"): Snippet => ({id, name, content, type, enabled: false});

const makeGist = (fileNames: string[]): Gist => ({
    id: "gist-9",
    description: null,
    public: false,
    html_url: "https://gist.github.com/x/gist-9",
    updated_at: "2026-01-01T00:00:00Z",
    files: Object.fromEntries(fileNames.map(name => [name, {filename: name, content: "old"}])),
});

describe("validatePublishSnippets", () => {
    it("正常通过", () => {
        expect(validatePublishSnippets([snippet("a", "a")])).toBeNull();
    });

    it("单片段超过 1MB → too-large", () => {
        const big = snippet("a", "a", "x".repeat(1024 * 1024 + 1));
        expect(validatePublishSnippets([big])).toBe("too-large");
    });

    it("文件数超过 300 → too-many", () => {
        const many = Array.from({length: 301}, (_, i) => snippet(String(i), "n" + i));
        expect(validatePublishSnippets(many)).toBe("too-many");
    });
});

describe("buildPublishFiles", () => {
    it("生成 <名称> <ID>.<ext> 文件行", () => {
        const rows = buildPublishFiles([snippet("20250101000000-abc1234", "样式", "body{}", "css")]);
        expect(rows).toEqual([{fileName: "样式 20250101000000-abc1234.css", content: "body{}"}]);
    });

    it("同 ID 重复项追加序号后缀避免覆盖（防御：正常勾选不会出现同 ID 两项）", () => {
        const rows = buildPublishFiles([
            snippet("id1", "a/b"),
            snippet("id1", "a/b"),
        ]);
        expect(rows).toHaveLength(2);
        expect(rows[0].fileName).toBe("a-b id1.css");
        expect(rows[1].fileName).toBe("a-b (2) id1.css");
    });

    it("空名回退 snippet 名称", () => {
        const rows = buildPublishFiles([snippet("id1", "")]);
        expect(rows[0].fileName).toContain("snippet id1");
    });
});

describe("planUpdateFiles", () => {
    const ID_A = "20250101000000-abc1234";
    const ID_B = "20250101000001-abc1234";

    it("未勾选的旧文件置 null 删除；同名文件由行写入", () => {
        const existing = makeGist([`样式 ${ID_A}.css`, "old-readme.md"]);
        const rows = [{fileName: `样式 ${ID_A}.css`, content: "new"}];
        const payload = planUpdateFiles(existing, rows);
        expect(payload[`样式 ${ID_A}.css`]).toBe("new");
        expect(payload["old-readme.md"]).toBeNull();
    });

    it("同 ID 改名：旧文件名置 null 删除并写入新文件名（GitHub 表现为重命名）", () => {
        const existing = makeGist([`旧名字 ${ID_A}.css`]);
        const rows = [{fileName: `新名字 ${ID_A}.css`, content: "x"}];
        const payload = planUpdateFiles(existing, rows);
        expect(payload[`旧名字 ${ID_A}.css`]).toBeNull();
        expect(payload[`新名字 ${ID_A}.css`]).toBe("x");
    });

    it("勾选集新增文件不删除其它带 ID 的同名（不同 ID 保留为新文件）", () => {
        const existing = makeGist([`a ${ID_A}.css`]);
        const rows = [{fileName: `b ${ID_B}.css`, content: "y"}];
        const payload = planUpdateFiles(existing, rows);
        expect(payload[`a ${ID_A}.css`]).toBeNull();
        expect(payload[`b ${ID_B}.css`]).toBe("y");
    });
});
