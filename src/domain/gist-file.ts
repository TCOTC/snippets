// Gist 文件名 ↔ 代码片段映射纯逻辑（无插件/宿主依赖，便于单测）
// 文件命名约定（设计文档 docs/gist-sync.md D11）：
// 发布侧 `<清洗后名称> <片段ID>.<ext>`，例：`我的样式 20250813161014-se1mend.css`
// 片段 ID 为思源 Lute.NewNodeID 形态（14 位时间戳 + "-" + 7 位小写字母数字）。
import type {SnippetType} from "../types";

/** 思源片段 ID 段形态（文件名中承载片段身份的识别段） */
export const SNIPPET_ID_PATTERN = "\\d{14}-[a-z0-9]{7}";

/** 片段类型到 gist 文件扩展名 */
const TYPE_EXTENSIONS: Record<SnippetType, string> = {
    css: ".css",
    js: ".js",
};

/** gist 文件扩展名 → 片段类型（js 相关扩展统一映射为 js） */
const EXTENSION_TYPES: Record<string, SnippetType> = {
    ".css": "css",
    ".js": "js",
    ".mjs": "js",
    ".cjs": "js",
};

/** 名称清洗非法字符（文件系统与 GitHub gist 文件名均不允许，统一替换为 -） */
const ILLEGAL_CHARS = /[\\/:*?"<>|]/g;

/** 文件名整体建议上限（含 ID 段与扩展名） */
export const GIST_FILE_NAME_MAX = 80;

/**
 * 从文件名提取片段身份与类型
 * 匹配 `<名称> <ID>.<css|js|mjs|cjs>` 且 ID 段落在文件末尾（紧邻扩展名）：提取成功则携带片段 ID；
 * 其余文件名（旧 gist / 手工整理的 gist）只解析名称与类型，不带 ID（导入时按新增处理，不做猜测性覆盖）。
 * @param fileName gist 文件名
 * @returns 名称（去扩展名）、推断类型、携带的片段 ID（无则 undefined）
 */
export function parseGistFileName(fileName: string): {name: string; type: SnippetType; id?: string} {
    // 带 ID：名称与 ID 段之间以一个空格分隔
    const withId = fileName.match(new RegExp(`^(.*) (${SNIPPET_ID_PATTERN})\\.(css|js|mjs|cjs)$`));
    if (withId) {
        const ext = "." + withId[3].toLowerCase();
        return {
            name: withId[1],
            type: EXTENSION_TYPES[ext] ?? "css",
            id: withId[2],
        };
    }
    // 不带 ID：仅按扩展名推断类型，名称取去扩展名后的完整文件名
    const lastDot = fileName.lastIndexOf(".");
    const ext = lastDot === -1 ? "" : fileName.slice(lastDot).toLowerCase();
    const name = lastDot === -1 ? fileName : fileName.slice(0, lastDot);
    return {
        name: name || "snippet",
        type: EXTENSION_TYPES[ext] ?? "css",
    };
}

/**
 * 清洗片段名称以用作 gist 文件名（保留不可分割的 ID 段由 buildGistFileName 拼接）
 * @param name 片段名称
 * @returns 清洗后名称（非法字符替换为 -、去除首尾空白与点、为 ID 段与扩展名预留长度；空则回退 snippet）
 */
export function sanitizeGistFileName(name: string): string {
    // 控制字符（<32）逐字符替换为 -（不用正则字面量，规避 no-control-regex）
    let sanitized = (name || "").trim().split("").map(char => char.charCodeAt(0) < 32 ? "-" : char).join("");
    sanitized = sanitized.replace(ILLEGAL_CHARS, "-");
    // 去除首尾的点（避免隐藏文件语义与解析歧义）
    sanitized = sanitized.replace(/^\.+|\.+$/g, "");
    // 保留名称中段的连续点，仅收尾空白转 -（trim 已处理首尾，这里处理内部换行等）
    sanitized = sanitized.replace(/\s+/g, " ").trim();
    if (!sanitized) {
        return "snippet";
    }
    // 名称末尾恰与 ID 段形态相撞（如用户把 ID 直接写进名字）时追加 - 避免解析歧义
    if (new RegExp(`${SNIPPET_ID_PATTERN}$`).test(sanitized)) {
        sanitized += "-";
    }
    return sanitized;
}

/**
 * 构建发布用的 gist 文件名（`<清洗后名称> <片段ID>.<ext>`）
 * @param name 片段名称（可为空）
 * @param id 片段 ID（不可清洗、不可截断，承载片段身份）
 * @param type 片段类型（决定扩展名）
 * @returns gist 文件名
 */
export function buildGistFileName(name: string, id: string, type: SnippetType): string {
    // 预留「 空格 + ID 段 + 扩展名」长度后截断名称部分，保证整名不超建议上限
    const reserved = id.length + 1 + TYPE_EXTENSIONS[type].length;
    const sanitized = sanitizeGistFileName(name).slice(0, Math.max(1, GIST_FILE_NAME_MAX - reserved));
    // 截断可能把 ID 形态的尾部削到不完整，无歧义影响；截断后可能以空格结尾，统一处理
    return `${sanitized.replace(/\s+$/, "")} ${id}${TYPE_EXTENSIONS[type]}`;
}
