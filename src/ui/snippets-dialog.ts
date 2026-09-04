// 代码片段对话框（确认对话框与按元素关闭基础件；原 index.ts「对话框相关」分节部分外迁，行为等价）
// 职责：删除确认/放弃编辑确认/通用确认对话框的创建与交互、按元素关闭对话框（含 CodeMirror 编辑器销毁、
// 监听器移除与 destroyCallback/超时兜底）、收集已打开的插件模态对话框。
// 代码片段编辑对话框（genSnippetEditDialog/openSnippetEditDialog）尚未外迁，后续批次迁入后由本类一并承载。
// 运行态依赖（日志/文案/移动端判断/监听簿记/菜单编辑按钮高亮/全局按键清理/主题监听联动）经 SnippetsDialogHost 注入。
import {Constants, Dialog} from "siyuan";
import type {Snippet} from "../types";

/**
 * 对话框所需的插件运行态（读取器/动作函数形式，调用时才取值或执行）
 */
export interface SnippetsDialogHost {
    /** 插件日志器 */
    logger: {
        log(...args: any[]): void;
        warn(...args: any[]): void;
        error(...args: any[]): void;
    };
    /** 读取：插件 i18n 文案 */
    i18n: () => any;
    /** 读取：是否移动端 */
    isMobile: () => boolean;
    /** 动作：注册事件监听（走插件统一簿记，对话框销毁时随之移除） */
    addListener: (element: HTMLElement, event: string, fn: (event?: Event) => void, options?: AddEventListenerOptions) => void;
    /** 动作：移除事件监听 */
    removeListener: (element: HTMLElement, event?: string, fn?: (event?: Event) => void, options?: AddEventListenerOptions) => void;
    /** 动作：移除菜单项编辑按钮高亮（代码片段编辑对话框关闭时调用） */
    removeSnippetEditButtonActive: (snippetId: string) => void;
    /** 动作：窗口内没有 Dialog 和菜单后移除全局按键事件监听 */
    destroyGlobalKeyDownHandler: () => void;
    /** 动作：检查并管理主题模式监听（最后一个编辑器对话框关闭时停止） */
    checkThemeWatch: () => void;
}

/**
 * 代码片段对话框管理器（原 index.ts openSnippetDeleteDialog/openSnippetCancelDialog/openConfirmDialog/
 * closeDialogByElement/getAllModalDialogElements 外迁，行为等价）
 */
export class SnippetsDialog {
    private readonly host: SnippetsDialogHost;

    constructor(host: SnippetsDialogHost) {
        this.host = host;
    }

    /**
     * 打开代码片段删除对话框
     * @param snippetName 代码片段名称
     * @param confirm 确认回调
     */
    openDeleteDialog(snippetName: string, confirm?: () => void) {
        // TODO功能: 实现了代码片段回收站之后，增加一个“不再提示”按钮，点击之后修改配置项、弹出消息说明可以在插件设置中开关
        this.openConfirm(
            this.host.i18n().deleteConfirm,
            this.host.i18n().deleteConfirmDescription.replace("${x}", snippetName ? " <b>" + snippetName + "</b> " : ""),
            "jcsm-snippet-delete",
            undefined,
            this.host.i18n().delete,
            () => {
                // 删除代码片段
                confirm?.();
            }
        );

        // 不需要移除菜单上的 b3-menu__item--current，方便判断点击的是哪个代码片段
        // this.unselectSnippet();
    }

    /**
     * 打开代码片段取消对话框
     * @param snippet 代码片段
     * @param isNew 是否是新建代码片段
     * @param changes 变更内容
     * @param confirm 确认回调
     * @param cancel 取消回调
     */
    openCancelDialog(snippet: Snippet, isNew?: boolean, changes?: string[], confirm?: () => void, cancel?: () => void) {
        const snippetName = snippet.name.trim();
        let text: string;
        if (isNew) {
            text = this.host.i18n().cancelConfirmNewSnippet
                .replace("${y}", snippetName ? " <b>" + snippetName + "</b> " : "");
        } else {
            // 将每个 change 用 <b> 标签包裹
            const changesText = changes?.map(change => `<b>${change}</b>`).join(", ") ?? "";
            text = this.host.i18n().cancelConfirmEditSnippet
                .replace("${x}", changesText)
                .replace("${y}", snippetName ? " <b>" + snippetName + "</b> " : "");
        }

        this.openConfirm(
            this.host.i18n().cancelConfirm,
            text,
            "jcsm-snippet-cancel",
            this.host.i18n().continueEdit,
            this.host.i18n().giveUpEdit,
            () => { confirm?.(); }, // 取消编辑代码片段
            () => { cancel?.(); }
        );
    }

    /**
     * 打开确认对话框（参考原生代码 app/src/dialog/confirmDialog.ts ）
     * @param title 对话框标题
     * @param text 对话框内容
     * @param dataKey 对话框元素的 data-key 属性值
     * @param cancelText 取消按钮文本
     * @param confirmText 确认按钮文本
     * @param confirm 确认回调
     * @param cancel 取消回调
     */
    openConfirm(title: string, text: string, dataKey?: string, cancelText?: string, confirmText?: string, confirm?: () => void, cancel?: () => void) {
        if (!text && !title) {
            confirm?.();
            return;
        }

        const redButton = dataKey === "jcsm-snippet-delete" || dataKey === "jcsm-snippet-cancel"; // 删除和放弃修改按钮是红色

        const dialog = new Dialog({
            title,
            content: `
<div class="b3-dialog__content">
    <div class="ft__breakword">${text}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${ cancelText ?? this.host.i18n().cancel }</button>
    <div class="fn__space"></div>
    <button class="b3-button ${ redButton ? "b3-button--remove" : "b3-button--text"}" data-type="confirm">${ confirmText ?? this.host.i18n().confirm}</button>
</div>
            `,
            width: this.host.isMobile() ? "92vw" : "520px",
        });
        (dialog.element as any).dialogObject = dialog;

        dialog.element.setAttribute("data-key", dataKey ?? "dialog-confirm"); // Constants.DIALOG_CONFIRM
        dialog.element.setAttribute("data-modal", "true");  // 标记为模态对话框
        const container = dialog.element.querySelector(".b3-dialog__container") as HTMLElement;
        if (container) container.style.maxHeight = "90vh";

        const closeElement = dialog.element.querySelector(".b3-dialog__close") as HTMLElement;
        const scrimElement = dialog.element.querySelector(".b3-dialog__scrim") as HTMLElement;

        dialog.destroyNative = dialog.destroy;
        dialog.destroy = () => {
            this.host.logger.log("confirmDialog destroy");
            cancel?.();
            this.closeByElement(dialog.element);
        };

        // 在菜单打开的情况下，移动端无法上下划动对话框中的滚动容器，需要阻止事件冒泡
        this.host.addListener(dialog.element, "touchmove", (event: TouchEvent) => {
            event.stopPropagation();
        }, {passive: true});

        this.host.addListener(dialog.element, "click", (event: KeyboardEvent) => {
            this.host.logger.log("confirmDialog click", event);
            // 阻止冒泡，否则点击 Dialog 时会导致 menu 关闭
            event.stopPropagation();
            let target = event.target as HTMLElement;
            const isDispatch = typeof event.detail === "string";
            while (target && target !== dialog.element || isDispatch) {
                if (target.dataset.type === "cancel" || (isDispatch && event.detail=== "Escape")) {
                        cancel?.();
                        this.closeByElement(dialog.element);
                    break;
                } else if (target.dataset.type === "confirm" || (isDispatch && event.detail=== "Enter")) {
                        confirm?.();
                        this.closeByElement(dialog.element);
                    break;
                } else if (target === closeElement || target === scrimElement) {
                    cancel?.();
                    this.closeByElement(dialog.element);
                    break;
                }
                target = target.parentElement as HTMLElement;
            }
        }, {capture: true});
    }

    /**
     * 通过元素关闭对话框
     * @param dialogElement 对话框元素
     */
    closeByElement(dialogElement: HTMLElement) {
        if (!dialogElement) {
            this.host.logger.error("closeDialogByElement: dialogElement is undefined, return");
            return;
        }
        this.host.logger.log("closeDialogByElement: dialogElement:", dialogElement);

        // 如果是代码片段编辑对话框
        if (dialogElement.dataset.key === "jcsm-snippet-dialog") {
            // 销毁 CodeMirror 编辑器
            const editorElement = dialogElement.querySelector(".jcsm-dialog-content .cm-editor");
            if (editorElement && (editorElement as any).cmView && (editorElement as any).cmView.destroy) {
                this.host.logger.log("closeDialogByElement: destroying CodeMirror editor");
                (editorElement as any).cmView.destroy();
            }
            // 移除菜单项编辑按钮的背景色
            this.host.removeSnippetEditButtonActive(dialogElement.dataset.snippetId!);
        }

        // 移除事件监听器
        this.host.removeListener(dialogElement);

        const destroyEventHandler = () => {
            // Dialog 移除之后再移除全局键盘事件监听，因为需要判断窗口中是否还存在菜单和 Dialog
            this.host.destroyGlobalKeyDownHandler();
            // 检查并停止主题模式监听（在最后一个编辑器对话框关闭时）
            this.host.checkThemeWatch();
        };

        let isDestroyed = false;
        const dialogObject = (dialogElement as any).dialogObject;
        const destroyCallback = dialogObject.destroyCallback || undefined;
        if (dialogObject) {
            dialogObject.destroyCallback = () => {
                isDestroyed = true;
                // 调用原有的 destroyCallback
                destroyCallback?.();
                destroyEventHandler();
            };
            // 修改 zIndex 以避免 menu 被移除 https://github.com/siyuan-note/siyuan/blob/ffad6048fdd677c78b6649d94315d3702391beb2/app/src/dialog/index.ts#L91-L95
            (dialogElement.querySelector(".b3-dialog") as HTMLElement).style.zIndex = ((parseInt(window.siyuan.menus.menu.element.style.zIndex) || 0) + 1).toString();
            dialogObject.destroyNative();
        }

        // 基本是原生 dialog.destroy() 的逻辑，但移除了不必要的操作
        const customDestroy = (options?: any) => {
            dialogElement.classList.remove("b3-dialog--open");
            setTimeout(() => {
                dialogElement.remove();
                if (destroyCallback) {
                    destroyCallback(options);
                }
                window.siyuan.dialogs.find((item: Dialog, index: number) => {
                    if (item.id === dialogObject.id) {
                        window.siyuan.dialogs.splice(index, 1);
                        return true;
                    }
                });
                // https://github.com/siyuan-note/siyuan/issues/10475
                document.getElementById("drag")?.classList.remove("fn__hidden");
            }, Constants.TIMEOUT_DBLCLICK);
        };

        // 1 秒后检查是否已销毁，没有的话则手动销毁
        setTimeout(() => {
            if (!isDestroyed) {
                customDestroy();
                destroyEventHandler();
            }
        }, 1000);
    }

    /**
     * 获取所有模态对话框元素
     * @returns 对话框元素数组
     */
    getAllModalElements(): HTMLElement[] {
        // 模态对话框打开时，不允许打开或操作菜单和代码片段编辑对话框，否则 globalKeyDownHandler() 判断不了 Escape 和 Enter 按键是对哪个元素的操作
        return Array.from(document.querySelectorAll("body > .b3-dialog--open[data-key^='jcsm-']:not([data-modal='false'])")) as HTMLElement[];
    }
}
