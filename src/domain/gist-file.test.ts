// domain/gist-file.ts 纯逻辑单测：文件名 ↔ 片段身份映射与清洗
import {describe, expect, it} from "vitest";
import {buildGistFileName, parseGistFileName, sanitizeGistFileName} from "./gist-file";

const ID = "20250813161014-se1mend";

describe("parseGistFileName", () => {
    it("带 ID 文件名提取名称/ID/类型", () => {
        expect(parseGistFileName("我的样式 20250813161014-se1mend.css")).toEqual({
            name: "我的样式",
            type: "css",
            id: "20250813161014-se1mend",
        });
        expect(parseGistFileName("injector 20250813161014-se1mend.js")).toEqual({
            name: "injector",
            type: "js",
            id: "20250813161014-se1mend",
        });
        expect(parseGistFileName("m 20250813161014-se1mend.mjs")).toEqual({
            name: "m",
            type: "js",
            id: "20250813161014-se1mend",
        });
    });

    it("名称本身含空格仍能识别尾部 ID 段", () => {
        expect(parseGistFileName("my style 20250813161014-se1mend.css")).toEqual({
            name: "my style",
            type: "css",
            id: "20250813161014-se1mend",
        });
    });

    it("不带 ID 的文件名只解析名称与类型（按扩展名推断）", () => {
        expect(parseGistFileName("styles.css")).toEqual({name: "styles", type: "css"});
        expect(parseGistFileName("script.min.js")).toEqual({name: "script.min", type: "js"});
        expect(parseGistFileName("README.md")).toEqual({name: "README", type: "css"});
        expect(parseGistFileName("noext")).toEqual({name: "noext", type: "css"});
    });

    it("ID 段不在文件末尾时不误判（如时间戳在名字中间）", () => {
        expect(parseGistFileName("20250813161014-se1mend 样式.css")).toEqual({
            name: "20250813161014-se1mend 样式",
            type: "css",
        });
    });
});

describe("sanitizeGistFileName", () => {
    it("非法字符替换为 -", () => {
        expect(sanitizeGistFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
    });

    it("去除首尾空白与点", () => {
        expect(sanitizeGistFileName("  .hidden name.  ")).toBe("hidden name");
        expect(sanitizeGistFileName("...")).toBe("snippet");
    });

    it("空名回退 snippet", () => {
        expect(sanitizeGistFileName("")).toBe("snippet");
        expect(sanitizeGistFileName("   ")).toBe("snippet");
    });

    it("名称末尾恰为 ID 形态时追加 - 避免歧义", () => {
        expect(sanitizeGistFileName("note 20250813161014-se1mend")).toBe("note 20250813161014-se1mend-");
    });
});

describe("buildGistFileName", () => {
    it("拼接为 <名称> <ID>.<ext>", () => {
        expect(buildGistFileName("我的样式", ID, "css")).toBe("我的样式 20250813161014-se1mend.css");
        expect(buildGistFileName("injector", ID, "js")).toBe("injector 20250813161014-se1mend.js");
    });

    it("名称先清洗再拼接", () => {
        expect(buildGistFileName("a/b 样式", ID, "css")).toBe("a-b 样式 20250813161014-se1mend.css");
    });

    it("空名回退 snippet 但仍带 ID 段", () => {
        expect(buildGistFileName("", ID, "js")).toBe("snippet 20250813161014-se1mend.js");
    });

    it("名称超长时为 ID 段与扩展名预留空间并截断", () => {
        const longName = "x".repeat(200);
        const fileName = buildGistFileName(longName, ID, "css");
        expect(fileName.length).toBeLessThanOrEqual(80);
        expect(fileName.endsWith(` ${ID}.css`)).toBe(true);
    });

    it("round-trip：解析-重发布保持 ID 与名称一致（幂等）", () => {
        const parsed = parseGistFileName("my style 20250813161014-se1mend.css");
        expect(parsed.id).toBe(ID);
        expect(buildGistFileName(parsed.name, parsed.id!, parsed.type)).toBe("my style 20250813161014-se1mend.css");
    });
});
