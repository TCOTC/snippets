// 通知与错误提示（原 index.ts「消息处理」分节外迁）
// 职责：showNotification（仅弹出设置中存在的通知，含"不再提示"按钮）；showErrorMessage（错误提示）。
// 简洁化：不设 Host——直接持有 PluginSnippets 实例（import type 避免运行时循环依赖），
// 配置开关经插件实例 defineProperty 代理读取（含 *Notice 通知开关镜像）。
import {showMessage} from "siyuan";
import type PluginSnippets from "../index";

const PLUGIN_NAME = "snippets";                    // 插件名（通知消息 id 前缀用）

/**
 * 通知/错误提示服务（原 index.ts「消息处理」分节外迁）
 * 消息 id 统一带插件名前缀（PLUGIN_NAME + "-" + messageI18nKey），反复弹出同消息不会互相覆盖。
 */
export class FeedbackService {
    private readonly plugin: PluginSnippets;

    /**
     * 是否开启通知
     */
    private notificationSwitch = true; // 暂时默认开启

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 弹出通知（仅限在插件设置中存在选项的通知可以使用该方法）
     * @param messageI18nKey 消息的 i18n 键
     * @param timeout 消息显示时间（毫秒）；-1 永不关闭；0 永不关闭，添加一个关闭按钮；undefined 默认 6000 毫秒
     */
    showNotification(messageI18nKey: string, timeout: number | undefined = undefined) {
        if (this.notificationSwitch && (this.plugin as any)[messageI18nKey + "Notice"] && this.plugin.i18n[messageI18nKey]) {
            // 全局通知开关开启、该通知选项开启、i18n 键存在 → 弹出通知
            const ignoreNoticeButton = `<button class='jscm-snackbar-ignore-notice-button b3-button ariaLabel' aria-label='${this.plugin.i18n.ignoreNoticeButtonAriaLabel}'>${this.plugin.i18n.noLongerShow}</button>`;
            const message = this.plugin.i18n[messageI18nKey].replace("${ignoreNoticeButton}", ignoreNoticeButton);
            const messageId = PLUGIN_NAME + "-" + messageI18nKey;
            // 传入 messageId 参数之后，反复弹出相同的消息时，不会关闭上一个消息再弹出新消息
            showMessage(message, timeout, "info", messageId);
            // “不再提示”按钮绑定（原为内联 onclick 调 window.siyuan.jcsm.disableNotification 全局，
            // 收敛后改为元素事件绑定——按钮随消息容器同生共死，无需全局函数；容器 id 由 showMessage 保证）
            const button = document.querySelector(`.b3-snackbar[data-id="${messageId}"] .jscm-snackbar-ignore-notice-button`) as HTMLButtonElement | null;
            button?.addEventListener("click", (event) => {
                event.stopPropagation();
                this.plugin.configService.disableNotification(messageI18nKey);
            });
        }
    }

    /**
     * 弹出错误消息
     * @param message 错误消息
     * @param timeout 消息显示时间（毫秒）；-1 永不关闭；0 永不关闭，添加一个关闭按钮；undefined 默认 6000 毫秒
     * @param id 消息的 ID
     */
    showErrorMessage(message: string, timeout: number | undefined = undefined, id?: string) {
        showMessage(this.plugin.displayName + ": " + message, timeout, "error", id);
    }
}
