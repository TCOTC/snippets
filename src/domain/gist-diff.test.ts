// domain/gist-diff.ts 行级 diff 纯逻辑单测
import {describe, expect, it} from "vitest";
import type {DiffLine} from "./gist-diff";
import {DIFF_SKIPPED, diffLines, diffWithContext} from "./gist-diff";

describe("diffLines", () => {
    it("相同文本全为 equal", () => {
        const ops = diffLines("a\nb\nc", "a\nb\nc");
        expect(ops).toEqual([
            {type: "equal", text: "a"},
            {type: "equal", text: "b"},
            {type: "equal", text: "c"},
        ]);
    });

    it("单行修改识别为 del + add", () => {
        const ops = diffLines("a\nold\nc", "a\nnew\nc");
        expect(ops).toEqual([
            {type: "equal", text: "a"},
            {type: "del", text: "old"},
            {type: "add", text: "new"},
            {type: "equal", text: "c"},
        ]);
    });

    it("新增行标记为 add", () => {
        const ops = diffLines("a", "a\nb");
        expect(ops).toEqual([
            {type: "equal", text: "a"},
            {type: "add", text: "b"},
        ]);
    });

    it("删除行标记为 del", () => {
        const ops = diffLines("a\nb", "a");
        expect(ops).toEqual([
            {type: "equal", text: "a"},
            {type: "del", text: "b"},
        ]);
    });

    it("空新文本全 del", () => {
        const ops = diffLines("a\nb", "");
        expect(ops.every(op => op.type === "del")).toBe(true);
        expect(ops).toHaveLength(2);
    });

    it("空旧文本全 add", () => {
        const ops = diffLines("", "a\nb");
        expect(ops.every(op => op.type === "add")).toBe(true);
        expect(ops).toHaveLength(2);
    });

    it("末尾换行不影响 diff 稳定性", () => {
        const ops = diffLines("a\n", "a");
        // "a\n".split("\n") = ["a", ""]，最后一行空串 del
        expect(ops).toEqual([
            {type: "equal", text: "a"},
            {type: "del", text: ""},
        ]);
    });
});

describe("diffWithContext", () => {
    it("差异周围保留少量相等行并折叠长相等段", () => {
        const lines = Array.from({length: 50}, (_, idx) => `L${idx}`);
        const ops: DiffLine[] = [];
        ops.push({type: "equal", text: lines[0]});
        ops.push({type: "equal", text: lines[1]});
        ops.push({type: "del", text: "REMOVED"});
        ops.push({type: "add", text: "ADDED"});
        for (let idx = 10; idx < 50; idx++) {
            ops.push({type: "equal", text: lines[idx]});
        }
        const shown = diffWithContext(ops, 2);
        // 差异前后各 2 行相等 + del + add + 末尾相等块折叠（2 行 + 占位 + 2 行）
        const types = shown.map(item => item.type);
        expect(types).toContain("del");
        expect(types).toContain("add");
        expect(shown.some(item => item.text === DIFF_SKIPPED)).toBe(true);
    });

    it("短相等块不折叠", () => {
        const ops: DiffLine[] = [
            {type: "equal", text: "a"},
            {type: "del", text: "b"},
            {type: "add", text: "c"},
            {type: "equal", text: "d"},
        ];
        const shown = diffWithContext(ops, 3);
        expect(shown).toHaveLength(4);
        expect(shown.some(item => item.text === DIFF_SKIPPED)).toBe(false);
    });
});
