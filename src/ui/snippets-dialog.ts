// 代码片段对话框（原 index.ts「对话框相关」分节外迁，行为等价）
// 职责：代码片段编辑对话框的装配与交互（生成 HTML/打开/取消/预览/保存/事件绑定）、删除确认/放弃编辑确认/
// 通用确认对话框、按元素关闭对话框（含 CodeMirror 编辑器销毁、监听器移除与 destroyCallback/超时兜底）、
// 收集已打开的插件模态对话框。
// 运行态依赖（日志/文案/移动端判断/监听簿记/菜单编辑按钮高亮/全局按键清理/主题监听联动）经
// SnippetsDialogHost 注入；CRUD/元素注入/广播经 host 动作转发（对话框只驱动，不直接读写数据）。
import {Constants, Dialog} from "siyuan";
import {moveElementToTop} from "../utils";
import {createCodeMirrorEditor} from "./codemirror";
import type {Snippet, SnippetType} from "../types";

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
    /** 动作：检查并管理主题模式监听（编辑器对话框打开时启动、最后一个关闭时停止） */
    checkThemeWatch: (isOpen?: boolean) => void;
    // ===== 以下为代码片段编辑对话框（genEditDialogHtml/openEditDialog）所需的运行态 =====

    /** 读取：是否显示发布服务开关 */
    isShowPublishCheckbox: () => boolean;
    /** 读取：是否启用 CSS 实时预览（配置镜像） */
    realTimePreview: () => boolean;
    /** 读取：编辑器缩进单位（配置镜像） */
    editorIndentUnit: () => string;
    /** 读取：是否允许同时打开多个代码片段编辑器（配置镜像） */
    multipleSnippetEditors: () => boolean;
    /** 读取：修改 JS 后是否自动重新加载界面（配置镜像） */
    autoReloadUIAfterModifyJS: () => boolean;
    /** 读取：是否已标记需要重新加载界面 */
    isReloadUIRequired: () => boolean;
    /** 读取：当前代码片段列表（跨 reload 存活的内存态） */
    snippetsList: () => Snippet[];
    /** 动作：高亮代码片段菜单项编辑按钮（打开编辑对话框时） */
    setSnippetEditButtonActive: (snippetId: string) => void;
    /** 动作：弹出错误消息 */
    showErrorMessage: (message: string) => void;
    /** 动作：按 ID 自拉代码片段（副作用刷新列表为权威态），失败返回 false */
    getSnippetById: (id: string) => Promise<Snippet | false | undefined>;
    /** 动作：保存代码片段（对话框保存路径：落库 + 更新元素/UI + 广播） */
    saveSnippet: (snippet: Snippet) => Promise<void>;
    /** 动作：删除代码片段（本地路径：自拉校验 → Store 删除 → 落库 → 移除元素/UI → 广播） */
    deleteSnippet: (id: string, snippetType: SnippetType) => Promise<void>;
    /** 动作：更新注入元素（含预览态；对话框关闭后调用，避免对话框存在时的预览保护误判） */
    updateSnippetElement: (snippet: Snippet | false | undefined, enabled?: boolean, previewState?: boolean) => Promise<void>;
    /** 动作：移除注入元素（预览中的片段由内部按对话框是否存在跳过） */
    removeSnippetElement: (snippetId: string, snippetType: SnippetType) => Promise<void>;
    /** 动作：发送重新加载界面请求 */
    postReloadUI: () => void;
    /** 动作：清除菜单选中（点击 Dialog 时避免全局按键误操作菜单） */
    clearMenuSelection: () => void;
    /** 动作：广播移除注入元素（退出预览的新建 CSS 片段，只发元数据） */
    broadcastElementRemove: (snippetId: string, snippetType: SnippetType) => void;
    /** 动作：广播更新注入元素——previewState 为 true（CSS 编辑中预览）放行原文，为 false（退出预览）只发 ID 由接收方自拉 */
    broadcastElementUpdate: (snippetId: string | undefined, previewState: boolean, snippet?: Snippet) => void;
}

/**
 * 代码片段对话框管理器（原 index.ts「对话框相关」分节外迁，行为等价）
 * 公开 genEditDialogHtml/openEditDialog/openDeleteDialog/openCancelDialog/openConfirm/closeByElement/getAllModalElements
 */
export class SnippetsDialog {
    private readonly host: SnippetsDialogHost;

    constructor(host: SnippetsDialogHost) {
        this.host = host;
    }

    /**
     * 生成代码片段编辑对话框
     * @param snippet 代码片段
     * @param confirmText 确认按钮的文案
     * @returns 代码片段编辑对话框 HTML 字符串
     */
    genEditDialogHtml(snippet: Snippet, confirmText: string = this.host.i18n().save): string {
        const showPublishCheckbox = this.host.isShowPublishCheckbox();
        // TODO功能: 在删除按钮左边加一个创建副本按钮（始终显示），点击之后创建副本（不直接保存，是新建的代码片段，需要手动点击保存按钮）并且打开编辑对话框
        return `
<div class="jcsm-dialog">
    <div class="jcsm-dialog-header resize__move"></div>
    <div class="jcsm-dialog-container">
        <div class="fn__flex">
            <input class="jcsm-dialog-name fn__flex-1 b3-text-field" spellcheck="false" placeholder="${this.host.i18n().title}">
            <div class="fn__space"></div>
            <button data-action="delete" class="block__icon block__icon--show ariaLabel fn__none" aria-label="${this.host.i18n().deleteSnippet}" data-position="north">
                <svg><use xlink:href="#iconTrashcan"></use></svg>
            </button>
            <div class="fn__space"></div>
            <input data-type="publishSwitch" class="b3-switch fn__flex-center ariaLabel${ showPublishCheckbox ? "" : " fn__none"}" aria-label="${this.host.i18n().snippetDisabledInPublish}" data-position="north" type="checkbox"${snippet.disabledInPublish ? "" : " checked"}>
            <div class="fn__space"></div>
            <input data-type="snippetSwitch" class="b3-switch fn__flex-center" type="checkbox"${snippet.enabled ? " checked" : ""}>
        </div>
        <div class="fn__hr"></div>
        <div class="jcsm-dialog-content"></div>
        <div class="fn__hr--b"></div>
    </div>
    <div class="b3-dialog__action">
        <button data-action="cancel" class="b3-button b3-button--cancel">${this.host.i18n().cancel}</button>
        <div class="fn__space"></div>
        <button data-action="preview" class="b3-button b3-button--text${snippet.type === "js" || this.host.realTimePreview() ? " fn__none" : ""}">${this.host.i18n().preview}</button>
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
            paramError.push(this.host.i18n().snippet);
        } else {
            if (!snippet.id) {
                paramError.push(this.host.i18n().snippetId);
            }
            if (!snippet.type) {
                paramError.push(this.host.i18n().snippetType);
            }
        }
        if (paramError.length > 0) {
            this.host.showErrorMessage(this.host.i18n().snippetDialogParamError + "[" + paramError.join(", ") + "]");
            return false;
        }

        // 给对应的菜单项的编辑按钮添加背景色
        this.host.setSnippetEditButtonActive(snippet.id);

        // 如果已经有打开的对应 snippetId 的 Dialog，则仅激活它，不重复创建
        const existedDialog = document.querySelector(`.b3-dialog--open[data-key="jcsm-snippet-dialog"][data-snippet-id="${snippet.id}"]`) as HTMLDivElement;
        if (existedDialog) {
            moveElementToTop(existedDialog);
            return true;
        }

        // 创建 Dialog
        const dialog = new Dialog({
            content: this.genEditDialogHtml(snippet, isNew ? this.host.i18n().new : undefined),
            width: this.host.isMobile() ? "92vw" : "70vw",
            height: "80vh",
            hideCloseIcon: this.host.isMobile(),
        });
        (dialog.element as any).dialogObject = dialog;

        // 设置 Dialog 属性
        dialog.element.setAttribute("data-key", "jcsm-snippet-dialog");
        dialog.element.setAttribute("data-snippet-id", snippet.id);
        dialog.element.setAttribute("data-snippet-type", snippet.type);

        if (!isNew) {
            // 非新建代码片段时，显示删除按钮
            const deleteButton = dialog.element.querySelector("button[data-action='delete']") as HTMLButtonElement;
            deleteButton?.classList.remove("fn__none");
        }

        if (!this.host.isMobile() && this.host.multipleSnippetEditors()) {
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
        this.host.checkThemeWatch(true);

        // 设置代码片段标题和内容
        const nameElement = dialog.element.querySelector(".jcsm-dialog-name") as HTMLInputElement; // 标题不允许输入换行，所以得用 input 元素，textarea 元素没法在操作能 Ctrl+Z 撤回的前提下阻止用户换行
        nameElement.value = snippet.name;
        nameElement.focus();

        // 创建 CodeMirror 编辑器
        const contentContainer = dialog.element.querySelector(".jcsm-dialog-content") as HTMLElement;
        const codeMirrorView = createCodeMirrorEditor(contentContainer, snippet.content, snippet.type, this.host.editorIndentUnit(), this.host.i18n());
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
                        void this.host.removeSnippetElement(snippet.id, snippet.type);
                        // 发送广播消息，在其他窗口移除代码片段元素
                        this.host.broadcastElementRemove(snippet.id, snippet.type);
                    } else {
                        let realSnippet: Snippet | undefined | false = this.host.snippetsList().find((s: Snippet) => s.id === snippet.id);
                        if (!realSnippet) {
                            realSnippet = await this.host.getSnippetById(snippet.id);
                        }
                        if (!realSnippet) return;
                        this.host.updateSnippetElement(realSnippet, undefined, false);
                        // 发送广播消息，在其他窗口更新代码片段元素
                        // 退出预览用的是已保存片段（可自拉），不携带原文，只发 snippetId + previewState: false
                        this.host.broadcastElementUpdate(snippet.id, false);
                    }
                }
            };

            // 获取 Dialog 的焦点元素
            const focusElement = dialog.element.querySelector(":focus") as HTMLElement || dialog.element.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
            // 点击开关之后要移除焦点，不然弹出确认弹窗之后按 Esc 还是会触发 Dialog 上的 keydown 事件
            focusElement?.blur();

            const currentSnippet = await this.host.getSnippetById(snippet.id);
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
                changes.push(this.host.i18n().snippetName);
            }
            if (currentSnippet.content !== codeMirrorView.state.doc.toString()) {
                changes.push(this.host.i18n().snippetContent);
            }
            if (currentSnippet.enabled !== snippetSwitchInput.checked) {
                changes.push(this.host.i18n().snippetEnabled);
            }
            if (currentSnippet.disabledInPublish !== !publishSwitchInput.checked) {
                // 注意 !publishSwitchInput.checked 是取反的
                changes.push(this.host.i18n().snippetDisabledInPublish);
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
            this.host.logger.log("Handle CSS preview");
            if (snippet.type !== "css") {
                this.host.showErrorMessage(this.host.i18n().realTimePreviewHandlerFunctionError);
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
            void this.host.updateSnippetElement(previewSnippet, undefined, true);

            // 发送广播消息，在其他窗口更新 CSS 代码片段元素
            // 豁免“广播禁原文”：预览内容未保存、接收窗口无法自拉，且为同内核可信实例上的显式预览操作，允许携带编辑中的 CSS 文本
            this.host.broadcastElementUpdate(undefined, true, previewSnippet);
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
            await this.host.saveSnippet(snippet);
            // 自动重新加载界面
            if (this.host.autoReloadUIAfterModifyJS() && this.host.isReloadUIRequired() && !document.querySelector(".b3-dialog--open[data-key='jcsm-snippet-dialog']")) {
                this.host.postReloadUI();
            }
        };

        // 原生的 dialog.destroy() 方法会导致菜单直接被关闭，这里覆盖掉，改成调用 cancelHandler()
        dialog.destroyNative = dialog.destroy;
        dialog.destroy = () => {
            this.host.logger.log("snippetEditDialog destroy");
            cancelHandler();
        };

        const isOnlyCtrl = (event: KeyboardEvent) => event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;

        // 处理标题区跳转和 Ctrl+Enter 保存
        this.host.addListener(dialog.element, "keydown", (event: KeyboardEvent) => {
            this.host.logger.log("snippetEditDialog keydown", event);
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

        this.host.addListener(dialog.element, "keydown", (event: KeyboardEvent | CustomEvent) => {
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
            if (snippet.type === "css" && this.host.realTimePreview()) {
                const isDispatch = typeof (event as CustomEvent).detail === "string";
                // 仅在代码编辑器区域内按键或自定义事件触发时处理实时预览
                if (target === codeMirrorView.contentDOM || (isDispatch && (event as CustomEvent).detail === "realTimePreview")) {
                    setTimeout(() => {
                        previewHandler();
                    }, 0); // 等待符号键入完成
                }
            }
        }); // 不能在捕获阶段处理，否则 Ctrl+F 不会被编辑器处理、codeMirrorView.state.doc.toString() 会获取到编辑之前的内容

        this.host.addListener(dialog.element, "wheel", (event: Event) => {
            // 阻止冒泡，否则当菜单打开时，输入框无法使用鼠标滚轮滚动
            event.stopPropagation();
        }, {passive: true});

        this.host.addListener(dialog.element, "mousedown", () => {
            // 点击 Dialog 时要显示在最上层
            moveElementToTop(dialog.element);
            // 移除菜单上的 b3-menu__item--current，否则 globalKeyDownHandler() 会操作菜单
            this.host.clearMenuSelection();
        });

        // 添加右键菜单 https://github.com/TCOTC/snippets/issues/22
        // 思源 3.8.3+ 起，浏览器原生输入框的右键菜单内容完全由渲染进程控制，
        // IPC 载荷由一组语言字段改为 items 数组，主进程只渲染数组中列出的项。
        // https://github.com/siyuan-note/siyuan/issues/15810
        // https://github.com/siyuan-note/siyuan/issues/17526
        // https://github.com/siyuan-note/siyuan/pull/19100
        // CodeMirror 编辑器中撤销 undo 和重做 redo 无法使用，因此这里直接不发送这两项，
        // 菜单中就不会再出现它们和多余的分隔线。
        this.host.addListener(dialog.element, "contextmenu", (event: MouseEvent) => {
            if (!(event.target as HTMLElement).closest(".cm-content[contenteditable='true']")) return;
            event.stopPropagation();
            // 尝试使用思源的 ipcRenderer 发送右键菜单事件
            try {
                // 检查是否存在 electron 的 ipcRenderer
                const electron = (window as any).require?.("electron");
                if (electron?.ipcRenderer) {
                    this.host.logger.log("electron:", electron);
                    this.host.logger.log("showContextMenu: use ipcRenderer");
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
                this.host.logger.log("Failed to use ipcRenderer:", error);
            }
        }, {capture: true});

        // 在菜单打开的情况下，移动端无法上下划动对话框中的编辑器，需要阻止事件冒泡
        this.host.addListener(dialog.element, "touchmove", (event: TouchEvent) => {
            event.stopPropagation();
        }, {passive: true});

        const closeElement = dialog.element.querySelector(".b3-dialog__close") as HTMLElement;
        const scrimElement = dialog.element.querySelector(".b3-dialog__scrim") as HTMLElement;
        // 代码片段编辑对话框的 .b3-dialog__scrim 元素只在桌面端被移除，移动端还是有的，所以要处理点击

        this.host.addListener(dialog.element, "click", async (event: MouseEvent | CustomEvent) => {
            const target = event.target as HTMLElement;
            const tagName = target.tagName.toLowerCase();
            const isDispatch = typeof event.detail === "string";
            if (tagName === "input" && target === snippetSwitchInput) {
                // 切换代码片段的开关状态
                if (this.host.realTimePreview() && snippet.type === "css") {
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
                            void this.host.deleteSnippet(snippet.id, snippet.type);
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

        this.host.addListener(dialog.element, "click", async (event: Event) => {
            // 阻止冒泡，否则点击 Dialog 时会导致 menu 关闭
            event.stopPropagation();
        });

        // 打开对话框时先执行一次预览
        if (snippet.type === "css" && this.host.realTimePreview()) {
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

    // dialog.destroy 还能传递参数，看看这个写法能不能用上
    // dialog.destroy({cancel: "true"});

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
