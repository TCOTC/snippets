// 代码片段分组持久化服务
// 职责：分组元数据以独立文件持久化（loadData/saveData 键 PLUGIN_GROUPS_STORAGE_NAME，
// 文件 data/storage/petal/snippets/plugin-groups.json），与 plugin-config.json 并列但独立——
// 分组是用户数据而非配置 UI 偏好，不参与 ConfigService 的 valueItems/persistConfig 路径，
// 避免被配置热应用覆盖（与 gist-token/gist-publish-state 的"独立状态文件"同款约束）。
// 分组文件不含片段代码原文、不含折叠状态（折叠是视图偏好，存 localStorage），
// 仅含分组 id/type/name/snippetIds（成员 id 集合），代码仍在内核权威片段列表。
// 读取时经 domain/snippet-groups.ts reconcileGroups 与权威片段列表对账（孤儿 id 剔除）。
import type PluginSnippets from "../index";
import type {Snippet} from "../types";
import {isSnippetGroupArray, reconcileGroups, SnippetGroup} from "../domain/snippet-groups";

/** 分组持久化文件名（loadData/saveData 存储键） */
export const PLUGIN_GROUPS_STORAGE_NAME = "plugin-groups.json";

/**
 * 分组持久化服务
 * groups 为会话缓存（snippetGroupsList 同名同义），菜单打开时经 load() 从内核拉取权威数据；
 * 每次分组变更后调用 save() 落盘（内核 storage 写入触发跨实例推送，其他窗口经 onDataChanged
 * 覆盖 reload 分组缓存，见 index.ts）。
 */
export class SnippetGroupStore {
    private readonly plugin: PluginSnippets;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 从内核拉取分组文件并返回内容（loadData 同步插件 data；无文件时为空串）
     */
    private async loadStoredGroups(): Promise<any> {
        await this.plugin.loadData(PLUGIN_GROUPS_STORAGE_NAME);
        return this.plugin.data[PLUGIN_GROUPS_STORAGE_NAME];
    }

    /**
     * 写入分组文件
     * @param groups 分组集合
     * @returns saveData 的响应（内核 { code, msg }）
     */
    private async saveStoredGroups(groups: SnippetGroup[]): Promise<any> {
        return this.plugin.saveData(PLUGIN_GROUPS_STORAGE_NAME, groups);
    }

    /**
     * 加载分组缓存（与权威片段列表对账后缓存到内存）。
     * 内核文件不存在/损坏时回退为空并缓存，不阻断调用方。
     * @param snippets 权威片段列表（对账用）
     */
    async load(snippets: Snippet[]): Promise<void> {
        const stored = await this.loadStoredGroups();
        this.groups = isSnippetGroupArray(stored) ? reconcileGroups(stored, snippets) : [];
    }

    /**
     * 持久化当前分组缓存（变更后调用；失败时保持内存态，不抛错）
     */
    async save(): Promise<void> {
        try {
            await this.saveStoredGroups(this.groups);
        } catch (error) {
            this.plugin.console.error("save snippet groups failed:", error);
        }
    }

    /**
     * 会话分组缓存（写入经统一 save() 落盘；读取方按需 read 或直接引用）
     */
    groups: SnippetGroup[] = [];
}
