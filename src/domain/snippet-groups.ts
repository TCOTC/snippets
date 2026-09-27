// 代码片段分组纯领域逻辑（无 DOM / 无插件依赖，全部可单测）
// 分组模型：分组归属与内核片段记录（id/name/content/type/enabled/disabledInPublish）解耦，
// 另存于独立持久化文件（见 services/snippet-groups.ts）。每个分组带：
//   - type：片段类型（css | js），分组按类型各自独立（与菜单 CSS/JS 分区正交，同名不同型互不干扰）；
//   - snippetIds：组成员 id 有序集合（组内顺序的权威来源，拖拽调整即重排本数组）；
//   - 分组顺序由外层 groups 数组顺序表达（空组也可存在）。
// 未分组片段 = 列表中未被任何同类型分组引用的片段（不落盘，读取时由 reconcile 推导）。
// 分组间的顺序同样存于 groups 数组；未分组在组序中的位置用一个"占位分组"表达
// （id 固定为 UNGROUPED_GROUP_ID，type 区分 CSS/JS 各一个，snippetIds 恒为空、不记录成员），
// 使组头拖拽排序能把"未分组"当作普通分组移动位置。
// 对账原则（防御其他插件改动内核片段 id / 删除片段）：引用不存在的 id 直接剔除；
// 真实存在但未引用的片段永远显示在未分组，绝不丢失（issue#20 讨论中"只保证不丢"原则）。
import type {Snippet, SnippetType} from "../types";

/**
 * 代码片段分组（与内核片段记录解耦的分组元数据）
 */
export interface SnippetGroup {
    /** 分组 id */
    id: string;
    /** 分组归属的片段类型（分组按类型独立） */
    type: SnippetType;
    /** 分组显示名 */
    name: string;
    /** 组成员片段 id（有序，组内顺序权威来源） */
    snippetIds: string[];
}

/** 未分组占位分组的固定 id（仅表达"未分组"在组序中的位置，绝不记录成员） */
export const UNGROUPED_GROUP_ID = "default";

/**
 * 是否为未分组占位分组（占位组 name 恒空、snippetIds 恒空，不参与真实分组语义）
 * @param group 分组
 * @returns 是否为未分组占位分组
 */
export function isUngroupedGroup(group: SnippetGroup): boolean {
    return group.id === UNGROUPED_GROUP_ID;
}

/**
 * 分组集合中是否存在至少一个真实分组（排除未分组占位）
 * @param groups 分组集合
 * @returns 是否存在真实分组
 */
export function hasRealGroups(groups: SnippetGroup[]): boolean {
    return groups.some(group => !isUngroupedGroup(group));
}

/**
 * 对分组集合补齐/清理未分组占位分组
 * - 某类型存在真实分组但缺占位：追加占位（未分组初始排在该类型所有组之后）；
 * - 某类型只有占位（真实分组被删光）：移除该占位，使菜单可回到平铺；
 * - 真实分组之间已排好的占位（被用户拖到中间）保持原位置不动。
 * 返回全新的有序分组数组，不影响入参。
 * @param groups 分组集合
 * @returns 补齐/清理后的分组集合
 */
export function withUngroupedAnchors(groups: SnippetGroup[]): SnippetGroup[] {
    if (!Array.isArray(groups)) return [];
    const result: SnippetGroup[] = [];
    (["css", "js"] as SnippetType[]).forEach(type => {
        const seq = groups.filter(group => group.type === type);
        const realGroups = seq.filter(group => !isUngroupedGroup(group));
        if (realGroups.length === 0) {
            // 无真实分组：丢弃可能残留的占位（菜单据此回平铺）
            return;
        }
        const hasAnchor = seq.some(group => isUngroupedGroup(group));
        if (hasAnchor) {
            // 保序：真实分组与占位维持现有相对顺序（占位可能被用户拖到中间）
            result.push(...seq);
        } else {
            // 缺占位：真实分组在前，占位追加到末尾（未分组默认排在各组之后）
            result.push(...realGroups, {id: UNGROUPED_GROUP_ID, type, name: "", snippetIds: []});
        }
    });
    return result;
}

/**
 * 在同一类型内移动分组（含未分组占位）的相对位置（组间拖拽排序用）。
 * 移动后该类型分组保持相对顺序，仅被移动组改变位置；其他类型分组整体保持在前，
 * 具体相对顺序由分组文件 groups 数组表达（菜单按类型分区独立渲染，跨类型位置无影响）。
 * @param groups 分组集合
 * @param snippetType 片段类型
 * @param groupId 被移动分组 id（可为未分组占位）
 * @param targetGroupId 目标分组 id（可为未分组占位）
 * @param isTop 是否移动到目标分组上方
 * @returns 处理后的分组集合（无有效移动时返回原样副本）
 */
export function moveGroup(groups: SnippetGroup[], snippetType: SnippetType, groupId: string, targetGroupId: string, isTop: boolean): SnippetGroup[] {
    const others = groups.filter(group => group.type !== snippetType);
    const seq = groups.filter(group => group.type === snippetType);
    const from = seq.findIndex(group => group.id === groupId);
    if (from < 0) return cloneGroups(groups);
    let to = seq.findIndex(group => group.id === targetGroupId);
    if (to < 0 || from === to) return cloneGroups(groups);
    const [moved] = seq.splice(from, 1);
    // 移除被移动组后重算目标索引（被移动组在目标之前时目标位置前移一位）
    to = seq.findIndex(group => group.id === targetGroupId);
    const insertIndex = isTop ? to : to + 1;
    seq.splice(insertIndex, 0, moved);
    return [...others, ...seq];
}

/**
 * 深拷贝分组集合（结构化复制，供纯函数返回新集合）
 * @param groups 分组集合
 * @returns 深拷贝副本
 */
export function cloneGroups(groups: SnippetGroup[]): SnippetGroup[] {
    return groups.map(group => ({ ...group, snippetIds: [...group.snippetIds] }));
}

/**
 * 校验分组数据形状是否合法（防御持久化文件损坏/外来数据）
 * @param value 待校验数据
 * @returns 是否为合法的分组数组
 */
export function isSnippetGroupArray(value: unknown): value is SnippetGroup[] {
    if (!Array.isArray(value)) return false;
    return value.every((group: unknown) => {
        if (typeof group !== "object" || group === null) return false;
        const g = group as Partial<SnippetGroup>;
        return (
            typeof g.id === "string" && g.id.length > 0 &&
            (g.type === "css" || g.type === "js") &&
            typeof g.name === "string" &&
            Array.isArray(g.snippetIds) && g.snippetIds.every((id: unknown) => typeof id === "string")
        );
    });
}

/**
 * 对账分组集合与权威片段列表
 * - 剔除 group.snippetIds 中在列表中不存在的片段 id（被其他插件删除/改 id）；
 * - 剔除非法分组（id/type/name/snippetIds 形状不合法）；
 * - 保留空组与未命名组（name 允许空串，仅在显示层占位回退），不做静默合并；
 * - 返回全新的有序分组数组，不影响入参。
 * @param groups 持久化的分组集合
 * @param snippets 权威片段列表（以片段 id 为准）
 * @returns 对账后的分组集合
 */
export function reconcileGroups(groups: SnippetGroup[], snippets: Snippet[]): SnippetGroup[] {
    if (!isSnippetGroupArray(groups)) return [];
    const validIds = new Set(snippets.map(snippet => snippet.id));
    const result: SnippetGroup[] = [];
    for (const group of groups) {
        // 组内 id 去重（防御数据损坏导致同一片段重复引用）
        const seen = new Set<string>();
        const snippetIds: string[] = [];
        for (const id of group.snippetIds) {
            if (!validIds.has(id) || seen.has(id)) continue;
            seen.add(id);
            snippetIds.push(id);
        }
        result.push({ id: group.id, type: group.type, name: group.name, snippetIds });
    }
    return result;
}

/**
 * 获取某类型下未分组（不在任何同类型分组中）的片段 id 集合
 * @param groups 分组集合
 * @param snippets 权威片段列表
 * @param snippetType 片段类型
 * @returns 未分组片段 id（按片段在列表中的顺序）
 */
export function ungroupedSnippetIds(groups: SnippetGroup[], snippets: Snippet[], snippetType: SnippetType): string[] {
    const referenced = new Set<string>();
    groups.forEach(group => {
        if (group.type !== snippetType) return;
        group.snippetIds.forEach(id => referenced.add(id));
    });
    return snippets.filter(snippet => snippet.type === snippetType && !referenced.has(snippet.id)).map(snippet => snippet.id);
}

/**
 * 查找片段所属的分组（片段未分组时返回 undefined）
 * @param groups 分组集合
 * @param snippetId 片段 id
 * @returns 所属分组（跨类型唯一性由 reconcile 保证每个 id 只在一个分组内）
 */
export function findGroupBySnippetId(groups: SnippetGroup[], snippetId: string): SnippetGroup | undefined {
    return groups.find(group => group.snippetIds.includes(snippetId));
}

/**
 * 查找某类型的某个分组（按分组 id）
 * @param groups 分组集合
 * @param snippetType 片段类型
 * @param groupId 分组 id
 * @returns 匹配分组（不存在或类型不符时为 undefined）
 */
export function findGroup(groups: SnippetGroup[], snippetType: SnippetType, groupId: string): SnippetGroup | undefined {
    return groups.find(group => group.id === groupId && group.type === snippetType);
}

/**
 * 将片段加入某分组（追加到组尾）。片段原先在别组/未分组会被一并迁移（保证一个片段只属一个分组）。
 * 返回新分组集合（不改入参）。
 * @param groups 分组集合
 * @param groupId 目标分组 id
 * @param snippetId 片段 id
 * @returns 处理后的分组集合
 */
export function assignSnippetToGroup(groups: SnippetGroup[], groupId: string, snippetId: string): SnippetGroup[] {
    const next = cloneGroups(groups);
    const target = next.find(group => group.id === groupId);
    if (!target) return next;
    // 先从事分组移除该片段（含目标组自身，避免重复追加）
    next.forEach(group => {
        const index = group.snippetIds.indexOf(snippetId);
        if (index >= 0) group.snippetIds.splice(index, 1);
    });
    target.snippetIds.push(snippetId);
    return next;
}

/**
 * 将片段移出所在分组（回到未分组）。返回新分组集合（不改入参）。
 * @param groups 分组集合
 * @param snippetId 片段 id
 * @returns 处理后的分组集合
 */
export function unassignSnippetFromGroup(groups: SnippetGroup[], snippetId: string): SnippetGroup[] {
    return cloneGroups(groups).map(group => {
        if (!group.snippetIds.includes(snippetId)) return group;
        return { ...group, snippetIds: group.snippetIds.filter(id => id !== snippetId) };
    });
}

/**
 * 调整片段在分组内的位置（拖拽到目标片段前/后）。
 * 片段须已在目标分组内；目标为组头时追加到组尾（assignSnippetToGroup 语义）。
 * 返回新分组集合（不改入参）。
 * @param groups 分组集合
 * @param groupId 目标分组 id
 * @param snippetId 被移动片段 id
 * @param targetId 目标片段 id（位于组内）
 * @param isTop 是否移动到目标片段上方
 * @returns 处理后的分组集合（片段不在目标分组或无位置变化时返回原样副本）
 */
export function moveSnippetWithinGroup(groups: SnippetGroup[], groupId: string, snippetId: string, targetId: string, isTop: boolean): SnippetGroup[] {
    const target = groups.find(group => group.id === groupId);
    if (!target || !target.snippetIds.includes(snippetId) || !target.snippetIds.includes(targetId)) {
        return cloneGroups(groups);
    }
    const next = cloneGroups(groups);
    const group = next.find(g => g.id === groupId)!;
    const fromIndex = group.snippetIds.indexOf(snippetId);
    const toIndex = group.snippetIds.indexOf(targetId);
    const [moved] = group.snippetIds.splice(fromIndex, 1);
    let insertIndex: number;
    if (isTop) {
        insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    } else {
        insertIndex = fromIndex < toIndex ? toIndex : toIndex + 1;
    }
    group.snippetIds.splice(insertIndex, 0, moved);
    return next;
}

/**
 * 添加新分组（追加到该类型分组集合末尾）。返回新分组集合（不改入参）。
 * @param groups 分组集合
 * @param group 新分组（id/type 必填；name 可为空占位）
 * @returns 处理后的分组集合
 */
export function addGroup(groups: SnippetGroup[], group: SnippetGroup): SnippetGroup[] {
    return [...cloneGroups(groups), { ...group, snippetIds: [...group.snippetIds] }];
}

/**
 * 重命名分组。返回新分组集合（不改入参）。
 * @param groups 分组集合
 * @param groupId 分组 id
 * @param newName 新名称
 * @returns 处理后的分组集合
 */
export function renameGroup(groups: SnippetGroup[], groupId: string, newName: string): SnippetGroup[] {
    return cloneGroups(groups).map(group => group.id === groupId ? { ...group, name: newName } : group);
}

/**
 * 删除分组：组内片段并入未分组（回到列表中不受任何分组引用），不删除片段本身。
 * 返回新分组集合（不改入参）。
 * @param groups 分组集合
 * @param groupId 分组 id
 * @returns 处理后的分组集合
 */
export function removeGroup(groups: SnippetGroup[], groupId: string): SnippetGroup[] {
    return cloneGroups(groups).filter(group => group.id !== groupId);
}

/**
 * 生成新的分组 id（与现有分组与片段 id 去重；纯逻辑层不依赖 window.Lute）
 * @param groups 分组集合
 * @param makeId 生成新 id 的函数（由调用方注入 window.Lute.NewNodeID 等）
 * @returns 新分组 id
 */
export function genNewGroupId(groups: SnippetGroup[], makeId: () => string): string {
    const taken = new Set<string>();
    groups.forEach(group => taken.add(group.id));
    let id = makeId();
    while (taken.has(id)) {
        id = makeId();
    }
    return id;
}
