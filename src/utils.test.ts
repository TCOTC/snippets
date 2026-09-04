// src/utils.ts 单测
// 覆盖：常量、settleWriteResponse 失败归一化、genSnippetSwitchHtml 模板、
//       fetchPost 系文件 API 封装（fetchPost 经 alias mock）、
//       genNewSnippetId 冲突跳过、isPreviewingSnippet 短路语义。
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fetchPost} from "siyuan";
import type {Snippet} from "./types";
import {
    escapeHtml,
    genNewSnippetId,
    genSnippetSwitchHtml,
    getFile,
    isPreviewingSnippet,
    PLUGIN_NAME,
    putFile,
    renameFile,
    settleWriteResponse,
    SNIPPET_DIALOG_DATA_KEY,
} from "./utils";

// utils.ts 顶层 import 的 fetchPost 与测试侧引用同一 mock 模块实例
const fetchPostMock = vi.mocked(fetchPost);

describe("常量", () => {
    it("插件名与对话框 data-key 与代码保持一致", () => {
        expect(PLUGIN_NAME).toBe("snippets");
        expect(SNIPPET_DIALOG_DATA_KEY).toBe("jcsm-snippet-dialog");
    });
});

describe("escapeHtml", () => {
    it("HTML 特殊字符全部转义为实体", () => {
        expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(escapeHtml("a & b \"c\" 'd'")).toBe("a &amp; b &quot;c&quot; &#39;d&#39;");
        expect(escapeHtml("a < b > c")).toBe("a &lt; b &gt; c");
    });

    it("无特殊字符时原样返回", () => {
        expect(escapeHtml("普通文本 body {}")).toBe("普通文本 body {}");
    });
});

describe("settleWriteResponse", () => {
    it("resolve 时直通原响应", async () => {
        const response = {code: 0, data: "ok"};
        await expect(settleWriteResponse(Promise.resolve(response))).resolves.toBe(response);
    });

    it("reject 携带 code/msg 时归一为同形对象", async () => {
        await expect(settleWriteResponse(Promise.reject({code: 403, msg: "forbidden"})))
            .resolves.toEqual({code: 403, msg: "forbidden"});
    });

    it("reject Error 时取 message 且 code 记为 -1", async () => {
        await expect(settleWriteResponse(Promise.reject(new Error("boom"))))
            .resolves.toEqual({code: -1, msg: "boom"});
    });

    it("reject 原始字符串时兜底为字符串本身", async () => {
        await expect(settleWriteResponse(Promise.reject("raw-fail")))
            .resolves.toEqual({code: -1, msg: "raw-fail"});
    });

    it("reject 无信息的对象时兜底为 String(error)", async () => {
        await expect(settleWriteResponse(Promise.reject(undefined)))
            .resolves.toEqual({code: -1, msg: "undefined"});
    });
});

describe("genSnippetSwitchHtml", () => {
    it("snippetSwitch 未勾选：无 checked/aria 属性", () => {
        const html = genSnippetSwitchHtml("snippetSwitch", false, "jcsm-switch ");
        expect(html).toContain('data-type="snippetSwitch"');
        expect(html).toContain('class="jcsm-switch b3-switch fn__flex-center"');
        expect(html).toContain('type="checkbox"');
        expect(html).not.toContain(" checked");
        expect(html).not.toContain("aria-label");
    });

    it("snippetSwitch 勾选时带 checked 属性", () => {
        const html = genSnippetSwitchHtml("snippetSwitch", true, "jcsm-switch ");
        expect(html).toContain(" checked");
    });

    it("publishSwitch 带无障碍标签与隐藏控制", () => {
        const html = genSnippetSwitchHtml("publishSwitch", false, "", "发布服务开关", true);
        expect(html).toContain('data-type="publishSwitch"');
        expect(html).toContain("ariaLabel");
        expect(html).toContain('aria-label="发布服务开关"');
        expect(html).toContain('data-position="north"');
        expect(html).toContain("fn__none");
    });

    it("非发布开关默认显示（无 fn__none）", () => {
        const html = genSnippetSwitchHtml("snippetSwitch", false, "");
        expect(html).not.toContain("fn__none");
    });
});

describe("文件 API 封装", () => {
    beforeEach(() => {
        fetchPostMock.mockImplementation((_url: string, _body: unknown, callback?: (response: unknown) => void) => {
            callback?.({code: 0});
        });
    });

    it("getFile 携带路径请求 /api/file/getFile", async () => {
        await expect(getFile("data/foo.txt")).resolves.toEqual({code: 0});
        expect(fetchPostMock).toHaveBeenCalledWith(
            "/api/file/getFile",
            {path: "data/foo.txt"},
            expect.any(Function)
        );
    });

    it("renameFile 携带原路径与新路径", async () => {
        await expect(renameFile("data/a.txt", "data/b.txt")).resolves.toEqual({code: 0});
        expect(fetchPostMock).toHaveBeenCalledWith(
            "/api/file/renameFile",
            {path: "data/a.txt", newPath: "data/b.txt"},
            expect.any(Function)
        );
    });

    it("putFile 路径为空时直接拒绝", async () => {
        await expect(putFile("", "content")).rejects.toMatchObject({code: 400});
        expect(fetchPostMock).not.toHaveBeenCalled();
    });

    it("putFile 内容为空时直接拒绝", async () => {
        await expect(putFile("data/a.txt", "")).rejects.toMatchObject({code: 400});
        expect(fetchPostMock).not.toHaveBeenCalled();
    });

    it("putFile 文本内容包装为 FormData/File 上传", async () => {
        await expect(putFile("data/snippets/a.css", "body {}")).resolves.toEqual({code: 0});
        expect(fetchPostMock).toHaveBeenCalledTimes(1);
        const [url, body] = fetchPostMock.mock.calls[0];
        expect(url).toBe("/api/file/putFile");
        const formData = body as FormData;
        expect(formData).toBeInstanceOf(FormData);
        expect(formData.get("path")).toBe("data/snippets/a.css");
        expect(formData.get("isDir")).toBe("false");
        const file = formData.get("file");
        expect(file).toBeInstanceOf(File);
        expect((file as File).name).toBe("a.css");
        await expect((file as File).text()).resolves.toBe("body {}");
    });
});

describe("genNewSnippetId", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("无冲突时直接返回生成的 ID", () => {
        const generateId = vi.fn(() => "20250905120000-aaaa");
        vi.stubGlobal("window", {Lute: {NewNodeID: generateId}});
        const snippetsList: Snippet[] = [{id: "20250905120000-other", name: "", type: "css", enabled: true, content: ""}];
        expect(genNewSnippetId(snippetsList)).toBe("20250905120000-aaaa");
        expect(generateId).toHaveBeenCalledTimes(1);
    });

    it("与现有列表冲突时重新生成直到不冲突", () => {
        const generateId = vi.fn()
            .mockReturnValueOnce("20250905120000-dup")
            .mockReturnValueOnce("20250905120000-fresh");
        vi.stubGlobal("window", {Lute: {NewNodeID: generateId}});
        const snippetsList: Snippet[] = [{id: "20250905120000-dup", name: "", type: "css", enabled: true, content: ""}];
        expect(genNewSnippetId(snippetsList)).toBe("20250905120000-fresh");
        expect(generateId).toHaveBeenCalledTimes(2);
    });
});

describe("isPreviewingSnippet", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("非 css 类型直接返回 false（不查询 DOM）", () => {
        const querySelector = vi.fn();
        vi.stubGlobal("document", {querySelector});
        expect(isPreviewingSnippet("id-1", "js", true)).toBe(false);
        expect(querySelector).not.toHaveBeenCalled();
    });

    it("css 类型但未开启实时预览时返回 false", () => {
        const querySelector = vi.fn();
        vi.stubGlobal("document", {querySelector});
        expect(isPreviewingSnippet("id-1", "css", false)).toBe(false);
        expect(querySelector).not.toHaveBeenCalled();
    });

    it("css + 实时预览且无对应编辑对话框时返回 false", () => {
        const querySelector = vi.fn(() => null);
        vi.stubGlobal("document", {querySelector});
        expect(isPreviewingSnippet("id-1", "css", true)).toBe(false);
        expect(querySelector).toHaveBeenCalledWith(
            `.b3-dialog--open[data-key="${SNIPPET_DIALOG_DATA_KEY}"][data-snippet-id="id-1"]`
        );
    });

    it("css + 实时预览且存在对应编辑对话框时返回 true", () => {
        const querySelector = vi.fn(() => ({tagName: "DIV"}));
        vi.stubGlobal("document", {querySelector});
        expect(isPreviewingSnippet("id-1", "css", true)).toBe(true);
    });
});
