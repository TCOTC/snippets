// domain/snippet.ts 纯函数单测
// 覆盖：deepClone/snippetTitle/isValidJavaScriptCode/isSnippetsTypeEnabled/
//       sortSnippets（8 种排序 + 引用语义）/filterSnippetsByKeyword（4 种搜索类型）
import {afterEach, describe, expect, it, vi} from "vitest";
import type {Snippet} from "../types";
import {
    deepClone,
    filterSnippetsByKeyword,
    isSnippetsTypeEnabled,
    isValidJavaScriptCode,
    snippetTitle,
    sortSnippets,
} from "./snippet";

/**
 * 构造代码片段
 * @param id 片段 id（前 14 位为创建时间，与思源 id 格式一致）
 * @param name 名称
 * @param content 内容
 * @param type 类型
 * @param enabled 是否启用
 * @returns 代码片段
 */
const makeSnippet = (id: string, name: string, content: string, type: "css" | "js" = "css", enabled = true): Snippet =>
    ({id, name, content, type, enabled});

describe("deepClone", () => {
    it("深拷贝后与原值结构等价且非同一引用", () => {
        const original = {a: [1, {b: 2}], c: "x"};
        const cloned = deepClone(original);
        expect(cloned).toEqual(original);
        expect(cloned).not.toBe(original);
    });

    it("修改副本不影响原值（嵌套对象/数组均为独立副本）", () => {
        const original = {a: [1, {b: 2}]};
        const cloned = deepClone(original);
        cloned.a[0] = 99;
        (cloned.a[1] as {b: number}).b = 100;
        expect(original).toEqual({a: [1, {b: 2}]});
    });
});

describe("snippetTitle", () => {
    it("名称为非空时直接返回名称", () => {
        expect(snippetTitle(makeSnippet("20250101000000-a", "My CSS", "body {}"))).toBe("My CSS");
    });

    it("名称为空时回退内容前 200 字符", () => {
        const content = "a".repeat(300);
        expect(snippetTitle(makeSnippet("20250101000000-a", "", content))).toBe("a".repeat(200));
    });

    it("名称为空且内容不足 200 字符时回退全量内容", () => {
        expect(snippetTitle(makeSnippet("20250101000000-a", "", "short"))).toBe("short");
    });
});

describe("isValidJavaScriptCode", () => {
    it("空白与空字符串为无效代码", () => {
        expect(isValidJavaScriptCode("")).toBe(false);
        expect(isValidJavaScriptCode("   ")).toBe(false);
    });

    it("单表达式且无副作用的值/引用/字面量视为无效代码", () => {
        // 字面量（Literal）
        expect(isValidJavaScriptCode("1")).toBe(false);
        expect(isValidJavaScriptCode("'str'")).toBe(false);
        expect(isValidJavaScriptCode("true")).toBe(false);
        // 标识符（Identifier）
        expect(isValidJavaScriptCode("foo")).toBe(false);
        // 成员表达式（MemberExpression）
        expect(isValidJavaScriptCode("obj.prop")).toBe(false);
        expect(isValidJavaScriptCode("arr[0]")).toBe(false);
        // this 表达式
        expect(isValidJavaScriptCode("this")).toBe(false);
        // 数组/对象表达式
        expect(isValidJavaScriptCode("[1, 2]")).toBe(false);
        expect(isValidJavaScriptCode("({a: 1})")).toBe(false);
        // 模板字符串（无插值副作用）
        expect(isValidJavaScriptCode("`tpl`")).toBe(false);
        // 函数表达式/箭头函数（仅定义不调用）
        expect(isValidJavaScriptCode("function () {}")).toBe(false);
        expect(isValidJavaScriptCode("() => {}")).toBe(false);
        // 一元/更新/二元/逻辑/条件表达式
        expect(isValidJavaScriptCode("!x")).toBe(false);
        expect(isValidJavaScriptCode("i++")).toBe(false);
        expect(isValidJavaScriptCode("1 + 2")).toBe(false);
        expect(isValidJavaScriptCode("a && b")).toBe(false);
        expect(isValidJavaScriptCode("a ? b : c")).toBe(false);
        // new 表达式（实例化但不落变量，视为无保存意义的表达式）
        expect(isValidJavaScriptCode("new Foo()")).toBe(false);
        // 序列表达式
        expect(isValidJavaScriptCode("(1, 2)")).toBe(false);
    });

    it("带调用的表达式与声明/语句视为有效代码", () => {
        // 函数调用（含 IIFE）为有效代码
        expect(isValidJavaScriptCode("console.log('hi')")).toBe(true);
        expect(isValidJavaScriptCode("(function () {})()")).toBe(true);
        expect(isValidJavaScriptCode("foo()")).toBe(true);
        // 变量/函数/类声明
        expect(isValidJavaScriptCode("const a = 1")).toBe(true);
        expect(isValidJavaScriptCode("function f() {}")).toBe(true);
        expect(isValidJavaScriptCode("class A {}")).toBe(true);
        // 语句
        expect(isValidJavaScriptCode("if (a) { b(); }")).toBe(true);
        // 多语句
        expect(isValidJavaScriptCode("foo(); bar();")).toBe(true);
    });

    it("语法错误为无效代码", () => {
        expect(isValidJavaScriptCode("const =")).toBe(false);
        expect(isValidJavaScriptCode("function (")).toBe(false);
        // 单独一行 super 只能出现在类方法内，脚本顶层是语法错误（曾被误列排除表，属不可达分支）
        expect(isValidJavaScriptCode("super")).toBe(false);
    });
});

describe("isSnippetsTypeEnabled", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("按 window.siyuan.config.snippet 的启用状态判断", () => {
        vi.stubGlobal("window", {
            siyuan: {config: {snippet: {enabledCSS: true, enabledJS: false}}},
        });
        expect(isSnippetsTypeEnabled("css")).toBe(true);
        expect(isSnippetsTypeEnabled("js")).toBe(false);
    });

    it("两种类型开关状态独立", () => {
        vi.stubGlobal("window", {
            siyuan: {config: {snippet: {enabledCSS: false, enabledJS: true}}},
        });
        expect(isSnippetsTypeEnabled("css")).toBe(false);
        expect(isSnippetsTypeEnabled("js")).toBe(true);
    });
});

describe("sortSnippets", () => {
    // 原列表（乱序）：created 按 id 前 14 位、名称含数字以验证 natural 排序
    const snippets = [
        makeSnippet("20250201000000-b", "a10", "b"),
        makeSnippet("20250101000000-a", "a2", "a"),
        makeSnippet("20250301000000-c", "b1", "c", "js", false),
    ];

    it("fixedSort/customSort 返回原引用且不改动顺序", () => {
        expect(sortSnippets(snippets, "fixedSort")).toBe(snippets);
        expect(sortSnippets(snippets, "customSort")).toBe(snippets);
    });

    it("其余排序方式返回新数组（深拷贝），原列表不被改动", () => {
        const sorted = sortSnippets(snippets, "fileNameASC");
        expect(sorted).not.toBe(snippets);
        expect(snippets.map(s => s.id)).toEqual(["20250201000000-b", "20250101000000-a", "20250301000000-c"]);
    });

    it("fileNameASC/fileNameDESC 按名称字典序", () => {
        const asc = sortSnippets(snippets, "fileNameASC").map(s => s.name);
        // 普通字典序下 "a10" 排在 "a2" 之前（逐字符比较）
        expect(asc).toEqual(["a10", "a2", "b1"]);
        const desc = sortSnippets(snippets, "fileNameDESC").map(s => s.name);
        expect(desc).toEqual(["b1", "a2", "a10"]);
    });

    it("fileNameNatASC/fileNameNatDESC 按自然序（数字按数值比较）", () => {
        const natAsc = sortSnippets(snippets, "fileNameNatASC").map(s => s.name);
        expect(natAsc).toEqual(["a2", "a10", "b1"]);
        const natDesc = sortSnippets(snippets, "fileNameNatDESC").map(s => s.name);
        expect(natDesc).toEqual(["b1", "a10", "a2"]);
    });

    it("enabledASC/enabledDESC 按启用状态排序", () => {
        const enabledAsc = sortSnippets(snippets, "enabledASC").map(s => s.enabled);
        expect(enabledAsc).toEqual([true, true, false]);
        const enabledDesc = sortSnippets(snippets, "enabledDESC").map(s => s.enabled);
        expect(enabledDesc).toEqual([false, true, true]);
    });

    it("createdASC/createdDESC 按 id 前 14 位时间排序", () => {
        const createdAsc = sortSnippets(snippets, "createdASC").map(s => s.id);
        expect(createdAsc).toEqual(["20250101000000-a", "20250201000000-b", "20250301000000-c"]);
        const createdDesc = sortSnippets(snippets, "createdDESC").map(s => s.id);
        expect(createdDesc).toEqual(["20250301000000-c", "20250201000000-b", "20250101000000-a"]);
    });

    it("未知排序方式返回深拷贝且保持原顺序", () => {
        const sorted = sortSnippets(snippets, "unknownSort");
        expect(sorted).not.toBe(snippets);
        expect(sorted.map(s => s.id)).toEqual(snippets.map(s => s.id));
    });
});

describe("filterSnippetsByKeyword", () => {
    const snippets = [
        makeSnippet("20250101000000-a", "Alpha", "const alpha = 1"),
        // 名称为空：标题检索回退内容
        makeSnippet("20250101000000-b", "", "Beta body text"),
        makeSnippet("20250101000000-c", "Gamma CSS", ".gamma {}"),
    ];

    it("禁用搜索（类型 0）返回 false", () => {
        expect(filterSnippetsByKeyword(snippets, 0, "alpha")).toBe(false);
    });

    it("关键字为空或全空白返回 false", () => {
        expect(filterSnippetsByKeyword(snippets, 1, "")).toBe(false);
        expect(filterSnippetsByKeyword(snippets, 2, "   ")).toBe(false);
    });

    it("类型 1 按标题检索，忽略大小写与首尾空白", () => {
        expect(filterSnippetsByKeyword(snippets, 1, "alpha")).toEqual(["20250101000000-a"]);
        expect(filterSnippetsByKeyword(snippets, 1, "  ALPHA  ")).toEqual(["20250101000000-a"]);
    });

    it("类型 1 标题为空时回退内容检索", () => {
        expect(filterSnippetsByKeyword(snippets, 1, "beta body")).toEqual(["20250101000000-b"]);
    });

    it("类型 1 只匹配标题/回退内容，不匹配非空标题片段的内容", () => {
        // "const" 仅出现在 Alpha 的内容中，Alpha 标题不含 → 不应命中
        expect(filterSnippetsByKeyword(snippets, 1, "const")).toEqual([]);
    });

    it("类型 2 按内容检索", () => {
        expect(filterSnippetsByKeyword(snippets, 2, ".gamma")).toEqual(["20250101000000-c"]);
        expect(filterSnippetsByKeyword(snippets, 2, "alpha")).toEqual(["20250101000000-a"]);
    });

    it("类型 2 不按标题检索", () => {
        // "css" 仅在标题出现（内容为 ".gamma {}"，小写后不含 css）→ 不命中
        expect(filterSnippetsByKeyword(snippets, 2, "css")).toEqual([]);
    });

    it("类型 3 标题或内容任一命中即返回", () => {
        expect(filterSnippetsByKeyword(snippets, 3, "Gamma")).toEqual(["20250101000000-c"]);
        expect(filterSnippetsByKeyword(snippets, 3, "const")).toEqual(["20250101000000-a"]);
        expect(filterSnippetsByKeyword(snippets, 3, "beta")).toEqual(["20250101000000-b"]);
    });

    it("未知搜索类型返回空数组", () => {
        expect(filterSnippetsByKeyword(snippets, 99, "alpha")).toEqual([]);
    });
});
