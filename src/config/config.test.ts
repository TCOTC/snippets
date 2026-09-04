// config/config.ts SnippetsConfig 默认值单测
// 配置字段默认值是“默认值唯一事实源”（ConfigService.init 按 configItems 键从存储合并，
// 存储无值则保持此处默认），锁定各字段默认值以在调整默认值/字段时提示回归。
import {describe, expect, it} from "vitest";
import {SnippetsConfig} from "./config";

describe("SnippetsConfig 默认值", () => {
    it("布尔类配置默认值符合预期", () => {
        const config = new SnippetsConfig();
        expect(config.realTimePreview).toBe(true);
        expect(config.newSnippetEnabled).toBe(true);
        expect(config.consoleDebug).toBe(false);
        expect(config.autoReloadUIAfterModifyJS).toBe(true);
        expect(config.showDuplicateButton).toBe(false);
        expect(config.showDeleteButton).toBe(true);
        expect(config.showEditButton).toBe(true);
        expect(config.multipleSnippetEditors).toBe(true);
        expect(config.reloadUIAfterModifyJSNotice).toBe(true);
    });

    it("数值/枚举/文本类配置默认值符合预期", () => {
        const config = new SnippetsConfig();
        expect(config.snippetOptionClickBehavior).toBe(1);
        expect(config.snippetSortType).toBe("customSort");
        expect(config.snippetSearchType).toBe(1);
        expect(config.showPublishCheckbox).toBe(0);
        expect(config.defaultSnippetsType).toBe("css");
        expect(config.editorIndentUnit).toBe("followSiyuan");
        expect(config.fileWatchEnabled).toBe("disabled");
        expect(config.fileWatchPath).toBe("data/snippets");
        expect(config.fileWatchInterval).toBe(5);
        expect(config.topBarPosition).toBe("right");
    });

    it("默认对象相互独立（多实例互不影响）", () => {
        const a = new SnippetsConfig();
        const b = new SnippetsConfig();
        a.consoleDebug = true;
        a.defaultSnippetsType = "js";
        expect(b.consoleDebug).toBe(false);
        expect(b.defaultSnippetsType).toBe("css");
    });
});
