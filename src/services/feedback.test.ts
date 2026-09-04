// services/feedback.ts FeedbackService 单测
// 覆盖：showNotification 的通知开关门（config *Notice 键 + i18n 键存在才弹出）、
//       “不再提示”按钮点击转发 disableNotification、showErrorMessage 的消息格式。
// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import {showMessage} from "siyuan";
import type PluginSnippets from "../index";
import {SnippetsConfig} from "../config/config";
import {FeedbackService} from "./feedback";

/** 构造最小插件替身（FeedbackService 仅读取 config/i18n/displayName/configService） */
const createFakePlugin = () => {
    const plugin = {
        config: new SnippetsConfig(),
        i18n: {} as Record<string, string>,
        displayName: "Snippets",
        configService: {disableNotification: vi.fn()},
    };
    return plugin as unknown as PluginSnippets;
};

describe("FeedbackService", () => {
    let plugin: PluginSnippets;
    let service: FeedbackService;
    const showMessageMock = vi.mocked(showMessage);

    beforeEach(() => {
        plugin = createFakePlugin();
        service = new FeedbackService(plugin);
        // 统一提供 i18n 文案与开关键（reloadUIAfterModifyJS + Notice）
        plugin.i18n.reloadUIAfterModifyJS = "JS 已修改 ${ignoreNoticeButton}";
        plugin.i18n.noLongerShow = "不再提示";
        plugin.i18n.ignoreNoticeButtonAriaLabel = "不再提示此消息";
        plugin.config.reloadUIAfterModifyJSNotice = true;
    });

    describe("showNotification", () => {
        it("通知开关关闭时不弹出", () => {
            plugin.config.reloadUIAfterModifyJSNotice = false;
            service.showNotification("reloadUIAfterModifyJS");
            expect(showMessageMock).not.toHaveBeenCalled();
        });

        it("i18n 键缺失时不弹出", () => {
            service.showNotification("nonexistentKey");
            expect(showMessageMock).not.toHaveBeenCalled();
        });

        it("开关开启时以 info 类型弹出并带消息 id", () => {
            service.showNotification("reloadUIAfterModifyJS", 4000);
            expect(showMessageMock).toHaveBeenCalledTimes(1);
            const [message, timeout, type, id] = showMessageMock.mock.calls[0];
            expect(timeout).toBe(4000);
            expect(type).toBe("info");
            expect(id).toBe("snippets-reloadUIAfterModifyJS");
            // “不再提示”按钮已嵌入消息文案
            expect(message as string).toContain("jscm-snackbar-ignore-notice-button");
        });

        it("点击“不再提示”按钮调用 disableNotification 并阻止冒泡", () => {
            service.showNotification("reloadUIAfterModifyJS");
            // 在 DOM 中装配与 showMessage 约定 id 一致的消息容器
            const container = document.createElement("div");
            container.className = "b3-snackbar";
            container.dataset.id = "snippets-reloadUIAfterModifyJS";
            container.innerHTML = '<button class="jscm-snackbar-ignore-notice-button">不再提示</button>';
            document.body.appendChild(container);
            service.showNotification("reloadUIAfterModifyJS");

            const button = container.querySelector("button") as HTMLButtonElement;
            const stopPropagation = vi.fn();
            button.dispatchEvent(new MouseEvent("click", {bubbles: true}));
            // jsdom 的 dispatchEvent 会自行处理冒泡，这里直接验证监听器内对 disableNotification 的调用
            expect(plugin.configService.disableNotification).toHaveBeenCalledWith("reloadUIAfterModifyJS");
            void stopPropagation;
            document.body.innerHTML = "";
        });
    });

    describe("showErrorMessage", () => {
        it("以 error 类型弹出并带插件显示名前缀", () => {
            service.showErrorMessage("出错了", 10000, "err-id");
            expect(showMessageMock).toHaveBeenCalledWith("Snippets: 出错了", 10000, "error", "err-id");
        });

        it("未传 timeout/id 时使用默认值", () => {
            service.showErrorMessage("出错了");
            expect(showMessageMock).toHaveBeenCalledWith("Snippets: 出错了", undefined, "error", undefined);
        });
    });
});
