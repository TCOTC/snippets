// 插件视图偏好持久化（思源内核 localStorage API）
// 职责：把菜单折叠状态、上次代码片段类型这类"视图偏好"经内核 localStorage 端点读写——
//   - 读取：/api/storage/getLocalStorageVals（请求式，打开菜单时与片段列表并发拉取）；
//   - 写入：/api/storage/setLocalStorageVals（写后由内核广播给其他会话，跨窗口一致）；
//   - 卸载：/api/storage/removeLocalStorageVals（值存于思源本地存储而非插件数据目录，
//     卸载时不会随 removeData 删除，须显式移除）。
// 与"插件数据文件"(loadData/saveData, plugin-groups.json / plugin-config.json) 不同：
// 本地存储是键值视图偏好，不走 data/storage/petal 目录，也不触发 PushPluginStorageDataChanged。
import type PluginSnippets from "../index";
import {fetchPostPromise} from "../utils";
import type {SnippetType} from "../types";

/** 插件视图偏好统一本地存储键（值为一个完整 JSON 对象，含折叠映射与上次类型） */
export const UI_STATE_LOCAL_KEY = "jcsm-uiState";

/** 打开的菜单可恢复的视图偏好（单键序列化的完整对象） */
export interface SnippetUiState {
    /** 折叠映射（键 "<type>.<groupId>"；仅记录折叠为 true 的项，缺省视为展开） */
    groupCollapsed?: Record<string, boolean>;
    /** 上次代码片段类型 */
    snippetsType?: SnippetType;
}

/**
 * 插件视图偏好持久化服务
 * 折叠状态与上次类型合并存于一个本地存储键（值为完整 SnippetUiState JSON 对象）；
 * 会话缓存字段仅供本插件同步读写，打开菜单时经 load() 从内核拉取权威值。
 */
export class SnippetUiStorage {
    private readonly plugin: PluginSnippets;

    /**
     * 折叠映射缓存（键 "<css|js>.<分组id|default>"；仅记录折叠为 true 的项，缺省视为展开）
     */
    groupCollapsed: Record<string, boolean> = {};

    /**
     * 上次切换的代码片段类型缓存（打开菜单时从内核拉取覆盖）
     */
    snippetsType: SnippetType | undefined;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 从内核本地存储拉取视图偏好（单键完整对象）并写入会话缓存（折叠状态 + 上次类型）。
     * 请求失败或值非法时保持缓存现状（不阻断菜单打开）。
     */
    async load(): Promise<void> {
        try {
            // 单键读取：getLocalStorageVal 把该键的值直接放在 data（无需再按键索引），
            // 键不存在时 data 为空，视为无历史偏好
            const response = await fetchPostPromise("/api/storage/getLocalStorageVal", {
                key: UI_STATE_LOCAL_KEY,
            });
            const state = response?.data;
            if (state && typeof state === "object") {
                if (state.groupCollapsed && typeof state.groupCollapsed === "object") {
                    this.groupCollapsed = { ...state.groupCollapsed };
                }
                if (state.snippetsType === "css" || state.snippetsType === "js") {
                    this.snippetsType = state.snippetsType;
                }
            }
        } catch (error) {
            this.plugin.console.error("load snippet ui state failed:", error);
        }
    }

    /**
     * 更新折叠映射缓存并整体落库（单键完整对象，类型字段保留缓存当前值）
     * @param collapsed 折叠映射
     */
    async saveGroupCollapsed(collapsed: Record<string, boolean>): Promise<void> {
        this.groupCollapsed = { ...collapsed };
        await this.persist();
    }

    /**
     * 更新上次类型缓存并整体落库（单键完整对象，折叠字段保留缓存当前值）
     * @param snippetType 代码片段类型
     */
    async saveSnippetsType(snippetType: SnippetType): Promise<void> {
        this.snippetsType = snippetType;
        await this.persist();
    }

    /**
     * 把当前视图偏好（折叠 + 类型）作为一个完整对象写入内核本地存储的单一键
     */
    private async persist(): Promise<void> {
        try {
            await fetchPostPromise("/api/storage/setLocalStorageVal", {
                key: UI_STATE_LOCAL_KEY,
                val: {
                    groupCollapsed: this.groupCollapsed,
                    snippetsType: this.snippetsType,
                },
            });
        } catch (error) {
            this.plugin.console.error("save snippet ui state failed:", error);
        }
    }

    /**
     * 移除插件写入的本地存储项（卸载插件时调用；本地存储不在插件数据目录，须显式清理）
     */
    async clear(): Promise<void> {
        try {
            await fetchPostPromise("/api/storage/removeLocalStorageVal", {
                key: UI_STATE_LOCAL_KEY,
            });
        } catch (error) {
            this.plugin.console.error("clear snippet ui state failed:", error);
        }
    }
}
