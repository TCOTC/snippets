// GitHub Gist REST 客户端（纯网络层，无插件依赖）
// 职责：Gist URL/id 解析、GET/POST/PATCH 请求、响应解析容错、错误归一为 GistApiError。
// 全部请求经注入的 fetch（默认全局 fetch），超时用 AbortController（默认 15s）；
// 桌面端 Electron webSecurity 关闭、api.github.com 亦返回 Access-Control-Allow-Origin: *，
// 因此前端可直接 fetch，无需思源内核 HTTP 通道（不继承内核代理配置）。

/** Gist 文件条目（GET /gists/{id} files 对象的 value 形态） */
export interface GistFileEntry {
    filename: string;
    type?: string | null;
    language?: string | null;
    raw_url?: string;
    size?: number;
    truncated?: boolean;
    content?: string;
}

/** Gist 元数据（仅保留本插件需要字段） */
export interface Gist {
    id: string;
    description: string | null;
    public: boolean;
    html_url: string;
    updated_at: string;
    files: Record<string, GistFileEntry>;
}

/** 归一错误类别（与 docs/gist-sync.md 第 7 节对应） */
export type GistApiErrorKind =
    | "unauthorized"   // 401 Token 无效/过期
    | "rate-limit"     // 403 限流（匿名或带 Token）
    | "not-found"      // 404 gist 不存在或私有未授权
    | "network"        // 网络不可达 / 超时 / 响应非 JSON
    | "invalid"        // 参数/校验失败（如 422）
    | "server";        // 其它服务端错误

/** 归一化错误（message 已可读，供调用方直接提示） */
export class GistApiError extends Error {
    readonly kind: GistApiErrorKind;
    readonly status?: number;

    constructor(kind: GistApiErrorKind, message: string, status?: number) {
        super(message);
        this.name = "GistApiError";
        this.kind = kind;
        this.status = status;
    }
}

/** 请求选项 */
export interface GistRequestOptions {
    /** GitHub Token（未提供则匿名请求） */
    token?: string;
    /** 注入的 fetch（默认全局 fetch；单测用） */
    fetchImpl?: typeof fetch;
    /** 超时毫秒数（默认 15000） */
    timeoutMs?: number;
}

/** 发送中的写载荷：文件名 → 内容；null 表示从 gist 删除该文件（PATCH 语义） */
export type GistFilesPayload = Record<string, string | null>;

/**
 * 将写载荷转换为 GitHub files 对象（字符串 → {content}；null → null 表示删除）
 */
function toFilesPayload(files: GistFilesPayload): Record<string, {content: string} | null> {
    const payload: Record<string, {content: string} | null> = {};
    for (const [name, content] of Object.entries(files)) {
        payload[name] = content === null ? null : {content};
    }
    return payload;
}

const API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15000;
const GIST_URL_PATTERN = /^(?:https?:\/\/)?gist\.github\.com\/(?:[a-zA-Z0-9-]+\/)?([0-9a-f]{32}|[a-zA-Z0-9]{8,32})(?:[\/?#].*)?$/;

/**
 * 从 gist 链接解析 gist id
 * 仅接受 https://gist.github.com/<user>/<id> 或 https://gist.github.com/<id> 形式链接（裸 id 不接受）
 * @param input 链接
 * @returns gist id；无法解析时返回 null
 */
export function parseGistUrl(input: string): string | null {
    const text = (input || "").trim();
    if (!text) return null;
    const match = text.match(GIST_URL_PATTERN);
    return match ? match[1] : null;
}

/**
 * 以 JSON 形式请求 GitHub API 并归一错误
 */
async function requestJson(url: string, init: RequestInit & {headers: Record<string, string>}, options: GistRequestOptions): Promise<any> {
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    const fetchImpl = options.fetchImpl ?? (globalThis.fetch as typeof fetch);

    let response: Response;
    try {
        response = await fetchImpl(url, {...init, signal: abort.signal});
    } catch (error: any) {
        throw new GistApiError("network", error?.name === "AbortError" ? "Network timeout" : "Network error: " + (error?.message ?? String(error)));
    } finally {
        clearTimeout(timer);
    }

    const rateLimitReset = Number(response.headers.get("X-RateLimit-Reset") ?? 0) * 1000;
    if (!response.ok) {
        if (response.status === 401) {
            throw new GistApiError("unauthorized", "GitHub Token is invalid or expired (HTTP 401)", 401);
        }
        if (response.status === 403) {
            // 限流：剩余时间提示；无权则归为 invalid/not-found 语义
            const minutes = rateLimitReset ? Math.max(1, Math.ceil((rateLimitReset - Date.now()) / 60000)) : undefined;
            const suffix = minutes ? ` (retry in about ${minutes} min)` : "";
            throw new GistApiError("rate-limit", options.token ? `GitHub API rate limit reached${suffix}` : `GitHub anonymous API rate limit reached${suffix}`, 403);
        }
        if (response.status === 404) {
            throw new GistApiError("not-found", "Gist does not exist or is not accessible", 404);
        }
        if (response.status === 422) {
            throw new GistApiError("invalid", "GitHub rejected the payload (HTTP 422)", 422);
        }
        throw new GistApiError("server", `GitHub API error (HTTP ${response.status})`, response.status);
    }

    // 响应解析容错：GitHub 偶发 HTML/网关错误页时按网络错误处理
    try {
        return await response.json();
    } catch {
        throw new GistApiError("network", "GitHub returned an unreadable response");
    }
}

/** 公共请求头（Accept/X-GitHub-Api-Version/可选 Authorization） */
function commonHeaders(options: GistRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
    }
    return headers;
}

/**
 * 获取 gist 元数据与文件内容
 * @param gistId gist id
 * @param options 请求选项（公开 gist 可匿名；secret gist 需 Token）
 * @returns gist
 */
export async function getGist(gistId: string, options: GistRequestOptions = {}): Promise<Gist> {
    return requestJson(`${API_BASE}/gists/${encodeURIComponent(gistId)}`, {method: "GET", headers: commonHeaders(options)}, options) as Promise<Gist>;
}

/**
 * 获取文件完整内容（Gist API 对超 1MB 文件截断时经 raw_url 兜底取全文）
 * @param rawUrl 文件 raw_url
 * @param options 请求选项
 * @returns 文件原文
 */
export async function getRawFile(rawUrl: string, options: GistRequestOptions = {}): Promise<string> {
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    const fetchImpl = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
    try {
        const response = await fetchImpl(rawUrl, {signal: abort.signal});
        if (!response.ok) {
            throw new GistApiError("network", `Failed to fetch raw file (HTTP ${response.status})`, response.status);
        }
        return await response.text();
    } catch (error: any) {
        if (error instanceof GistApiError) throw error;
        throw new GistApiError("network", error?.name === "AbortError" ? "Network timeout" : "Network error: " + (error?.message ?? String(error)));
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 新建 gist
 * @param description 描述
 * @param publicGist 是否公开（false = secret，非私有）
 * @param files 文件内容载荷
 * @param options 请求选项（必须带 Token）
 * @returns 新建的 gist
 */
export async function createGist(description: string, publicGist: boolean, files: Record<string, string>, options: GistRequestOptions = {}): Promise<Gist> {
    return requestJson(
        `${API_BASE}/gists`,
        {
            method: "POST",
            headers: commonHeaders(options),
            body: JSON.stringify({description, public: publicGist, files: toFilesPayload(files)}),
        },
        options
    ) as Promise<Gist>;
}

/**
 * 更新 gist（全量镜像：content 写、null 删除；与勾选集一致）
 * @param gistId gist id
 * @param files 文件载荷（null 表示删除该文件）
 * @param options 请求选项（必须带 Token）
 * @returns 更新后的 gist
 */
export async function updateGist(gistId: string, files: GistFilesPayload, options: GistRequestOptions = {}): Promise<Gist> {
    return requestJson(
        `${API_BASE}/gists/${encodeURIComponent(gistId)}`,
        {
            method: "PATCH",
            headers: commonHeaders(options),
            body: JSON.stringify({files: toFilesPayload(files)}),
        },
        options
    ) as Promise<Gist>;
}
