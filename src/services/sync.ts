import type {Snippet, SnippetType} from "../types";

/**
 * 跨窗口广播协议（services 层，阶段 3 地基）
 * 广播信封统一为 { type, windowId, timestamp, ...payload }，由发送方（PluginSnippets.broadcastMessage）自动附加。
 * 硬性约束：payload 不得携带代码片段 content 原文（可能含敏感信息）；唯一豁免为 CSS 编辑中实时预览
 * （snippet_element_update 且 previewState: true，内容未保存、接收窗口无法自拉）。
 */

/**
 * 广播通道名称
 */
export const BROADCAST_CHANNEL_NAME = "snippets-plugin-sync";

/** 窗口保活消息载荷（window_online / window_online_feedback / window_offline） */
export interface WindowOnlinePayload {
    windowId: string;
    timestamp: number;
}

/** 切换代码片段开关状态载荷 */
export interface SnippetTogglePayload {
    snippetId: string;
    enabled: boolean;
}

/** 切换代码片段发布服务开关状态载荷（enabled 即 disabledInPublish，与现有代码语义保持一致） */
export interface SnippetTogglePublishPayload {
    snippetId: string;
    enabled: boolean;
}

/** 切换全局开关状态载荷 */
export interface SnippetToggleGlobalPayload {
    snippetType: SnippetType;
    enabled: boolean;
    previewingSnippetIds: string[];
}

/** 保存代码片段载荷（已去原文化，不含 content，接收方按 snippetId 自拉权威数据） */
export interface SnippetSavePayload {
    snippetId: string;
    isCopy: boolean;
    copySnippetId?: string;
}

/** 删除代码片段载荷 */
export interface SnippetDeletePayload {
    snippetId: string;
    snippetType: SnippetType;
    previewState: boolean;
}

/**
 * 更新注入元素载荷
 * previewState 为 true（CSS 编辑中预览）：携带 snippet 原文（豁免禁原文，内容未保存无法自拉）；
 * previewState 为 false（退出预览）：只携带 snippetId，接收方自拉已保存片段恢复。
 */
export interface SnippetElementUpdatePayload {
    snippet?: Snippet;
    snippetId?: string;
    previewState?: boolean;
}

/** 移除注入元素载荷 */
export interface SnippetElementRemovePayload {
    snippetId: string;
    snippetType: SnippetType;
}

/** 应用插件配置载荷（跨窗口同步插件配置用） */
export interface SettingApplyPayload {
    config: Record<string, unknown>;
}

/**
 * 全部广播消息（含信封公共字段）联合类型
 * 接收方 handleBroadcastMessage 按 type 分发到对应 handler。
 */
export type SnippetBroadcastMessage =
    | ({type: "window_online"} & WindowOnlinePayload)
    | ({type: "window_online_feedback"} & WindowOnlinePayload)
    | ({type: "window_offline"} & WindowOnlinePayload)
    | ({type: "snippet_toggle"} & SnippetTogglePayload)
    | ({type: "snippet_toggle_publish"} & SnippetTogglePublishPayload)
    | ({type: "snippet_toggle_global"} & SnippetToggleGlobalPayload)
    | ({type: "snippet_save"} & SnippetSavePayload)
    | ({type: "snippet_delete"} & SnippetDeletePayload)
    | ({type: "snippet_element_update"} & SnippetElementUpdatePayload)
    | ({type: "snippet_element_remove"} & SnippetElementRemovePayload)
    | {type: "snippets_sort"} // 排序消息无载荷，接收方全量重拉列表
    | ({type: "setting_apply"} & SettingApplyPayload);
