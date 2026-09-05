// domain/snippet-groups.ts 单测
// 覆盖：cloneGroups/isSnippetGroupArray/reconcileGroups（孤儿 id 剔除、组内去重、非法组剔除）、
//       ungroupedSnippetIds、findGroupBySnippetId/findGroup、assignSnippetToGroup（跨组迁移/去重）、
//       unassignSnippetFromGroup、moveSnippetWithinGroup、addGroup/renameGroup/removeGroup、genNewGroupId。
// 全部纯函数无 DOM / 无插件依赖。
import {describe, expect, it} from "vitest";
import type {Snippet, SnippetType} from "../types";
import type {SnippetGroup} from "./snippet-groups";
import {
    addGroup, assignSnippetToGroup, cloneGroups, findGroup, findGroupBySnippetId, genNewGroupId,
    isSnippetGroupArray, moveSnippetWithinGroup, reconcileGroups, removeGroup, renameGroup,
    unassignSnippetFromGroup, ungroupedSnippetIds
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
