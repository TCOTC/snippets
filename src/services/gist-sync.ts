// Gist 同步编排：Gist 文件 ↔ Snippet[] 映射与导入数据拉取（发布侧见 publish 相关方法）
// 映射规则对应设计文档 docs/gist-sync.md 5.1/5.2：文件名 `<清洗后名称> <片段ID>.<ext>` 携带片段身份。
// 纯映射逻辑（mapGistToImportData）无插件依赖便于单测；服务类仅负责经 Token 服务装配请求。
import {createGist, GistApiError, getGist, getRawFile, updateGist} from "./gist";
import type {Gist, GistFileEntry, GistRequestOptions} from "./gist";
import {buildGistFileName, parseGistFileName} from "../domain/gist-file";
import type {Snippet, SnippetType} from "../types";
import type PluginSnippets from "../index";

/** 导入预览中的单个 gist 文件 */
export interface GistFilePreview {
    /** gist 中的文件名 */
    fileName: string;
    /** 片段名称（文件名去除扩展名/ID 段） */
    name: string;
    /** 文件名携带的片段 ID（无 ID 文件不带） */
    id?: string;
    /** 推断类型（预览框可改） */
    type: SnippetType;
    /** 片段内容（截断文件已经 raw_url 补全） */
    content: string;
    /** 内容是否超过 Gist API 截断阈值 */
    truncated: boolean;
    /** 是否该 gist 的单 JSON conf 特例文件（解析为 Snippet[]） */
    isConf: boolean;
    /** 拉取失败原因（raw 兜底失败时标记并跳过导入） */
    fetchError?: string;
}

/** 从 Gist 拉取后的导入数据（预览对话框输入） */
export interface GistImportData {
    gistId: string;
    gistUrl: string;
    description: string | null;
    public: boolean;
    updatedAt: string;
    /** conf 特例解析出的片段（gist 恰含单个 conf JSON 文件时非空；预览按片段逐条勾选） */
    confSnippets?: Snippet[];
    /** 普通 gist 文件预览列表（conf 特例时仅含该 conf 文件条目） */
    files: GistFilePreview[];
}

/** 判断解析出的 JSON 是否为 conf 片段数组（结构弱校验：含名称/内容/类型） */
export function isSnippetArray(value: unknown): value is Snippet[] {
    if (!Array.isArray(value)) return false;
    return value.every(item =>
        item !== null && typeof item === "object" &&
        typeof (item as any).name === "string" &&
        typeof (item as any).content === "string" &&
        ((item as any).type === "css" || (item as any).type === "js")
    );
}

/**
 * 把 gist 文件映射为片段内容（含 conf 特例识别与截断文件的 raw_url 兜底）
 * @param entry gist 文件条目
 * @param fetchImpl 注入 fetch（raw 兜底用）
 * @returns 文件预览；raw 兜底失败时 fetchError 非空
 */
async function mapGistFileEntry(entry: GistFileEntry, fetchImpl?: typeof fetch): Promise<GistFilePreview> {
    const fileName = entry.filename;
    const parsed = parseGistFileName(fileName);
    let content = entry.content ?? "";
    let truncated = !!entry.truncated;

    // 超过 1MB 的文件 Gist API 截断 content，经 raw_url 取全文；失败则标记跳过
    if (entry.truncated && entry.raw_url) {
        try {
            content = await getRawFile(entry.raw_url, {fetchImpl});
            truncated = false;
        } catch (error) {
            const message = error instanceof GistApiError ? error.message : String(error);
            return {
                fileName,
                name: parsed.name,
                id: parsed.id,
                type: parsed.type,
                content: entry.content ?? "",
                truncated: true,
                isConf: false,
                fetchError: message,
            };
        }
    }

    return {
        fileName,
        name: parsed.name,
        id: parsed.id,
        type: parsed.type,
        content,
        truncated,
        isConf: false,
    };
}

/**
 * 将已获取的 gist 映射为导入数据（无插件依赖，便于单测）
 * @param gist getGist 返回的 gist
 * @param fetchImpl 注入 fetch（超限文件 raw 兜底）
 * @returns 导入数据
 */
export async function mapGistToImportData(gist: Gist, fetchImpl?: typeof fetch): Promise<GistImportData> {
    const entries = Object.values(gist.files).filter(entry => entry && typeof entry.filename === "string");
    const base: GistImportData = {
        gistId: gist.id,
        gistUrl: gist.html_url,
        description: gist.description,
        public: gist.public,
        updatedAt: gist.updated_at,
        files: [],
    };

    // conf 特例：仅当 gist 恰好含一个 .json 文件且内容解析为片段数组时识别
    if (entries.length === 1) {
        const only = entries[0];
        const ext = (only.filename.toLowerCase().match(/\.(\w+)$/)?.[1]) ?? "";
        if (ext === "json") {
            const content = only.content ?? "";
            try {
                const parsed = JSON.parse(content);
                if (isSnippetArray(parsed)) {
                    base.confSnippets = parsed;
                    base.files = [{
                        fileName: only.filename,
                        name: only.filename.replace(/\.json$/i, ""),
                        type: "css", // 占位：conf 特例走 confSnippets 列表，文件条目仅作展示
                        content,
                        truncated: !!only.truncated,
                        isConf: true,
                    }];
                    return base;
                }
            } catch {
                // 不是合法 JSON：按普通文件处理（不在此提示，预览表格可查看）
            }
        }
    }

    // 普通多文件 gist：逐文件映射
    base.files = await Promise.all(entries.map(entry => mapGistFileEntry(entry, fetchImpl)));
    return base;
}

/**
 * Gist 同步服务（拉取/导入编排；发布侧实现见发布里程碑）
 */
export class GistSyncService {
    private readonly plugin: PluginSnippets;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 按用户输入（链接或 id）拉取并映射 gist 为导入数据
     * @param input gist 链接或 id
     * @param fetchImpl 注入 fetch（单测用；默认全局）
     * @returns 导入数据；gist 不存在/无权/网络异常时抛 GistApiError
     */
    async fetchImportData(input: string, fetchImpl?: typeof fetch): Promise<GistImportData> {
        const options: GistRequestOptions = {fetchImpl};
        const token = this.plugin.gistTokenService.token;
        if (token) {
            options.token = token;
        }
        const gist = await getGist(input, options);
        return mapGistToImportData(gist, fetchImpl);
    }

    /**
     * 读取上次发布的 gist 状态（发布目标记忆；不随 plugin-config.json 同步）
     */
    async loadPublishState(): Promise<GistPublishState | undefined> {
        try {
            await this.plugin.loadData(PUBLISH_STATE_FILE);
            const state = this.plugin.data[PUBLISH_STATE_FILE];
            return state && typeof state === "object" && typeof state.gistId === "string"
                ? state as GistPublishState
                : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * 写入上次发布的 gist 状态
     */
    async savePublishState(state: GistPublishState): Promise<void> {
        await this.plugin.saveData(PUBLISH_STATE_FILE, state);
    }

    /**
     * 发布勾选集到 Gist（新建或更新镜像）
     * @param options 发布参数（target：新建（可见性）/ 更新（gist id））
     * @param fetchImpl 注入 fetch（单测用）
     * @returns 发布后的 gist；未配置 Token / 网络失败时抛 GistApiError
     */
    async publishToGist(options: GistPublishOptions, fetchImpl?: typeof fetch): Promise<Gist> {
        const token = this.plugin.gistTokenService.token;
        if (!token) {
            throw new GistApiError("unauthorized", "GitHub Token is not configured");
        }
        const rows = buildPublishFiles(options.snippets);
        const files: Record<string, string> = {};
        for (const row of rows) {
            files[row.fileName] = row.content;
        }

        let gist: Gist;
        if (options.target.kind === "create") {
            gist = await createGist(options.description ?? "", options.target.publicGist, files, {token, fetchImpl});
        } else {
            // 更新：先拉取现有 gist 计算文件载荷（保留同 ID 片段重命名；未勾选的旧文件删除）
            const existing = await getGist(options.target.gistId, {token, fetchImpl});
            const payload = planUpdateFiles(existing, rows);
            gist = await updateGist(options.target.gistId, payload, {token, fetchImpl});
        }

        // 记录发布目标（仅用于下次发布默认更新对象）
        await this.savePublishState({
            gistId: gist.id,
            public: gist.public,
            publishedAt: new Date().toISOString(),
            fileCount: Object.keys(gist.files).length,
            snippetCount: options.snippets.length,
        });
        return gist;
    }
}

/** 上次发布的 gist 状态文件键（独立存储，不进入 plugin-config.json） */
export const PUBLISH_STATE_FILE = "gist-publish-state.json";

/** 上次发布的 gist 状态（发布目标记忆） */
export interface GistPublishState {
    gistId: string;
    public: boolean;
    publishedAt: string;
    fileCount: number;
    snippetCount: number;
}

/** 发布目标：新建（含可见性）或更新既有 gist */
export type GistPublishTarget =
    | {kind: "create"; publicGist: boolean}
    | {kind: "update"; gistId: string};

/** 发布参数 */
export interface GistPublishOptions {
    target: GistPublishTarget;
    /** 描述（新建时写入；更新时不修改已有描述） */
    description?: string;
    /** 勾选的片段集合 */
    snippets: Snippet[];
}

/** Gist 单个文件大小上限（GitHub 超限会截断静默失败，发布前拦截） */
export const GIST_MAX_FILE_SIZE = 1024 * 1024;

/** Gist 文件总数上限 */
export const GIST_MAX_FILES = 300;

/** 待发布的文件行 */
export interface PublishFileRow {
    fileName: string;
    content: string;
}

/** 发布前校验结果（null = 通过；否则为错误标识） */
export type PublishValidationError = "too-large" | "too-many" | null;

/**
 * 发布前校验：单文件超 1MB / 文件总数超 300 时拒绝
 */
export function validatePublishSnippets(snippets: Snippet[]): PublishValidationError {
    if (snippets.length > GIST_MAX_FILES) {
        return "too-many";
    }
    for (const snippet of snippets) {
        if (snippet.content.length > GIST_MAX_FILE_SIZE) {
            return "too-large";
        }
    }
    return null;
}

/**
 * 把片段集合映射为待发布文件（文件名 `<清洗后名称> <ID>.<ext>`；同名冲突追加序号后缀）
 * 片段名不同但清洗后相同的场景（如 a/b 与 a:b）会得到不同后缀文件，避免互相覆盖。
 */
export function buildPublishFiles(snippets: Snippet[]): PublishFileRow[] {
    const seen = new Set<string>();
    return snippets.map(snippet => {
        const baseName = snippet.name || "snippet";
        let fileName = buildGistFileName(baseName, snippet.id, snippet.type);
        let counter = 1;
        while (seen.has(fileName)) {
            fileName = buildGistFileName(`${baseName} (${++counter})`, snippet.id, snippet.type);
        }
        seen.add(fileName);
        return {fileName, content: snippet.content};
    });
}

/**
 * 计算更新 gist 的文件载荷（镜像语义）：
 * - 勾选集内的片段：写入其 `文件名（含 ID 段）→ 内容`；
 * - gist 现有文件中与勾选片段同 ID 但文件名不同（改名场景）：旧文件名置 null 删除（GitHub PATCH 重命名）；
 * - gist 现有其它文件（未勾选）：置 null 删除，保证 gist 与勾选集一致（幂等镜像）。
 * @param existing 现有 gist
 * @param rows 本次将写入的文件行
 * @returns PATCH files 载荷（字符串 → 新内容；null → 删除）
 */
export function planUpdateFiles(existing: Gist, rows: PublishFileRow[]): Record<string, string | null> {
    const incomingFileNames = new Set(rows.map(row => row.fileName));
    const incomingIds = new Set(rows.map(row => parseGistFileName(row.fileName).id).filter(Boolean) as string[]);
    const payload: Record<string, string | null> = {};

    for (const existingFileName of Object.keys(existing.files)) {
        if (incomingFileNames.has(existingFileName)) {
            // 同名（含同 ID）文件：由行写入覆盖更新，无需显式删除
            continue;
        }
        const existingId = parseGistFileName(existingFileName).id;
        if (existingId && incomingIds.has(existingId)) {
            // 同 ID 改名：删除旧文件名，新文件名随行写入（GitHub 表现为文件重命名）
            payload[existingFileName] = null;
        } else {
            // 未勾选（或不再属于本批）的旧文件：镜像删除
            payload[existingFileName] = null;
        }
    }
    for (const row of rows) {
        payload[row.fileName] = row.content;
    }
    return payload;
}
