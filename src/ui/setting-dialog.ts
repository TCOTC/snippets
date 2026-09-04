// 插件设置对话框装配与交互（原 index.ts openSetting 方法外迁）
// 运行态依赖（日志/文案/设置项列表/对话框簿记等）经 SettingDialogHost 注入，由插件实例以箭头函数实时转发。
import {Constants, Dialog, openSetting} from "siyuan";
import type {App} from "siyuan";
import type {SettingItem} from "../types";

// 思源 3.7.0+ 的 openSetting 支持第二个参数 tab 用于指定初始选项卡
// petal 仓库的类型定义尚未更新，这里通过类型断言绕过类型检查
// 等 petal 仓库更新类型定义后可直接使用 openSetting 并移除此辅助函数
const openSettingTab = openSetting as (app: Parameters<typeof openSetting>[0], tab?: string) => Dialog | undefined;

// 等待原生设置对话框选项卡异步挂载的最大重试次数（约 1.6 秒@60fps，应对慢速设备与异常情况）
const SETTING_TAB_MOUNT_MAX_RETRIES = 100;

/**
 * 设置对话框所需的插件运行态（读取器/动作函数形式，调用时才取值或执行）
 */
export interface SettingDialogHost {
    /** 插件日志器 */
    logger: {
        log(...args: any[]): void;
        error(...args: any[]): void;
    };
    /** 读取：插件显示名 */
    displayName: () => string;
    /** 读取：插件 i18n 文案 */
    i18n: () => any;
    /** 读取：是否移动端 */
    isMobile: () => boolean;
    /** 读取：思源应用实例（打开原生设置对话框用） */
    app: () => App;
    /** 读取：设置项列表（initSetting 时构建于 this.setting.items） */
    settingItems: () => SettingItem[];
    /** 动作：注册事件监听（走插件统一簿记，对话框销毁时随之移除） */
    addListener: (element: HTMLElement, event: string, fn: (event?: Event) => void, options?: AddEventListenerOptions) => void;
    /** 动作：关闭并销毁设置对话框（含移除其全部监听与全局按键监听） */
    closeDialog: (dialogElement: HTMLElement) => void;
    /** 动作：保存设置（读对话框控件 → 写入配置 → 触发 onApply） */
    saveSetting: (dialogElement: HTMLElement) => void;
    /** 动作：关闭顶栏菜单（打开原生设置前需要，否则对话框内容器无法滚动） */
    closeMenu: () => void;
    /** 动作：导出所有代码片段为 JSON 文件 */
    exportSnippets: () => void;
    /** 动作：从文件导入代码片段 */
    importSnippets: (overwrite: boolean) => void;
    /** 读取：全局键盘事件处理器（对话框打开期间监听于 documentElement） */
    globalKeyDownHandler: () => (event: KeyboardEvent) => void;
}

/**
 * 设置对话框管理器（原 index.ts openSetting 方法外迁，行为等价）
 * 参考原生代码 app/src/plugin/Setting.ts Setting.open 方法
 */
export class SettingDialog {
    private readonly host: SettingDialogHost;

    constructor(host: SettingDialogHost) {
        this.host = host;
    }

    /**
     * 打开插件设置窗口（插件实例上的公开 openSetting 方法委托到此）
     */
    open() {
        // 生成设置对话框元素
        const dialog = new Dialog({
            title: this.host.displayName(),
            content: `
<div class="b3-dialog__content"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${this.host.i18n().cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-type="confirm">${this.host.i18n().save}</button>
</div>
            `,
            width: this.host.isMobile() ? "92vw" : "768px",
            height: "80vh",
        });
        (dialog.element as any).dialogObject = dialog;

        dialog.element.setAttribute("data-key", "jcsm-setting-dialog");
        dialog.element.setAttribute("data-modal", "true");  // 标记为模态对话框
        dialog.element.setAttribute("data-mobile", this.host.isMobile() ? "true" : "false"); // CSS 样式用到这个属性
        const contentElement = dialog.element.querySelector(".b3-dialog__content")!;
        this.host.settingItems().forEach((item) => {
            let html: string;
            const actionElement = item.actionElement ?? item.createActionElement?.();
            const tagName = actionElement?.classList.contains("b3-switch") ? "label" : "div";
            if (typeof item.direction === "undefined") {
                item.direction = (!actionElement || "TEXTAREA" === actionElement.tagName) ? "row" : "column";
            }
            if (item.direction === "row") {
                html = `
<${tagName} class="b3-label">
    <div class="fn__block">
        ${item.title ?? ""}
        ${item.description ? `<div class="b3-label__text">${item.description}</div>` : ""}
        <div class="fn__hr"></div>
    </div>
</${tagName}>
                `;
            } else {
                html = `
<${tagName} class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${item.title ?? ""}
        ${item.description ? `<div class="b3-label__text">${item.description}</div>` : ""}
    </div>
    ${actionElement ? "<span class='fn__space'></span>" : ""}
</${tagName}>
                `;
            }
            contentElement.insertAdjacentHTML("beforeend", html);
            if (actionElement) {
                if (item.direction === "row") {
                    contentElement.lastElementChild?.lastElementChild?.insertAdjacentElement("beforeend", actionElement);
                    actionElement.classList.add("fn__block");
                } else {
                    actionElement.classList.remove("fn__block");
                    actionElement.classList.add("fn__flex-center", "fn__size200");
                    contentElement.lastElementChild?.insertAdjacentElement("beforeend", actionElement);
                }
            }
        });

        const closeElement = dialog.element.querySelector(".b3-dialog__close") as HTMLElement;
        const scrimElement = dialog.element.querySelector(".b3-dialog__scrim") as HTMLElement;

        dialog.destroyNative = dialog.destroy;
        dialog.destroy = () => {
            this.host.logger.log("settingDialog destroy");
            this.host.closeDialog(dialog.element);
        };

        // 设置对话框点击事件
        const dialogClickHandler = (event: MouseEvent) => {
            // 阻止冒泡，否则点击 Dialog 时会导致 menu 关闭
            event.stopPropagation();

            const target = event.target as HTMLElement;
            const tagName = target.tagName.toLowerCase();
            const isScrim = target.classList.contains("b3-dialog__scrim");
            const isDispatch = typeof event.detail === "string";
            if (tagName === "button" || isScrim || isDispatch) {
                const type = target.dataset.type;
                if (type === "cancel" || isScrim || (isDispatch && event.detail === "Escape")) {
                    event.stopPropagation();
                    this.host.closeDialog(dialog.element);
                } else if (type === "confirm" || (isDispatch && event.detail === "Enter")) {
                    event.stopPropagation();
                    this.host.saveSetting(dialog.element);
                }
            } else if (target === closeElement || target === scrimElement) {
                this.host.closeDialog(dialog.element);
            }

            // 执行特殊操作
            const action = target.closest("[data-action]")?.getAttribute("data-action");
            if (action) {
                if (action === "settingsSnippets") {
                    event.preventDefault();
                    event.stopPropagation();
                    this.host.closeMenu(); // 不关闭菜单的话对话框中的容器无法滚动

                    // 过程中隐藏设置对话框，避免闪烁
                    const styleSheet = document.createElement("style");
                    styleSheet.textContent = "body > div[data-key='dialog-setting'] { display: none; }";
                    document.head.appendChild(styleSheet);

                    const settingDialog = openSettingTab(this.host.app(), "appearance")!; // 直接打开并切换到外观选项卡（参考原生代码 app/src/config/index.ts openSetting 方法）
                    const settingDialogElement = settingDialog.element;
                    // 外观选项卡的内容是异步挂载的，需要等待 #codeSnippet 按钮出现后再点击
                    let codeSnippetRetryCount = 0;
                    const clickCodeSnippetButton = () => {
                        const codeSnippetButton = settingDialogElement.querySelector("button#codeSnippet");
                        if (codeSnippetButton) {
                            // 点击代码片段设置按钮，打开窗口
                            codeSnippetButton.dispatchEvent(new CustomEvent("click"));
                            settingDialog.destroy();
                            setTimeout(() => {
                                // destroy 有个关闭动画，需要等待动画结束才能移除样式（参考原生代码 app/src/dialog/index.ts Dialog.destroy 方法）
                                document.head.removeChild(styleSheet);
                            }, Constants.TIMEOUT_DBLCLICK);
                        } else if (++codeSnippetRetryCount < SETTING_TAB_MOUNT_MAX_RETRIES) {
                            requestAnimationFrame(clickCodeSnippetButton);
                        } else {
                            // 等待超时：清理资源并恢复界面
                            this.host.logger.error("settingsSnippets: #codeSnippet not found, giving up");
                            settingDialog.destroy();
                            document.head.removeChild(styleSheet);
                        }
                    };
                    requestAnimationFrame(clickCodeSnippetButton);

                } else if (action === "settingsKeymap") {
                    event.preventDefault();
                    event.stopPropagation();
                    this.host.closeMenu(); // 不关闭菜单的话对话框中的容器无法滚动

                    const settingDialogElement = openSettingTab(this.host.app(), "keymap")!.element; // 直接打开并切换到快捷键选项卡（参考原生代码 app/src/config/index.ts openSetting 方法）

                    // 查找并点击指定文本
                    const clickListItemByText = (container: Element, text: string) => {
                        const items = container.querySelectorAll(".b3-list-item__text");
                        for (let i = 0; i < items.length; i++) {
                            const item = items[i] as HTMLElement;
                            if (item.textContent === text) {
                                item.dispatchEvent(new CustomEvent("click", { bubbles: true }));
                                return item;
                            }
                        }
                        return null;
                    };

                    // 快捷键选项卡的内容是异步挂载的，需要等待 #keymapList 出现后再点击插件名和 reloadUI 快捷键选项
                    let keymapRetryCount = 0;
                    const clickPluginAndReloadUI = () => {
                        const keymapList = settingDialogElement.querySelector("#keymapList");
                        if (!keymapList) {
                            if (++keymapRetryCount < SETTING_TAB_MOUNT_MAX_RETRIES) {
                                requestAnimationFrame(clickPluginAndReloadUI);
                            } else {
                                // 等待超时：设置对话框保持打开，用户可手动操作
                                this.host.logger.error("settingsKeymap: #keymapList not found, please locate reloadUI manually");
                            }
                            return;
                        }
                        // 先点击插件名展开命令列表，再点击 reloadUI 快捷键选项
                        const pluginItem = clickListItemByText(settingDialogElement, this.host.displayName());
                        if (pluginItem?.parentElement?.nextElementSibling) {
                            clickListItemByText(pluginItem.parentElement.nextElementSibling, this.host.i18n().reloadUI);
                        }
                    };
                    requestAnimationFrame(clickPluginAndReloadUI);
                } else if (action === "exportSnippets") {
                    // 导出所有代码片段为 JSON 文件
                    event.preventDefault();
                    event.stopPropagation();
                    this.host.exportSnippets();
                } else if (action.startsWith("importSnippets")) {
                    // 通过浏览器 API 导入文件
                    event.preventDefault();
                    event.stopPropagation();

                    if (action === "importSnippetsWithAppend") {
                        // 追加到当前代码片段列表的开头，如果有 ID 与当前代码片段列表中的 ID 重复，则重新生成 ID
                        this.host.importSnippets(false);
                    } else if (action === "importSnippetsWithOverwrite") {
                        // 直接覆盖所有代码片段
                        this.host.importSnippets(true);
                    }
                }
                // TODO功能: 移动端的导出导入
            }
        };

        // 添加事件监听
        this.host.addListener(dialog.element, "click", dialogClickHandler, {capture: true});
        this.host.addListener(document.documentElement, "keydown", this.host.globalKeyDownHandler());
        this.host.addListener(dialog.element, "wheel", (event: WheelEvent) => {
            // 在菜单打开的情况下，桌面端无法滚轮滚动设置对话框的 .b3-dialog__content，需要阻止事件冒泡
            event.stopPropagation();
        }, {passive: true});
        this.host.addListener(dialog.element, "touchmove", (event: TouchEvent) => {
            // 在菜单打开的情况下，移动端无法上下划动设置对话框的 .b3-dialog__content，需要阻止事件冒泡
            event.stopPropagation();
        }, {passive: true});
    }
}
