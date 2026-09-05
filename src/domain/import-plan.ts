// 导入三模式（merge/overwrite/fork）规划纯逻辑（无插件/宿主依赖，便于单测）
// 语义对应设计文档 docs/gist-sync.md 5.4：
// - merge（合并更新，默认）：带 ID 且本地同 ID → 更新 name/content/type，保留本地 enabled 与排序；
//   本地无此 ID 或文件无 ID → 作为新增片段（保留/生成 ID，置于列表前部）；本地独有保留。
// - overwrite（覆盖镜像）：以导入集合整体替换本地（enabled 等字段以导入对象为准）。
// - fork（仅新增）：忽略文件名的 ID，全部重生成 ID 作为新片段导入（本地独有保留）。
// 注：新增片段是否默认不启用由映射层决定（enabled=false），本模块不改动字段。
import type {Snippet} from "../types";
import {deepClone} from "./snippet";

/** 导入模式 */
export type ImportMode = "merge" | "overwrite" | "fork";

/** 导入规划结果 */
export interface ImportPlan {
    /** 落库用最终列表（merge/fork 含本地原样项；overwrite 仅为导入集合） */
    list: Snippet[];
    /** 新增片段计数 */
    addedCount: number;
    /** 更新片段计数（仅 merge 有意义） */
    updatedCount: number;
}

/**
 * 规划导入后的片段列表
 * @param localSnippets 本地当前列表
 * @param importedSnippets 导入片段（映射层已保证均携带 id）
 * @param mode 导入模式（见 ImportMode）
 * @param genId 新 ID 生成器（须返回不与既有列表冲突的 id；node 环境注入桩）
 * @returns 落库列表与新增/更新计数
 */
export function planImport(localSnippets: Snippet[], importedSnippets: Snippet[], mode: ImportMode, genId: () => string): ImportPlan {
    if (mode === "overwrite") {
        // 覆盖镜像：以导入集合为唯一事实源（含 enabled/disabledInPublish 等全部字段）
        const list = deepClone(importedSnippets);
        return {list, addedCount: list.length, updatedCount: 0};
    }

    if (mode === "fork") {
        // 仅新增：全部忽略远端 ID 重新生成（他人片段变为本地独立的一份）
        const forked: Snippet[] = [];
        const usedIds = new Set(localSnippets.map(snippet => snippet.id));
        for (const snippet of importedSnippets) {
            const clone = deepClone(snippet);
            let newId = genId();
            while (usedIds.has(newId)) {
                newId = genId();
            }
            usedIds.add(newId);
            clone.id = newId;
            forked.push(clone);
        }
        return {list: [...forked, ...deepClone(localSnippets)], addedCount: forked.length, updatedCount: 0};
    }

    // merge：同 ID 更新（保留本地 enabled 与排序），其余作为新增置于列表前部
    const merged = deepClone(localSnippets);
    const localById = new Map(merged.map(snippet => [snippet.id, snippet]));
    const seenIds = new Set(merged.map(snippet => snippet.id));
    const additions: Snippet[] = [];
    let addedCount = 0;
    let updatedCount = 0;

    for (const incoming of importedSnippets) {
        const localMatch = incoming.id ? localById.get(incoming.id) : undefined;
        if (localMatch) {
            // 远端提供代码内容与名称，本地保留运行偏好（enabled/disabledInPublish）与排列位置
            localMatch.name = incoming.name;
            localMatch.content = incoming.content;
            localMatch.type = incoming.type;
            updatedCount++;
        } else {
            const addition = deepClone(incoming);
            // 带 ID 且不与本地/已新增冲突时保留远端 ID（跨端识别同一片段的关键）；否则生成
            if (!addition.id || seenIds.has(addition.id)) {
                let newId = genId();
                while (seenIds.has(newId)) {
                    newId = genId();
                }
                addition.id = newId;
            }
            seenIds.add(addition.id);
            additions.push(addition);
            addedCount++;
        }
    }

    return {list: [...additions, ...merged], addedCount, updatedCount};
}
