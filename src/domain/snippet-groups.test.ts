// domain/snippet-groups.ts 单测
// 覆盖：cloneGroups/isSnippetGroupArray/reconcileGroups（孤儿 id 剔除、组内去重、非法组剔除）、
//       ungroupedSnippetIds、findGroupBySnippetId/findGroup、assignSnippetToGroup（跨组迁移/去重）、
//       unassignSnippetFromGroup、moveSnippetWithinGroup、addGroup/renameGroup/removeGroup、genNewGroupId、
//       未分组占位（isUngroupedGroup/hasRealGroups/withUngroupedAnchors）与组间排序 moveGroup。
// 全部纯函数无 DOM / 无插件依赖。
import {describe, expect, it} from "vitest";
import type {Snippet, SnippetType} from "../types";
import type {SnippetGroup} from "./snippet-groups";
import {
    addGroup, assignSnippetToGroup, cloneGroups, findGroup, findGroupBySnippetId, genNewGroupId,
    hasRealGroups, isSnippetGroupArray, isUngroupedGroup, moveGroup, moveSnippetWithinGroup,
    reconcileGroups, removeGroup, renameGroup, unassignSnippetFromGroup, ungroupedSnippetIds,
    UNGROUPED_GROUP_ID, withUngroupedAnchors
} from "./snippet-groups";

const makeSnippet = (id: string, type: SnippetType): Snippet => ({ id, name: id, type, content: "x", enabled: true });

/** 制造一组固定片段：css-a/css-b/js-c 三类 */ 
const snippets = () => [
    makeSnippet("css-a", "css"),
    makeSnippet("css-b", "css"),
    makeSnippet("js-c", "js"),
];

const g = (id: string, type: SnippetType, snippetIds: string[], name = id): SnippetGroup => ({ id, type, name, snippetIds });

describe("cloneGroups / isSnippetGroupArray", () => {
    it("深拷贝：外层数组与内层 snippetIds 均不共享引用", () => {
        const groups = [g("g1", "css", ["a", "b"])];
        const copy = cloneGroups(groups);
        expect(copy).toEqual(groups);
        expect(copy).not.toBe(groups);
        expect(copy[0].snippetIds).not.toBe(groups[0].snippetIds);
        copy[0].snippetIds.push("c");
        expect(groups[0].snippetIds).toEqual(["a", "b"]);
    });

    it("识别合法分组数组；拒绝非数组/缺字段/错误 type", () => {
        expect(isSnippetGroupArray([])).toBe(true);
        expect(isSnippetGroupArray([g("g", "css", [])])).toBe(true);
        expect(isSnippetGroupArray(null)).toBe(false);
        expect(isSnippetGroupArray({})).toBe(false);
        expect(isSnippetGroupArray([{}])).toBe(false);
        expect(isSnippetGroupArray([{ id: "g", type: "html", name: "x", snippetIds: [] }])).toBe(false);
        expect(isSnippetGroupArray([{ id: "g", type: "css", name: "x", snippetIds: [1] }])).toBe(false);
    });
});

describe("reconcileGroups", () => {
    it("剔除列表中不存在的孤儿 id", () => {
        const groups = [g("g1", "css", ["css-a", "gone-1"], "组")];
        const result = reconcileGroups(groups, snippets());
        expect(result[0].snippetIds).toEqual(["css-a"]);
    });

    it("组内 id 去重（防御数据损坏）", () => {
        const groups = [g("g1", "css", ["css-a", "css-a"])];
        expect(reconcileGroups(groups, snippets())[0].snippetIds).toEqual(["css-a"]);
    });

    it("非法分组数组整体回退为空", () => {
        expect(reconcileGroups([{ bad: true } as never], snippets())).toEqual([]);
    });

    it("空组与未命名组保留", () => {
        const groups = [g("g-empty", "css", []), g("g-noname", "js", [], "")];
        const result = reconcileGroups(groups, snippets());
        expect(result).toHaveLength(2);
    });
});

describe("ungroupedSnippetIds", () => {
    it("未被任何同类型分组引用的片段视为未分组", () => {
        const groups = [g("g1", "css", ["css-a"])];
        expect(ungroupedSnippetIds(groups, snippets(), "css")).toEqual(["css-b"]);
        expect(ungroupedSnippetIds(groups, snippets(), "js")).toEqual(["js-c"]);
    });

    it("全部归组后未分组为空", () => {
        const groups = [g("g1", "css", ["css-a", "css-b"]), g("g2", "js", ["js-c"])];
        expect(ungroupedSnippetIds(groups, snippets(), "css")).toEqual([]);
        expect(ungroupedSnippetIds(groups, snippets(), "js")).toEqual([]);
    });
});

describe("findGroupBySnippetId / findGroup", () => {
    it("按片段查找所属分组（含跨类型）", () => {
        const groups = [g("g1", "css", ["css-a"]), g("g2", "js", ["js-c"])];
        expect(findGroupBySnippetId(groups, "css-a")?.id).toBe("g1");
        expect(findGroupBySnippetId(groups, "js-c")?.id).toBe("g2");
        expect(findGroupBySnippetId(groups, "css-b")).toBeUndefined();
    });

    it("findGroup 需 id 与 type 同时匹配", () => {
        const groups = [g("g1", "css", [])];
        expect(findGroup(groups, "css", "g1")?.id).toBe("g1");
        expect(findGroup(groups, "js", "g1")).toBeUndefined();
    });
});

describe("assignSnippetToGroup", () => {
    it("把片段追加到组尾", () => {
        const groups = [g("g1", "css", ["css-a"])];
        const result = assignSnippetToGroup(groups, "g1", "css-b");
        expect(result[0].snippetIds).toEqual(["css-a", "css-b"]);
    });

    it("片段已在别组时迁移到目标组并保证唯一归属", () => {
        const groups = [g("g1", "css", ["css-a"]), g("g2", "css", ["css-b"])];
        const result = assignSnippetToGroup(groups, "g1", "css-b");
        expect(result[0].snippetIds).toEqual(["css-a", "css-b"]);
        expect(result[1].snippetIds).toEqual([]);
    });

    it("同一片段重复加入不重复（先移除再追加）", () => {
        const groups = [g("g1", "css", ["css-a"])];
        const result = assignSnippetToGroup(groups, "g1", "css-a");
        expect(result[0].snippetIds).toEqual(["css-a"]);
    });

    it("目标组不存在时返回原样副本（不抛错、不改动）", () => {
        const groups = [g("g1", "css", ["css-a"])];
        const result = assignSnippetToGroup(groups, "missing", "css-b");
        expect(result).toEqual(groups);
    });

    it("不修改入参（纯函数）", () => {
        const groups = [g("g1", "css", [])];
        assignSnippetToGroup(groups, "g1", "css-a");
        expect(groups[0].snippetIds).toEqual([]);
    });
});

describe("unassignSnippetFromGroup", () => {
    it("把片段移出所在分组回到未分组", () => {
        const groups = [g("g1", "css", ["css-a", "css-b"])];
        const result = unassignSnippetFromGroup(groups, "css-a");
        expect(result[0].snippetIds).toEqual(["css-b"]);
    });

    it("片段不在任何组时返回原样副本", () => {
        const groups = [g("g1", "css", ["css-a"])];
        expect(unassignSnippetFromGroup(groups, "js-c")).toEqual(groups);
    });
});

describe("moveSnippetWithinGroup", () => {
    it("向下移动到目标下方 / 向上移动到目标上方", () => {
        const groups = [g("g1", "css", ["a", "b", "c"])];
        expect(moveSnippetWithinGroup(groups, "g1", "a", "c", false)[0].snippetIds).toEqual(["b", "c", "a"]);
        expect(moveSnippetWithinGroup(groups, "g1", "c", "a", true)[0].snippetIds).toEqual(["c", "a", "b"]);
    });

    it("片段/目标不在同组或组不存在时返回原样副本", () => {
        const groups = [g("g1", "css", ["a", "b"])];
        expect(moveSnippetWithinGroup(groups, "g1", "a", "zz", false)).toEqual(groups);
        expect(moveSnippetWithinGroup(groups, "missing", "a", "b", false)).toEqual(groups);
        expect(moveSnippetWithinGroup(groups, "g1", "js-c", "a", false)).toEqual(groups);
    });
});

describe("addGroup / renameGroup / removeGroup", () => {
    it("addGroup 追加到末尾", () => {
        const result = addGroup([g("g1", "css", [])], g("g2", "js", []));
        expect(result.map(x => x.id)).toEqual(["g1", "g2"]);
    });

    it("renameGroup 仅改匹配分组的名称", () => {
        const result = renameGroup([g("g1", "css", [], "旧")], "g1", "新");
        expect(result[0].name).toBe("新");
    });

    it("removeGroup 删除分组（组内片段变未分组，不删片段）", () => {
        const groups = [g("g1", "css", ["a", "b"]), g("g2", "js", ["c"])];
        const result = removeGroup(groups, "g1");
        expect(result).toHaveLength(1);
        // 片段本身不删除、回到未分组（reconcile 后 ungrouped 可推导）
        const reconciled = reconcileGroups(result, [
            makeSnippet("a", "css"), makeSnippet("b", "css"), makeSnippet("c", "js"),
        ]);
        expect(ungroupedSnippetIds(reconciled, [
            makeSnippet("a", "css"), makeSnippet("b", "css"), makeSnippet("c", "js"),
        ], "css")).toEqual(["a", "b"]);
    });
});

describe("genNewGroupId", () => {
    it("与现有分组去重，用注入的生成器", () => {
        const calls: string[] = [];
        const makeId = () => {
            const value = calls.length === 0 ? "dup" : "fresh";
            calls.push(value);
            return value;
        };
        const result = genNewGroupId([g("dup", "css", [])], makeId);
        expect(result).toBe("fresh");
    });
});

describe("跨组一致性", () => {
    it("reconcile 只在组内去重与剔除孤儿，不跨组去重（跨组唯一由 assignSnippetToGroup 保证）", () => {
        // 同一片段出现在两个组属非 reconcile 职责的损坏，reconcile 应原样保留两组而非静默去重
        const groups = [g("g1", "css", ["a"]), g("g2", "css", ["a", "b"])];
        const reconciled = reconcileGroups(groups, [makeSnippet("a", "css"), makeSnippet("b", "css")]);
        expect(reconciled[0].snippetIds).toEqual(["a"]);
        expect(reconciled[1].snippetIds).toEqual(["a", "b"]);
    });
});

describe("未分组占位分组", () => {
    it("isUngroupedGroup / hasRealGroups 识别占位", () => {
        const anchor = {id: UNGROUPED_GROUP_ID, type: "css" as SnippetType, name: "", snippetIds: []};
        expect(isUngroupedGroup(anchor)).toBe(true);
        expect(isUngroupedGroup(g("g1", "css", []))).toBe(false);
        expect(hasRealGroups([anchor])).toBe(false);
        expect(hasRealGroups([anchor, g("g1", "css", [])])).toBe(true);
    });

    it("withUngroupedAnchors 为有真实分组的类型补齐占位（追加到该类型组后）", () => {
        const result = withUngroupedAnchors([g("g1", "css", []), g("j1", "js", [])]);
        // css 组后出现占位，js 组后出现占位
        expect(result.map(x => x.id)).toEqual(["g1", UNGROUPED_GROUP_ID, "j1", UNGROUPED_GROUP_ID]);
    });

    it("withUngroupedAnchors 保留已被用户拖到中间的真实占位位置，不重复补", () => {
        const groups = [g("g1", "css", []), {id: UNGROUPED_GROUP_ID, type: "css" as SnippetType, name: "", snippetIds: []}, g("g2", "css", [])];
        const result = withUngroupedAnchors(groups);
        expect(result.map(x => x.id)).toEqual(["g1", UNGROUPED_GROUP_ID, "g2"]);
    });

    it("withUngroupedAnchors 在某类型真实分组删光时移除占位", () => {
        const groups = [
            {id: UNGROUPED_GROUP_ID, type: "css" as SnippetType, name: "", snippetIds: []},
            g("j1", "js", []),
            {id: UNGROUPED_GROUP_ID, type: "js" as SnippetType, name: "", snippetIds: []},
        ];
        const result = withUngroupedAnchors(groups);
        // css 无真实组 → 移除占位；js 保留占位
        expect(result.map(x => x.id)).toEqual(["j1", UNGROUPED_GROUP_ID]);
        expect(result.every(x => x.type === "js")).toBe(true);
    });

    it("占位不被 reconcile 当作孤儿/非法剔除", () => {
        const anchor = {id: UNGROUPED_GROUP_ID, type: "css" as SnippetType, name: "", snippetIds: []};
        const result = reconcileGroups([anchor, g("g1", "css", ["a"])], [makeSnippet("a", "css")]);
        expect(result.map(x => x.id)).toContain(UNGROUPED_GROUP_ID);
    });
});

describe("moveGroup（组间排序）", () => {
    it("同类型内把分组移动到目标分组上方", () => {
        const groups = [g("g1", "css", []), g("g2", "css", []), g("g3", "css", []), g("j1", "js", [])];
        const result = moveGroup(groups, "css", "g3", "g1", true);
        // css 顺序变为 g3,g1,g2（其余类型 js 保持）
        const cssIds = result.filter(x => x.type === "css").map(x => x.id);
        expect(cssIds).toEqual(["g3", "g1", "g2"]);
    });

    it("同类型内把分组移动到目标分组下方", () => {
        const groups = [g("g1", "css", []), g("g2", "css", []), g("g3", "css", [])];
        const result = moveGroup(groups, "css", "g1", "g3", false);
        const cssIds = result.filter(x => x.type === "css").map(x => x.id);
        expect(cssIds).toEqual(["g2", "g3", "g1"]);
    });

    it("把未分组占位移动到分组之间（未分组参与组间排序）", () => {
        const anchor = {id: UNGROUPED_GROUP_ID, type: "css" as SnippetType, name: "", snippetIds: []};
        const groups = [g("g1", "css", []), g("g2", "css", []), anchor];
        const result = moveGroup(groups, "css", UNGROUPED_GROUP_ID, "g2", true);
        expect(result.filter(x => x.type === "css").map(x => x.id)).toEqual(["g1", UNGROUPED_GROUP_ID, "g2"]);
    });

    it("目标不存在或位置无变化时返回原样副本", () => {
        const groups = [g("g1", "css", []), g("g2", "css", [])];
        const noTarget = moveGroup(groups, "css", "g1", "nope", true);
        expect(noTarget.map(x => x.id)).toEqual(["g1", "g2"]);
        const same = moveGroup(groups, "css", "g1", "g1", true);
        expect(same.map(x => x.id)).toEqual(["g1", "g2"]);
        // 不改入参
        expect(groups.map(x => x.id)).toEqual(["g1", "g2"]);
    });
});
