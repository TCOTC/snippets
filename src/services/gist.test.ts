// services/gist.ts REST 客户端单测：URL 解析、请求装配、错误归一、截断 raw 兜底
import {describe, expect, it, vi} from "vitest";
import {createGist, getGist, getRawFile, GistApiError, parseGistUrl, updateGist} from "./gist";

/** 构造注入式 fetch 桩：按 URL 与请求选项返回 JSON 响应 */
const stubFetch = (handler: (url: string, init: RequestInit) => {status: number; json?: unknown; text?: string; headers?: Record<string, string>}) => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
        const result = handler(String(url), init);
        const headers = new Headers(result.headers ?? {});
        return new Response(
            result.json !== undefined ? JSON.stringify(result.json) : (result.text ?? ""),
            {status: result.status, headers}
        );
    });
    return fetchImpl;
};

describe("parseGistUrl", () => {
    it("接受完整 gist 链接并去除多余路径与裸 id（不支持裸 id）", () => {
        expect(parseGistUrl("https://gist.github.com/octocat/6cad326836d38bd3a7ae")).toBe("6cad326836d38bd3a7ae");
        expect(parseGistUrl("https://gist.github.com/6cad326836d38bd3a7ae")).toBe("6cad326836d38bd3a7ae");
        expect(parseGistUrl("https://gist.github.com/octocat/6cad326836d38bd3a7ae#file-xxx")).toBe("6cad326836d38bd3a7ae");
        // 仅粘贴裸 id 不识别（统一只收链接）
        expect(parseGistUrl("6cad326836d38bd3a7ae")).toBeNull();
    });

    it("空白与非法输入返回 null", () => {
        expect(parseGistUrl("")).toBeNull();
        expect(parseGistUrl("   ")).toBeNull();
        expect(parseGistUrl("not-a-gist")).toBeNull();
        expect(parseGistUrl("https://github.com/other/repo")).toBeNull();
        expect(parseGistUrl("https://gist.example.com/6cad326836d38bd3a7ae")).toBeNull();
    });
});

describe("getGist", () => {
    it("匿名请求公开 gist，不带 Authorization 头", async () => {
        const fetchImpl = stubFetch((url, init) => {
            expect(url).toBe("https://api.github.com/gists/abc123");
            expect(init.method).toBe("GET");
            expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
            return {status: 200, json: {id: "abc123", description: null, public: true, html_url: "https://gist.github.com/x/abc123", updated_at: "2026-01-01T00:00:00Z", files: {}}};
        });
        const gist = await getGist("abc123", {fetchImpl});
        expect(gist.id).toBe("abc123");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("带 Token 时附加 Authorization Bearer 头", async () => {
        const fetchImpl = stubFetch((_url, init) => {
            expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ghp_token");
            expect((init.headers as Record<string, string>).Accept).toBe("application/vnd.github+json");
            expect((init.headers as Record<string, string>)["X-GitHub-Api-Version"]).toBe("2022-11-28");
            return {status: 200, json: {id: "abc123", files: {}}};
        });
        await getGist("abc123", {token: "ghp_token", fetchImpl});
    });

    it("401 → unauthorized", async () => {
        const fetchImpl = stubFetch(() => ({status: 401}));
        await expect(getGist("abc123", {token: "bad", fetchImpl})).rejects.toMatchObject({kind: "unauthorized", status: 401});
    });

    it("403 匿名 → rate-limit；带 Token → rate-limit 且带剩余分钟", async () => {
        const reset = String(Math.floor((Date.now() + 120000) / 1000));
        const anonymous = stubFetch(() => ({status: 403, headers: {"X-RateLimit-Reset": reset}}));
        await expect(getGist("abc123", {fetchImpl: anonymous})).rejects.toMatchObject({kind: "rate-limit"});

        const authed = stubFetch(() => ({status: 403, headers: {"X-RateLimit-Reset": reset}}));
        const error = (await getGist("abc123", {token: "t", fetchImpl: authed}).catch(e => e)) as GistApiError;
        expect(error.kind).toBe("rate-limit");
        expect(error.message).toContain("2 min");
    });

    it("404 → not-found", async () => {
        const fetchImpl = stubFetch(() => ({status: 404}));
        await expect(getGist("abc123", {fetchImpl})).rejects.toMatchObject({kind: "not-found"});
    });

    it("网络异常 → network", async () => {
        const fetchImpl = vi.fn(async () => {
            throw new TypeError("Failed to fetch");
        });
        await expect(getGist("abc123", {fetchImpl})).rejects.toMatchObject({kind: "network"});
    });

    it("响应非 JSON → network", async () => {
        const fetchImpl = stubFetch(() => ({status: 200, text: "<html>error page</html>"}));
        await expect(getGist("abc123", {fetchImpl})).rejects.toMatchObject({kind: "network"});
    });
});

describe("createGist / updateGist", () => {
    it("createGist 以 POST 发送 description/public/files 载荷", async () => {
        let seenUrl = "";
        let seenInit: RequestInit = {};
        const fetchImpl = stubFetch((url, init) => {
            seenUrl = url;
            seenInit = init;
            return {status: 201, json: {id: "new1", files: {}}};
        });
        const gist = await createGist("desc", false, {"a.css": "body{}"}, {token: "ghp_t", fetchImpl});
        expect(gist.id).toBe("new1");
        expect(seenUrl).toBe("https://api.github.com/gists");
        expect(seenInit.method).toBe("POST");
        expect(JSON.parse(String(seenInit.body))).toEqual({
            description: "desc",
            public: false,
            files: {"a.css": {content: "body{}"}},
        });
    });

    it("updateGist 以 PATCH 发送 files 载荷（null 删除）", async () => {
        let seenUrl = "";
        let seenInit: RequestInit = {};
        const fetchImpl = stubFetch((url, init) => {
            seenUrl = url;
            seenInit = init;
            return {status: 200, json: {id: "abc123", files: {}}};
        });
        await updateGist("abc123", {"a.css": "x", "old.js": null}, undefined, {token: "ghp_t", fetchImpl});
        expect(seenUrl).toBe("https://api.github.com/gists/abc123");
        expect(seenInit.method).toBe("PATCH");
        const sentBody = JSON.parse(String(seenInit.body));
        expect(sentBody.files).toEqual({"a.css": {content: "x"}, "old.js": null});
        // description 为空时不写回（保留 gist 既有描述）
        expect(sentBody.description).toBeUndefined();
    });

    it("updateGist 在 description 非空时随 PATCH 写回", async () => {
        let seenInit: RequestInit = {};
        const fetchImpl = stubFetch((url, init) => {
            seenInit = init;
            return {status: 200, json: {id: "abc123", files: {}}};
        });
        await updateGist("abc123", {"a.css": "x"}, "新标题", {token: "ghp_t", fetchImpl});
        expect(seenInit.method).toBe("PATCH");
        expect(JSON.parse(String(seenInit.body)).description).toBe("新标题");
    });
});

describe("getRawFile", () => {
    it("拉取 raw 文本", async () => {
        const fetchImpl = stubFetch(() => ({status: 200, text: "body{}"}));
        await expect(getRawFile("https://gist.githubusercontent.com/x/y/raw/a.css", {fetchImpl})).resolves.toBe("body{}");
    });

    it("raw 失败按 network 归一", async () => {
        const fetchImpl = stubFetch(() => ({status: 500}));
        await expect(getRawFile("https://x/raw", {fetchImpl})).rejects.toMatchObject({kind: "network"});
    });
});
