// services/formatter.ts 纯函数单测（node 环境：Prettier 无 DOM 依赖）
// 覆盖：JS/CSS 格式化（两空格/制表符/四空格缩进跟随）、光标偏移换算、语法错误抛出、空白内容短路
import {describe, expect, it} from "vitest";
import {formatCodeWithCursor} from "./formatter";

describe("formatCodeWithCursor - JS", () => {
    it("格式化 JS 并默认使用两空格缩进", async () => {
        const result = await formatCodeWithCursor("const a=1;function f(){return a}", "js", "  ", 0);
        expect(result.code).toBe("const a = 1;\nfunction f() {\n  return a;\n}\n");
    });

    it("缩进单位是制表符时 useTabs 生效", async () => {
        const result = await formatCodeWithCursor("function f(){if(a){return b}}", "js", "\t", 0);
        expect(result.code).toBe("function f() {\n\tif (a) {\n\t\treturn b;\n\t}\n}\n");
    });

    it("缩进单位是四个空格时跟随", async () => {
        const result = await formatCodeWithCursor("function f(){if(a){return b}}", "js", "    ", 0);
        expect(result.code).toBe("function f() {\n    if (a) {\n        return b;\n    }\n}\n");
    });

    it("光标位于文末时格式化后停留在 return a 语句结束处而非跳到文档头尾", async () => {
        // Prettier 光标锚定语义：光标停留在语句 token 之后（分号可插在光标前后），不会机械映射到新文本文末
        const code = "const a=1;return a";
        const result = await formatCodeWithCursor(code, "js", "  ", code.length);
        expect(result.code.endsWith("return a;\n")).toBe(true);
        const returnAEnd = result.code.indexOf("return a") + "return a".length;
        expect(result.cursorOffset).toBeGreaterThanOrEqual(returnAEnd);
        expect(result.cursorOffset).toBeLessThanOrEqual(returnAEnd + 1);
    });

    it("光标偏移为有效整数且不越界", async () => {
        const code = "const a=1;\nfunction f(){return {x:1}}";
        const cursorOffset = code.indexOf("{x:1}") + 2;
        const result = await formatCodeWithCursor(code, "js", "  ", cursorOffset);
        expect(Number.isInteger(result.cursorOffset)).toBe(true);
        expect(result.cursorOffset).toBeGreaterThanOrEqual(0);
        expect(result.cursorOffset).toBeLessThanOrEqual(result.code.length);
    });

    it("JS 语法错误时抛出且不返回结果", async () => {
        const promise = formatCodeWithCursor("const = ;", "js", "  ", 0);
        await expect(promise).rejects.toThrow();
    });

    it("meriyah 不支持 TS 类型标注，遇 TS 片段抛语法错误（选型边界）", async () => {
        // parser 选 meriyah 的已知边界：仅支持标准 ES/JSX，不解析 TS 类型语法；
        // 若未来想支持粘贴 TS 片段，需改回 babel（体积更大）
        const promise = formatCodeWithCursor("const n:number=1;", "js", "  ", 0);
        await expect(promise).rejects.toThrow();
    });
});

describe("formatCodeWithCursor - CSS", () => {
    it("格式化 CSS 并默认使用两空格缩进", async () => {
        const result = await formatCodeWithCursor("body{color:red;margin:0}", "css", "  ", 0);
        expect(result.code).toBe("body {\n  color: red;\n  margin: 0;\n}\n");
    });

    it("CSS 语法错误（未闭合块）时抛出", async () => {
        const promise = formatCodeWithCursor("body {", "css", "  ", 0);
        await expect(promise).rejects.toThrow();
    });
});

describe("formatCodeWithCursor - 公共行为", () => {
    it("空白内容直接返回，不触发解析", async () => {
        const result = await formatCodeWithCursor("  \n", "js", "  ", 2);
        expect(result.code).toBe("  \n");
        expect(result.cursorOffset).toBe(2);
    });

    it("已格式化的内容重复格式化结果不变（幂等）", async () => {
        const first = await formatCodeWithCursor("body{color:red}", "css", "  ", 0);
        const second = await formatCodeWithCursor(first.code, "css", "  ", first.cursorOffset);
        expect(second.code).toBe(first.code);
    });
});
