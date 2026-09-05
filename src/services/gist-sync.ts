// Gist 同步编排：Gist 文件 ↔ Snippet[] 映射与导入数据拉取（发布侧见 publish 相关方法）
// 映射规则对应设计文档 docs/gist-sync.md 5.1/5.2：文件名 `<清洗后名称> <片段ID>.<ext>` 携带片段身份。
// 纯映射逻辑（mapGistToImportData）无插件依赖便于单测；服务类仅负责经 Token 服务装配请求。
import {GistApiError, getGist, getRawFile} from "./gist";
import type {Gist, GistFileEntry, GistRequestOptions} from "./gist";
import {parseGistFileName} from "../domain/gist-file";
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
}
