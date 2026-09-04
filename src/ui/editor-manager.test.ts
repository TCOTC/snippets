// ui/editor-manager.ts 编辑器工厂纯函数单测
// 覆盖 getEditorIndentUnit 的缩进单位解析（tabN/spaceN/followSiyuan 跟随思源与兜底）。
// createEditorExtensions/createCodeMirrorEditor 依赖 CodeMirror 实例化，不在纯函数范围内覆盖。
// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {getEditorIndentUnit} from "./editor-manager";

/** 设置 window.siyuan.config.editor.codeTabSpaces */
const stubCodeTabSpaces = (value: number | undefined) => {
    vi.stubGlobal("window", {
        siyuan: {config: {editor: {codeTabSpaces: value}}},
    });
};

describe("getEditorIndentUnit", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("tabN 配置解析为对应数量的制表符", () => {
        expect(getEditorIndentUnit("tab1")).toBe("\t");
        expect(getEditorIndentUnit("tab2")).toBe("\t\t");
        expect(getEditorIndentUnit("tab8")).toBe("\t".repeat(8));
    });

    it("spaceN 配置解析为对应数量的空格", () => {
        expect(getEditorIndentUnit("space1")).toBe(" ");
        expect(getEditorIndentUnit("space4")).toBe("    ");
        expect(getEditorIndentUnit("space8")).toBe(" ".repeat(8));
    });

    it("followSiyuan 且思源为空格数时跟随空格数", () => {
        stubCodeTabSpaces(2);
        expect(getEditorIndentUnit("followSiyuan")).toBe("  ");
        stubCodeTabSpaces(4);
        expect(getEditorIndentUnit("followSiyuan")).toBe("    ");
    });

    it("followSiyuan 且思源为 0（制表符）时使用制表符", () => {
        stubCodeTabSpaces(0);
        expect(getEditorIndentUnit("followSiyuan")).toBe("\t");
    });

    it("followSiyuan 且思源值缺失/非法时回退两个空格", () => {
        stubCodeTabSpaces(undefined);
        expect(getEditorIndentUnit("followSiyuan")).toBe("  ");
        // 负数视为非法（防御思源配置异常）
        stubCodeTabSpaces(-1);
        expect(getEditorIndentUnit("followSiyuan")).toBe("  ");
    });

    it("未知配置值也按 followSiyuan 语义处理", () => {
        stubCodeTabSpaces(2);
        expect(getEditorIndentUnit("bogus")).toBe("  ");
    });
});
