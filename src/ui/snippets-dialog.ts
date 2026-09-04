// 代码片段对话框
// 职责：代码片段编辑对话框的装配与交互（生成 HTML/打开/取消/预览/保存/事件绑定）、删除确认/放弃编辑确认/
// 通用确认对话框、按元素关闭对话框（含 CodeMirror 编辑器销毁、监听器移除与 destroyCallback/超时兜底）、
// 收集已打开的插件模态对话框。
import {Constants, Dialog} from "siyuan";
import {attachDialogObject, genSnippetSwitchHtml, getDialogObject, moveElementToTop, SNIPPET_DIALOG_DATA_KEY, SNIPPET_DIALOG_SELECTOR} from "../utils";
import {createCodeMirrorEditor, getEditorView} from "./editor-manager";
import type PluginSnippets from "../index";
import type {Snippet} from "../types";

/**
 * 代码片段对话框管理器
 * 公开 genEditDialogHtml/openEditDialog/openDeleteDialog/openCancelDialog/openConfirm/reloadUI/closeByElement/closeAllDialogs/getAllModalElements
 */
export class SnippetsDialog {
    private readonly plugin: PluginSnippets;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 生成代码片段编辑对话框
     * @param snippet 代码片段
     * @param confirmText 确认按钮的文案
     * @returns 代码片段编辑对话框 HTML 字符串
     */
    private genEditDialogHtml(snippet: Snippet, confirmText: string = this.plugin.i18n.save): string {
        const showPublishCheckbox = this.plugin.menuView.isShowPublishCheckbox();
        // TODO功能: 在删除按钮左边加一个创建副本按钮（始终显示），点击之后创建副本（不直接保存，是新建的代码片段，需要手动点击保存按钮）并且打开编辑对话框
        return `
<div class="jcsm-dialog">
    <div class="jcsm-dialog-header resize__move"></div>
    <div class="jcsm-dialog-container">
        <div class="fn__flex">
            <input class="jcsm-dialog-name fn__flex-1 b3-text-field" spellcheck="false" placeholder="${this.plugin.i18n.title}">
            <div class="fn__space"></div>
            <button data-action="delete" class="block__icon block__icon--show ariaLabel fn__none" aria-label="${this.plugin.i18n.deleteSnippet}" data-position="north">
                <svg><use xlink:href="#iconTrashcan"></use></svg>
            </button>
            <div class="fn__space"></div>
            ${genSnippetSwitchHtml("publishSwitch", !snippet.disabledInPublish, "", this.plugin.i18n.snippetDisabledInPublish, !showPublishCheckbox)}
            <div class="fn__space"></div>
            ${genSnippetSwitchHtml("snippetSwitch", snippet.enabled, "")}
        </div>
        <div class="fn__hr"></div>
        <div class="jcsm-dialog-content"></div>
        <div class="fn__hr--b"></div>
    </div>
    <div class="b3-dialog__action">
        <button data-action="cancel" class="b3-button b3-button--cancel">${this.plugin.i18n.cancel}</button>
        <div class="fn__space"></div>
        <button data-action="preview" class="b3-button b3-button--text${snippet.type === "js" || this.plugin.config.realTimePreview ? " fn__none" : ""}">${this.plugin.i18n.preview}</button>
        <div class="fn__space"></div>
        <button data-action="confirm" class="b3-button b3-button--text">${confirmText}</button>
    </div>
</div>
        `;
    }

    /**
     * 打开代码片段编辑对话框
     * @param snippet 代码片段
     * @param isNew 是否为新建代码片段
     * @returns 是否成功打开对话框
     */
    async openEditDialog(snippet: Snippet, isNew?: boolean): Promise<boolean> {
        if (this.getAllModalElements().length > 0) return false;

        // 检查参数
        const paramError: string[] = [];
        if (!snippet) {
            paramError.push(this.plugin.i18n.snippet);
        } else {
            if (!snippet.id) {
                paramError.push(this.plugin.i18n.snippetId);
            }
            if (!snippet.type) {
                paramError.push(this.plugin.i18n.snippetType);
            }
        }
        if (paramError.length > 0) {
            this.plugin.showErrorMessage(this.plugin.i18n.snippetDialogParamError + "[" + paramError.join(", ") + "]");
            return false;
        }

        // 给对应的菜单项的编辑按钮添加背景色
        this.plugin.menuView.setSnippetEditButtonActive(snippet.id);

        // 如果已经有打开的对应 snippetId 的 Dialog，则仅激活它，不重复创建
        const existedDialog = document.querySelector(`${SNIPPET_DIALOG_SELECTOR}[data-snippet-id="${snippet.id}"]`) as HTMLDivElement;
        if (existedDialog) {
            moveElementToTop(existedDialog);
            return true;
        }

        // 创建 Dialog
        const dialog = new Dialog({
            content: this.genEditDialogHtml(snippet, isNew ? this.plugin.i18n.new : undefined),
            width: this.plugin.isMobile ? "92vw" : "70vw",
            height: "80vh",
            hideCloseIcon: this.plugin.isMobile,
        });
        // 将 Dialog 实例挂到元素上，供 closeByElement 按元素关闭时取回（见 utils.attachDialogObject）
        attachDialogObject(dialog.element, dialog);

        // 设置 Dialog 属性
        dialog.element.setAttribute("data-key", SNIPPET_DIALOG_DATA_KEY);
        dialog.element.setAttribute("data-snippet-id", snippet.id);
        dialog.element.setAttribute("data-snippet-type", snippet.type);

        if (!isNew) {
            // 非新建代码片段时，显示删除按钮
            const deleteButton = dialog.element.querySelector("button[data-action='delete']") as HTMLButtonElement;
            deleteButton?.classList.remove("fn__none");
        }

        if (!this.plugin.isMobile && this.plugin.config.multipleSnippetEditors) {
            // 桌面端支持同时打开多个 Dialog，需要设置 Dialog 样式
            dialog.element.style.zIndex = (++window.siyuan.zIndex).toString();
            dialog.element.querySelector(".b3-dialog__scrim")?.remove();
            const dialogElement = dialog.element.querySelector(".b3-dialog") as HTMLElement;
            dialogElement.style.width = "0";
            dialogElement.style.height = "0";
            dialogElement.style.left = "50vw";
            dialogElement.style.top = "50vh";
            const dialogContainer = dialogElement.querySelector(".b3-dialog__container") as HTMLElement;
            dialogContainer.style.position = "fixed";
            dialog.element.setAttribute("data-modal", "false"); // 标记为非模态对话框
        } else {
            dialog.element.setAttribute("data-modal", "true");  // 标记为模态对话框
        }

        // 检查并启动主题模式监听（在第一个编辑器对话框打开时）
        this.plugin.editorManager.checkAndManageThemeWatch(true);

        // 设置代码片段标题和内容
        const nameElement = dialog.element.querySelector(".jcsm-dialog-name") as HTMLInputElement; // 标题不允许输入换行，所以得用 input 元素，textarea 元素没法在操作能 Ctrl+Z 撤回的前提下阻止用户换行
        nameElement.value = snippet.name;
        nameElement.focus();

        // 创建 CodeMirror 编辑器
        const contentContainer = dialog.element.querySelector(".jcsm-dialog-content") as HTMLElement;
        const codeMirrorView = createCodeMirrorEditor(contentContainer, snippet.content, snippet.type, this.plugin.config.editorIndentUnit, this.plugin.i18n);
        // codeMirrorView.contentDOM.focus();

        const publishSwitchInput = dialog.element.querySelector("input[data-type='publishSwitch']") as HTMLInputElement;
        const snippetSwitchInput = dialog.element.querySelector("input[data-type='snippetSwitch']") as HTMLInputElement;
        // switchInput.checked = snippet.enabled; // genSnippetDialog 的时候已经添加了 enabled 属性，这里不需要重复设置

        // 取消编辑代码片段
        const cancelHandler = async () => {
            const cancel = async () => {
                // 需要先关闭 Dialog，因为后面的 removeSnippetElement 会根据是否打开了 Dialog 来判断代码片段是否正在预览
                this.closeByElement(dialog.element);

                if (snippet.type === "css") {
                    // 退出预览操作，新建的代码片段需要移除元素，已有的代码片段需要恢复原始元素 https://github.com/TCOTC/snippets/issues/26
                    if (isNew) {
                        void this.plugin.snippetManager.removeSnippetElement(snippet.id, snippet.type);
                        // 发送广播消息，在其他窗口移除代码片段元素
                        this.plugin.syncService?.broadcast({type: "snippet_element_remove", snippetId: snippet.id, snippetType: snippet.type});
                    } else {
                        const realSnippet = await this.plugin.snippetManager.getSnippetById(snippet.id);
                        if (!realSnippet) return;
                        this.plugin.snippetManager.updateSnippetElement(realSnippet, undefined, false);
                        // 发送广播消息，在其他窗口更新代码片段元素
                        // 退出预览用的是已保存片段（可自拉），不携带原文，只发 snippetId + previewState: false
                        this.plugin.syncService?.broadcast({type: "snippet_element_update", snippetId: snippet.id, previewState: false});
                    }
                }
            };

            // 获取 Dialog 的焦点元素
            const focusElement = dialog.element.querySelector(":focus") as HTMLElement || dialog.element.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
            // 点击开关之后要移除焦点，不然弹出确认弹窗之后按 Esc 还是会触发 Dialog 上的 keydown 事件
            focusElement?.blur();

            const currentSnippet = await this.plugin.snippetManager.getSnippetById(snippet.id);
            if (currentSnippet === undefined) {
                // 如果当前代码片段不存在，说明是在“取消新建代码片段”
                // 问题案例：
                //  1、打开代码编辑器
                //  2、删除代码片段
                //  3、关闭代码编辑器会弹窗确认
                //  4、点击“放弃修改”之后没有正确关闭代码编辑器
                //  原因是 isNew 的值没有更新
                isNew = true;
                // 如果没有填任何内容，则直接关闭 Dialog
                if (nameElement.value.trim() === "" && codeMirrorView.state.doc.toString().trim() === "") {
                    cancel();
                    return;
                } else {
                    // 如果填了内容，则弹窗提示确认
                    this.openCancelDialog(snippet, true, undefined,
                        () => { cancel(); }, // 取消
                        () => { focusElement?.focus(); } // 恢复焦点
                    );
                    return;
                }
            } else if (currentSnippet === false) {
                // API 调用失败，无法确认是否存在更改，直接关闭 Dialog
                cancel();
                return;
            }

            const changes = [];
            // 用当前实际的状态来跟对话框中的内容来对比，而不是用对话框的初始 snippet 对象（比如在菜单修改了开关，但对话框的初始 snippet 对象不会同步更新）
            if (currentSnippet.name !== nameElement.value) {
                changes.push(this.plugin.i18n.snippetName);
            }
            if (currentSnippet.content !== codeMirrorView.state.doc.toString()) {
                changes.push(this.plugin.i18n.snippetContent);
            }
            if (currentSnippet.enabled !== snippetSwitchInput.checked) {
                changes.push(this.plugin.i18n.snippetEnabled);
            }
            if (currentSnippet.disabledInPublish !== !publishSwitchInput.checked) {
                // 注意 !publishSwitchInput.checked 是取反的
                changes.push(this.plugin.i18n.snippetDisabledInPublish);
            }

            if (changes.length > 0) {
                // 有变更，弹窗提示确认
                this.openCancelDialog(snippet, false, changes,
                    () => { cancel(); }, // 取消
                    () => { focusElement?.focus(); } // 恢复焦点
                );
                return;
            } else {
                // 没有变更
                cancel();
            }
        };
        // CSS 代码片段预览
        const previewHandler = () => {
            this.plugin.console.log("Handle CSS preview");
            if (snippet.type !== "css") {
                this.plugin.showErrorMessage(this.plugin.i18n.realTimePreviewHandlerFunctionError);
                return;
            }
            const previewSnippet: Snippet = {
                id: snippet.id,
                name: "",
                type: "css",
                enabled: snippetSwitchInput.checked,
                disabledInPublish: !publishSwitchInput.checked,
                content: codeMirrorView.state.doc.toString(),
            };

            // 只更新代码片段元素，不保存代码片段
            void this.plugin.snippetManager.updateSnippetElement(previewSnippet, undefined, true);

            // 发送广播消息，在其他窗口更新 CSS 代码片段元素
            // 豁免“广播禁原文”：预览内容未保存、接收窗口无法自拉，且为同内核可信实例上的显式预览操作，允许携带编辑中的 CSS 文本
            this.plugin.syncService?.broadcast({type: "snippet_element_update", snippet: previewSnippet, previewState: true});
        };
        // 新建或更新代码片段
        const saveHandler = async () => {
            snippet.name = nameElement.value;
            snippet.content = codeMirrorView.state.doc.toString();
            snippet.enabled = snippetSwitchInput.checked;
            snippet.disabledInPublish = !publishSwitchInput.checked;

            // 要先关闭 Dialog，因为通过 saveSnippet 调用的 updateSnippetElement 会根据 Dialog 是否打开来决定是否需要更新代码片段元素
            this.closeByElement(dialog.element);
            // 需要等待 saveSnippet 完成之后才能确认 isReloadUIRequired 的状态
            await this.plugin.snippetManager.saveSnippet(snippet);
            // 自动重新加载界面（无打开的编辑对话框时才重载，判断见 EditorManager.maybeAutoReloadUI）
            this.plugin.editorManager.maybeAutoReloadUI();
        };

        // 原生的 dialog.destroy() 方法会导致菜单直接被关闭，这里覆盖掉，改成调用 cancelHandler()
        dialog.destroyNative = dialog.destroy;
        dialog.destroy = () => {
            this.plugin.console.log("snippetEditDialog destroy");
            cancelHandler();
        };

        const isOnlyCtrl = (event: KeyboardEvent) => event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;

        // 处理标题区跳转和 Ctrl+Enter 保存
        this.plugin.addListener(dialog.element, "keydown", (event: KeyboardEvent) => {
            this.plugin.console.log("snippetEditDialog keydown", event);
            const target = event.target as HTMLElement;
            if (target === nameElement) {
                // 在标题中按键
                if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    codeMirrorView.contentDOM.focus();
                    return;
                }
            } else if (target === codeMirrorView.contentDOM) {
                // 在代码编辑器中按键
                if (isOnlyCtrl(event) && event.key === "Enter") {
                    // 按 Ctrl+Enter 键执行“保存”操作
                    event.preventDefault();
                    saveHandler();
                    return;
                }
            }

            if (event.key === "Escape") {
                // 按 Esc 键关闭 Dialog
                event.stopPropagation();
                cancelHandler();
                return;
            }
        }, {capture: true}); // 需要在捕获阶段阻止冒泡，否则按 Ctrl+Enter 会先输入一个换行

        this.plugin.addListener(dialog.element, "keydown", (event: KeyboardEvent | CustomEvent) => {
            const target = event.target as HTMLElement;
            if (target === codeMirrorView.contentDOM) {
                // 在代码编辑器中按键
                if (isOnlyCtrl((event as KeyboardEvent)) && (event as KeyboardEvent).key === "f") {
                    // 按 Ctrl+F 搜索时阻止冒泡，否则会呼出思源的搜索
                    event.stopPropagation();
                }
            }
            // 监听输入框内容变化，实时预览
            // 用了代码编辑器之后，按 Backspace、Ctrl+X 等操作都监听不到 input 事件，所以改成监听 keydown 事件
            if (snippet.type === "css" && this.plugin.config.realTimePreview) {
                const isDispatch = typeof (event as CustomEvent).detail === "string";
                // 仅在代码编辑器区域内按键或自定义事件触发时处理实时预览
                if (target === codeMirrorView.contentDOM || (isDispatch && (event as CustomEvent).detail === "realTimePreview")) {
                    setTimeout(() => {
                        previewHandler();
                    }, 0); // 等待符号键入完成
                }
            }
        }); // 不能在捕获阶段处理，否则 Ctrl+F 不会被编辑器处理、codeMirrorView.state.doc.toString() 会获取到编辑之前的内容

        this.plugin.addListener(dialog.element, "wheel", (event: Event) => {
            // 阻止冒泡，否则当菜单打开时，输入框无法使用鼠标滚轮滚动
            event.stopPropagation();
        }, {passive: true});

        this.plugin.addListener(dialog.element, "mousedown", () => {
            // 点击 Dialog 时要显示在最上层
            moveElementToTop(dialog.element);
            // 移除菜单上的 b3-menu__item--current，否则 globalKeyDownHandler() 会操作菜单
            this.plugin.menuView.clearMenuSelection();
        });

        // 添加右键菜单 https://github.com/TCOTC/snippets/issues/22
        // 思源 3.8.3+ 起，浏览器原生输入框的右键菜单内容完全由渲染进程控制，
        // IPC 载荷由一组语言字段改为 items 数组，主进程只渲染数组中列出的项。
        // https://github.com/siyuan-note/siyuan/issues/15810
        // https://github.com/siyuan-note/siyuan/issues/17526
        // https://github.com/siyuan-note/siyuan/pull/19100
        // CodeMirror 编辑器中撤销 undo 和重做 redo 无法使用，因此这里直接不发送这两项，
        // 菜单中就不会再出现它们和多余的分隔线。
        this.plugin.addListener(dialog.element, "contextmenu", (event: MouseEvent) => {
            if (!(event.target as HTMLElement).closest(".cm-content[contenteditable='true']")) return;
            event.stopPropagation();
            // 尝试使用思源的 ipcRenderer 发送右键菜单事件
            try {
                // 检查是否存在 electron 的 ipcRenderer
                const electron = (window as any).require?.("electron");
                if (electron?.ipcRenderer) {
                    this.plugin.console.log("electron:", electron);
                    this.plugin.console.log("showContextMenu: use ipcRenderer");
                    electron.ipcRenderer.send(Constants.SIYUAN_CONTEXT_MENU, {
                        x: event.clientX,
                        y: event.clientY,
                        requestedAt: Date.now(),
                        items: [
                            {role: "copy", label: window.siyuan.languages.copy},
                            {role: "cut", label: window.siyuan.languages.cut},
                            {role: "delete", label: window.siyuan.languages.delete},
                            {role: "paste", label: window.siyuan.languages.paste},
                            {role: "pasteAndMatchStyle", label: window.siyuan.languages.pasteAsPlainText},
                            {role: "selectAll", label: window.siyuan.languages.selectAll},
                        ],
                    });
                    return;
                }
            } catch (error) {
                this.plugin.console.log("Failed to use ipcRenderer:", error);
            }
        }, {capture: true});

        // 在菜单打开的情况下，移动端无法上下划动对话框中的编辑器，需要阻止事件冒泡
        this.plugin.addListener(dialog.element, "touchmove", (event: TouchEvent) => {
            event.stopPropagation();
        }, {passive: true});

        const closeElement = dialog.element.querySelector(".b3-dialog__close") as HTMLElement;
        const scrimElement = dialog.element.querySelector(".b3-dialog__scrim") as HTMLElement;
        // 代码片段编辑对话框的 .b3-dialog__scrim 元素只在桌面端被移除，移动端还是有的，所以要处理点击

        this.plugin.addListener(dialog.element, "click", async (event: MouseEvent | CustomEvent) => {
            const target = event.target as HTMLElement;
            const tagName = target.tagName.toLowerCase();
            const isDispatch = typeof event.detail === "string";
            if (tagName === "input" && target === snippetSwitchInput) {
                // 切换代码片段的开关状态
                if (this.plugin.config.realTimePreview && snippet.type === "css") {
                    previewHandler();
                }
            } else if (tagName === "button") {
                // CodeMirror 搜索面板内的按钮由编辑器自身通过 onclick 处理，不能在捕获阶段拦截，
                // 否则 stopPropagation 会阻止事件到达目标按钮，导致 onclick 不执行 https://github.com/TCOTC/snippets/issues/38
                if (target.closest(".cm-search")) {
                    return;
                }
                // 阻止冒泡，否则点击确认按钮会导致 menu 关闭
                event.stopPropagation();
                // 移除焦点，否则点击按钮后如果不关闭 Dialog 的话会一直显示 :focus 样式
                target.blur();
                switch (target.dataset.action) {
                    case "delete":
                        // 弹窗确定后删除代码片段/不新建代码片段、关闭 Dialog
                        this.openDeleteDialog(snippet.name, () => {
                            void this.plugin.snippetManager.deleteSnippet(snippet.id, snippet.type);
                            this.closeByElement(dialog.element);
                        }); // 取消后无操作
                        break;
                    case "cancel":
                        // 取消
                        void cancelHandler();
                        break;
                    case "preview":
                        // 预览 CSS 代码片段
                        if (snippet.type === "css") {
                            previewHandler();
                        }
                        break;
                    case "confirm":
                        // 新建/更新代码片段
                        void saveHandler();
                        break;
                }
            } else if (target === closeElement || target === scrimElement || (isDispatch && event.detail === "Escape")) {
                // 阻止冒泡，否则点击会导致 menu 关闭
                event.stopPropagation();
                void cancelHandler();
            }
            return;
        }, {capture: true}); // 点击 .b3-dialog__close 和 .b3-dialog__scrim 时需要在捕获阶段阻止冒泡才行，因为原生在这两个元素上有监听器

        this.plugin.addListener(dialog.element, "click", async (event: Event) => {
            // 阻止冒泡，否则点击 Dialog 时会导致 menu 关闭
            event.stopPropagation();
        });

        // 打开对话框时先执行一次预览
        if (snippet.type === "css" && this.plugin.config.realTimePreview) {
            previewHandler();
        }

        return true;

        // 还能插入 Protyle 编辑器，以后说不定能用上
        // new Protyle(this.app, dialog.element.querySelector("#protyle"), {
        //     blockId: this.getEditor().protyle.block.rootID,
        // });
    }

    /**
     * 打开代码片段删除对话框
     * @param snippetName 代码片段名称
     * @param confirm 确认回调
     */
    /**
     * 打开代码片段删除确认对话框
     * @param snippetName 代码片段名称
     * @param confirm 确认删除回调
     */
    private openDeleteDialog(snippetName: string, confirm?: () => void) {
        // TODO功能: 实现了代码片段回收站之后，增加一个“不再提示”按钮，点击之后修改配置项、弹出消息说明可以在插件设置中开关
        this.openConfirm(
            this.plugin.i18n.deleteConfirm,
            this.plugin.i18n.deleteConfirmDescription.replace("${x}", snippetName ? " <b>" + snippetName + "</b> " : ""),
            "jcsm-snippet-delete",
            undefined,
            this.plugin.i18n.delete,
            confirm
        );

        // 不需要移除菜单上的 b3-menu__item--current，方便判断点击的是哪个代码片段
        // this.unselectSnippet();
    }

    /**
     * 打开代码片段取消确认对话框
     * @param snippet 代码片段
     * @param isNew 是否是新建代码片段
     * @param changes 变更内容
     * @param confirm 确认回调
     * @param cancel 取消回调
     */
    private openCancelDialog(snippet: Snippet, isNew?: boolean, changes?: string[], confirm?: () => void, cancel?: () => void) {
        const snippetName = snippet.name.trim();
        let text: string;
        if (isNew) {
            text = this.plugin.i18n.cancelConfirmNewSnippet
                .replace("${y}", snippetName ? " <b>" + snippetName + "</b> " : "");
        } else {
            // 将每个 change 用 <b> 标签包裹
            const changesText = changes?.map(change => `<b>${change}</b>`).join(", ") ?? "";
            text = this.plugin.i18n.cancelConfirmEditSnippet
                .replace("${x}", changesText)
                .replace("${y}", snippetName ? " <b>" + snippetName + "</b> " : "");
        }

        this.openConfirm(
            this.plugin.i18n.cancelConfirm,
            text,
            "jcsm-snippet-cancel",
            this.plugin.i18n.continueEdit,
            this.plugin.i18n.giveUpEdit,
            confirm,
            cancel
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
    private openConfirm(title: string, text: string, dataKey?: string, cancelText?: string, confirmText?: string, confirm?: () => void, cancel?: () => void) {
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
    <button class="b3-button b3-button--cancel" data-type="cancel">${ cancelText ?? this.plugin.i18n.cancel }</button>
    <div class="fn__space"></div>
    <button class="b3-button ${ redButton ? "b3-button--remove" : "b3-button--text"}" data-type="confirm">${ confirmText ?? this.plugin.i18n.confirm}</button>
</div>
            `,
            width: this.plugin.isMobile ? "92vw" : "520px",
        });
        // 将 Dialog 实例挂到元素上，供 closeByElement 按元素关闭时取回（见 utils.attachDialogObject）
        attachDialogObject(dialog.element, dialog);

        dialog.element.setAttribute("data-key", dataKey ?? "dialog-confirm"); // Constants.DIALOG_CONFIRM
        dialog.element.setAttribute("data-modal", "true");  // 标记为模态对话框
        const container = dialog.element.querySelector(".b3-dialog__container") as HTMLElement;
        if (container) container.style.maxHeight = "90vh";

        const closeElement = dialog.element.querySelector(".b3-dialog__close") as HTMLElement;
        const scrimElement = dialog.element.querySelector(".b3-dialog__scrim") as HTMLElement;

        dialog.destroyNative = dialog.destroy;
        dialog.destroy = () => {
            this.plugin.console.log("confirmDialog destroy");
            cancel?.();
            this.closeByElement(dialog.element);
        };

        // 在菜单打开的情况下，移动端无法上下划动对话框中的滚动容器，需要阻止事件冒泡
        this.plugin.addListener(dialog.element, "touchmove", (event: TouchEvent) => {
            event.stopPropagation();
        }, {passive: true});

        this.plugin.addListener(dialog.element, "click", (event: KeyboardEvent) => {
            this.plugin.console.log("confirmDialog click", event);
            // 阻止冒泡，否则点击 Dialog 时会导致 menu 关闭
            event.stopPropagation();
            const isDispatch = typeof event.detail === "string";
            if (isDispatch) {
                // 键盘派发（全局键盘协调器会把任意 keydown 以 detail 派发到最顶层模态对话框）：
                // 只处理 Esc/Enter，其余按键忽略，避免 DOM 向上遍历到 null 时抛 TypeError
                if (event.detail === "Escape") {
                    cancel?.();
                    this.closeByElement(dialog.element);
                } else if (event.detail === "Enter") {
                    confirm?.();
                    this.closeByElement(dialog.element);
                }
                return;
            }

            // 鼠标路径：沿事件目标向上查找按钮
            let target = event.target as HTMLElement;
            while (target && target !== dialog.element) {
                if (target.dataset.type === "cancel") {
                    cancel?.();
                    this.closeByElement(dialog.element);
                    break;
                } else if (target.dataset.type === "confirm") {
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
     * 重载界面（菜单重载按钮/文件监听自动重载/命令注册均调用本方法）
     * 遍历所有打开的代码片段编辑对话框，存在未保存变更时弹确认框二次确认后再请求重载界面。
     */
    reloadUI() {
        // 方案1：获取界面上所有打开的代码片段编辑对话框，判断是否存在未保存的变更，如果有的话需要弹窗确认再重载界面
        // 先用方案 1 顶顶，之后看看能不能实现方案 2
        // TODO: 方案2：获取界面上所有打开的代码片段编辑对话框（包括相关内联样式），重载界面之后恢复对话框的位置、大小、内容...

        // 获取所有打开的代码片段编辑对话框
        const dialogs = document.querySelectorAll(SNIPPET_DIALOG_SELECTOR);
        // 判断是否存在未保存的变更
        let needConfirm = false;
        for (let i = 0; i < dialogs.length; i++) {
            const dialog = dialogs[i] as HTMLElement;
            const snippetId = dialog.getAttribute("data-snippet-id");
            const snippet = this.plugin.snippetsList.find((s: Snippet) => s.id === snippetId);
            // 获取代码片段的标题
            const titleElement = dialog.querySelector(".jcsm-dialog-name") as HTMLInputElement;
            const title = titleElement?.value || "";
            // 从编辑器获取代码
            const editorElement = dialog.querySelector(".cm-editor") as HTMLElement;
            const editorView = getEditorView(editorElement);
            const code = editorView?.state.doc.toString() || "";
            if (
                (snippet && (title !== snippet.name || code !== snippet.content)) // 已存在的代码片段，判断标题或内容是否有变更
                || (!snippet && (title !== "" || code !== ""))                    // 新建代码片段，判断是否有内容
            ) {
                // 只要有一个未保存变更就停止循环
                needConfirm = true;
                break;
            }
        }

        if (needConfirm) {
            this.openConfirm(this.plugin.i18n.reloadUIConfirm, this.plugin.i18n.reloadUIConfirmDescription, "jcsm-reload-ui-confirm", undefined, undefined, () => {
                this.plugin.postReloadUI();
            });
        } else {
            this.plugin.postReloadUI();
        }
    }

    // dialog.destroy 还能传递参数，看看这个写法能不能用上
    // dialog.destroy({cancel: "true"});

    /**
     * 通过元素关闭对话框
     * @param dialogElement 对话框元素
     */
    closeByElement(dialogElement: HTMLElement) {
        if (!dialogElement) {
            this.plugin.console.error("closeDialogByElement: dialogElement is undefined, return");
            return;
        }
        this.plugin.console.log("closeDialogByElement: dialogElement:", dialogElement);

        // 如果是代码片段编辑对话框
        if (dialogElement.dataset.key === SNIPPET_DIALOG_DATA_KEY) {
            // 销毁 CodeMirror 编辑器（实例经 createCodeMirrorEditor 挂载，见 utils.getEditorView）
            const editorView = getEditorView(dialogElement.querySelector(".jcsm-dialog-content .cm-editor"));
            if (editorView) {
                this.plugin.console.log("closeDialogByElement: destroying CodeMirror editor");
                editorView.destroy();
            }
            // 移除菜单项编辑按钮的背景色
            this.plugin.menuView.removeSnippetEditButtonActive(dialogElement.dataset.snippetId!);
        }

        // 移除事件监听器
        this.plugin.removeListener(dialogElement);

        const destroyEventHandler = () => {
            // Dialog 移除之后再移除全局键盘事件监听，因为需要判断窗口中是否还存在菜单和 Dialog
            this.plugin.menuView.destroyGlobalKeyDownHandler();
            // 检查并停止主题模式监听（在最后一个编辑器对话框关闭时）
            this.plugin.editorManager.checkAndManageThemeWatch();
        };

        let isDestroyed = false;
        const dialogObject = getDialogObject(dialogElement);
        if (!dialogObject) {
            // 所有 Dialog 均经 attachDialogObject 挂载，此处仅防御性返回，避免后续空引用
            this.plugin.console.error("closeDialogByElement: dialogObject not found");
            return;
        }
        const destroyCallback = dialogObject.destroyCallback || undefined;
        dialogObject.destroyCallback = () => {
            isDestroyed = true;
            // 调用原有的 destroyCallback
            destroyCallback?.();
            destroyEventHandler();
        };
        // 修改 zIndex 以避免 menu 被移除 https://github.com/siyuan-note/siyuan/blob/ffad6048fdd677c78b6649d94315d3702391beb2/app/src/dialog/index.ts#L91-L95
        (dialogElement.querySelector(".b3-dialog") as HTMLElement).style.zIndex = ((parseInt(window.siyuan.menus.menu.element.style.zIndex) || 0) + 1).toString();
        dialogObject.destroyNative();

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
     * 关闭全部插件模态对话框（禁用插件时使用）
     * 含代码片段编辑/设置/确认等所有 data-key 以 jcsm- 开头的已打开对话框。
     */
    closeAllDialogs() {
        document.querySelectorAll(".b3-dialog--open[data-key^='jcsm-']").forEach((dialogElement: HTMLElement) => {
            this.closeByElement(dialogElement);
        });
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
