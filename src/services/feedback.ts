// 通知与错误提示（原 index.ts「消息处理」分节外迁）
// 职责：showNotification（仅弹出设置中存在的通知，含"不再提示"按钮）；showErrorMessage（错误提示）。
// 运行态依赖（文案/显示名/配置开关读取）经 FeedbackHost 注入，由插件实例以箭头函数实时转发。
import {showMessage} from "siyuan";

const PLUGIN_NAME = "snippets";                    // 插件名（通知消息 id 前缀用）

/**
 * 通知/提示所需的插件运行态（读取器/动作函数形式，调用时才取值）
 */
export interface FeedbackHost {
    /** 读取：插件显示名 */
    displayName: () => string;
    /** 读取：插件 i18n 文案 */
    i18n: () => any;
    /** 读取：配置项当前值（通知开关等经插件实例 defineProperty 代理到全局镜像） */
    readConfig: (key: string) => any;
}

/**
 * 通知/错误提示服务（原 index.ts「消息处理」分节外迁）
 * 消息 id 统一带插件名前缀（PLUGIN_NAME + "-" + messageI18nKey），反复弹出同消息不会互相覆盖。
 */
export class FeedbackService {
    private readonly host: FeedbackHost;

    /**
     * 是否开启通知
     */
    private notificationSwitch = true; // 暂时默认开启

    constructor(host: FeedbackHost) {
        this.host = host;
    }

    /**
     * 弹出通知（仅限在插件设置中存在选项的通知可以使用该方法）
     * @param messageI18nKey 消息的 i18n 键
     * @param timeout 消息显示时间（毫秒）；-1 永不关闭；0 永不关闭，添加一个关闭按钮；undefined 默认 6000 毫秒
     */
    showNotification(messageI18nKey: string, timeout: number | undefined = undefined) {
        if (this.notificationSwitch && this.host.readConfig(messageI18nKey + "Notice") && this.host.i18n()[messageI18nKey]) {
            // 全局通知开关开启、该通知选项开启、i18n 键存在 → 弹出通知
            const ignoreNoticeButton = `<button class='jscm-snackbar-ignore-notice-button b3-button ariaLabel' aria-label='${this.host.i18n().ignoreNoticeButtonAriaLabel}' onclick='event.stopPropagation(); window.siyuan.jcsm.disableNotification(\"${messageI18nKey}\");'>${this.host.i18n().noLongerShow}</button>`;
            const message = this.host.i18n()[messageI18nKey].replace("${ignoreNoticeButton}", ignoreNoticeButton);
            // 传入 messageId 参数之后，反复弹出相同的消息时，不会关闭上一个消息再弹出新消息
            showMessage(message, timeout, "info", PLUGIN_NAME + "-" + messageI18nKey);
        }
    }

    /**
     * 弹出错误消息
     * @param message 错误消息
     * @param timeout 消息显示时间（毫秒）；-1 永不关闭；0 永不关闭，添加一个关闭按钮；undefined 默认 6000 毫秒
     * @param id 消息的 ID
     */
    showErrorMessage(message: string, timeout: number | undefined = undefined, id?: string) {
        showMessage(this.host.displayName() + ": " + message, timeout, "error", id);
    }
}
