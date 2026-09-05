// domain/import-plan.ts 导入三模式规划纯逻辑单测
import {describe, expect, it} from "vitest";
import type {Snippet} from "../types";
import {planImport} from "./import-plan";

const makeSnippet = (id: string, name: string, content = "code", enabled = false): Snippet => ({id, name, content, type: "css", enabled});

/** 顺序 ID 生成器桩（模拟 genNewSnippetId 语义：不与既有冲突） */
const genIdFrom = (seed: number) => () => `new-id-${seed++}`;

describe("planImport merge", () => {
    const local = [
        makeSnippet("local-1", "本地一", "local-content", true),
        makeSnippet("local-2", "本地二"),
    ];

    it("同 ID 更新 name/content/type，保留本地 enabled 与排序", () => {
        const incoming = [
            makeSnippet("local-2", "远端新名", "远端内容", true),  // enabled 应为 true 但 merge 保留本地 false
            makeSnippet("local-1", "本地一新内容", "x", false),      // 本地 enabled true 应保留
        ];
        const plan = planImport(local, incoming, "merge", genIdFrom(100));
        expect(plan.addedCount).toBe(0);
        expect(plan.updatedCount).toBe(2);
        expect(plan.list).toHaveLength(2);
        // 排序保留本地原序
        expect(plan.list[0].id).toBe("local-1");
        expect(plan.list[0].name).toBe("本地一新内容");
        expect(plan.list[0].enabled).toBe(true);
        expect(plan.list[1].id).toBe("local-2");
        expect(plan.list[1].name).toBe("远端新名");
        expect(plan.list[1].enabled).toBe(false);
        // 原列表不被就地修改
        expect(local[0].name).toBe("本地一");
    });

    it("带 ID 但本地无同 ID → 保留 ID 作为新增置于前部", () => {
        const incoming = [makeSnippet("remote-new", "远端新片段", "c")];
        const plan = planImport(local, incoming, "merge", genIdFrom(100));
        expect(plan.addedCount).toBe(1);
        expect(plan.updatedCount).toBe(0);
        expect(plan.list.map(s => s.id)).toEqual(["remote-new", "local-1", "local-2"]);
    });

    it("无 ID 片段 → 生成新 ID 新增", () => {
        const incoming = [{name: "no-id", content: "c", type: "js", enabled: false} as unknown as Snippet];
        const plan = planImport(local, incoming, "merge", genIdFrom(100));
        expect(plan.addedCount).toBe(1);
        expect(plan.list[0].id).toBe("new-id-100");
    });

    it("文件内重复的远端 ID（本地不存在）第二个生成新 ID，避免重复", () => {
        const incoming = [
            makeSnippet("dup", "a"),
            makeSnippet("dup", "b"),
        ];
        const plan = planImport(local, incoming, "merge", genIdFrom(100));
        expect(plan.addedCount).toBe(2);
        expect(plan.list[0].id).toBe("dup");
        expect(plan.list[1].id).toBe("new-id-100");
    });
});

describe("planImport overwrite", () => {
    it("以导入集合整体替换（含 enabled），不改动导入对象", () => {
        const local = [makeSnippet("local-1", "本地")];
        const incoming = [makeSnippet("a", "甲", "c1", true), makeSnippet("b", "乙")];
        const plan = planImport(local, incoming, "overwrite", genIdFrom(100));
        expect(plan.list.map(s => s.id)).toEqual(["a", "b"]);
        expect(plan.list[0].enabled).toBe(true);
        expect(plan.addedCount).toBe(2);
        expect(plan.updatedCount).toBe(0);
        // 不引用原对象（深拷贝）
        expect(plan.list[0]).not.toBe(incoming[0]);
    });
});

describe("planImport fork", () => {
    it("全部重生成 ID 并置于本地前部，忽略远端 ID", () => {
        const local = [makeSnippet("local-1", "本地")];
        const incoming = [makeSnippet("remote-1", "甲"), makeSnippet("remote-2", "乙")];
        const plan = planImport(local, incoming, "fork", genIdFrom(100));
        expect(plan.list.map(s => s.id)).toEqual(["new-id-100", "new-id-101", "local-1"]);
        expect(plan.addedCount).toBe(2);
        expect(plan.updatedCount).toBe(0);
    });
});
