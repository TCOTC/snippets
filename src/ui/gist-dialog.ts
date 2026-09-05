// Gist 导入/发布对话框
// 职责：从设置面板打开「从 Gist 导入」对话框（拉取预览 → 勾选片段 → merge/overwrite/fork 导入），
// 以及后续里程碑的「发布到 Gist」对话框。对话框以 data-key 前缀 jcsm- 接入统一模态协调
// （SnippetsDialog.closeByElement/getAllModalElements/closeAllDialogs 与菜单全局键盘）。
import {Dialog, showMessage} from "siyuan";
import {
    attachDialogObject,
    setDialogKeyHandler,
} from "../utils";
import {getGist, parseGistUrl} from "../services/gist";
import type {GistApiError} from "../services/gist";
import type {GistImportData, GistSyncService} from "../services/gist-sync";
import {buildPublishFiles, planUpdateFiles, validatePublishSnippets} from "../services/gist-sync";
import type {ImportMode} from "../domain/import-plan";
import {DIFF_SKIPPED, diffLines, diffWithContext} from "../domain/gist-diff";
import {snippetTitle} from "../domain/snippet";
import type {Snippet, SnippetType} from "../types";
import type PluginSnippets from "../index";

/** 导入对话框 data-key（纳入模态协调） */
const GIST_IMPORT_DIALOG_KEY = "jcsm-gist-import";

/**
 * 文件名能否从扩展名解析出片段类型（.css/.js/.mjs/.cjs）
 * 能解析时类型不可改（显示静态文本）；解析不出时才提供类型下拉供选择
 */
const hasResolvableType = (fileName: string): boolean => /\.(css|js|mjs|cjs)$/i.test(fileName);


/** 结果预览中的一行（勾选状态与映射结果一一对应） */
interface PreviewRow {
    /** 唯一行键（普通文件用文件名；conf 用片段索引） */
    key: string;
    /** 片段名称 */
    name: string;
    /** 片段 ID（可能缺省） */
    id?: string;
    /** 片段类型（可由类型下拉修改） */
    type: SnippetType;
    /** 片段内容（拉取原文或 conf 原值） */
    content: string;
    /** 是否启用（conf 原值保留；普通文件新增默认 false） */
    enabled: boolean;
    /** raw 兜底失败信息（普通文件截断超限时） */
    fetchError?: string;
}

/**
 * Gist 对话框管理器
 */
export class GistDialog {
    private readonly plugin: PluginSnippets;

    /** 最近一次拉取的导入数据（用于模式切换/导入时组装勾选集） */
    private importData: GistImportData | undefined;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /** 发布对话框勾选的片段 ID 集合 */
    private publishCheckedIds = new Set<string>();
    /** 发布对话框当前筛选（all/css/js/enabled） */
    private publishFilter: "all" | "css" | "js" | "enabled" = "all";
    /** 上次发布的 Gist 完整链接（来自发布状态 gistUrl；无历史时为空） */
    private lastPublishGistUrl = "";
    /** 上次导入的 Gist 完整链接（来自导入状态 gistUrl；无历史时为空） */
    private lastImportGistUrl = "";

    /**
     * 把含 `${phraseKey}` 占位的句子渲染为最终文案：占位词用完整链接的短语替换。
     * 有 url 时该短语显示为可点击链接（浏览器打开），否则纯文本。渲染时 url 已同步已知（状态已加载）。
     * @param sentence 含 `${phraseKey}` 占位的句子
     * @param phraseKey 短语 i18n 键（如 gistLastGist；占位名即该键）
     * @param url 对应 gist 链接（可空 → 纯文本）
     */
    private phraseSentence(sentence: string, phraseKey: string, url: string): string {
        const phrase = this.escape(this.plugin.i18n[phraseKey]);
        const rendered = url
            ? `<a class="jcsm-gist-open-link" href="${this.escape(url)}" target="_blank" rel="noopener noreferrer" title="${this.escape(url)}">${phrase}</a>`
            : phrase;
        return sentence.replace(`\${${phraseKey}}`, rendered);
    }

    /**
     * 打开「发布到 Gist」对话框
     * @param settingDialogElement 来源设置对话框元素（关闭它以避免模态叠加）
     */
    async openPublish(settingDialogElement?: HTMLElement) {
        if (!this.plugin.gistTokenService.hasToken) {
            this.plugin.showErrorMessage(this.plugin.i18n.gistPublishTokenRequired);
            return;
        }
        // 来源设置对话框自身（data-key 以 jcsm- 开头、data-modal=true）会被计入模态守卫，
        // 需先将其排除（随后下方关闭它），否则按钮点击会被守卫直接吞掉
        if (this.blockedByOtherModals(settingDialogElement)) {
            return;
        }
        if (settingDialogElement) {
            this.plugin.snippetsDialog.closeByElement(settingDialogElement);
        }
        // 关闭插件菜单：菜单容器会拦截弹窗内的滚轮/触摸滚动
        // （与设置对话框跳转原生设置前 menuView.close() 同理）
        this.plugin.menuView.close();
        // 刷新列表失败时给出提示并中止，避免静默打开空弹窗误导（getSnippetsList 失败已自行弹错）
        if (!(await this.plugin.snippetManager.refreshSnippetsList())) {
            return;
        }

        // 默认勾选已启用片段；筛选重置为全部
        this.publishCheckedIds = new Set(this.plugin.snippetsList.filter(snippet => snippet.enabled).map(snippet => snippet.id));
        this.publishFilter = "all";

        // 读取上次发布目标（有历史时默认更新上次发布的 Gist，无历史时默认新建 secret）
        const publishState = await this.plugin.gistSyncService.loadPublishState();
        this.lastPublishGistUrl = publishState?.gistUrl ?? "";
        // 「更新上次发布的 Gist」句中的短语按是否有链接渲染为链接或纯文本
        const publishUpdateLastLabel = this.phraseSentence(
            this.plugin.i18n.gistPublishTargetUpdateLast,
            "gistLastGist",
            this.lastPublishGistUrl
        );

        const dialog = new Dialog({
            title: this.plugin.i18n.gistPublish,
            content: `
<div class="b3-dialog__content">
    <div data-action="gistPublishTarget">
        <label class="fn__flex b3-label jcsm-gist-option"><input type="radio" name="jcsm-gist-target" value="new-secret"${publishState ? "" : " checked"}>${this.plugin.i18n.gistPublishTargetNewSecret}</label>
        <label class="fn__flex b3-label jcsm-gist-option"><input type="radio" name="jcsm-gist-target" value="new-public">${this.plugin.i18n.gistPublishTargetNewPublic}</label>
        ${publishState ? `<label class="fn__flex b3-label jcsm-gist-option"><input type="radio" name="jcsm-gist-target" value="update-last" checked>${publishUpdateLastLabel}</label>` : ""}
        <label class="fn__flex b3-label jcsm-gist-option"><input type="radio" name="jcsm-gist-target" value="update">${this.plugin.i18n.gistPublishTargetUpdate}</label>
        <div class="fn__flex fn__flex-center fn__none" data-action="gistPublishGistIdRow">
            <input class="b3-text-field fn__flex-1" data-action="gistPublishGistId" type="text" spellcheck="false" placeholder="${this.plugin.i18n.gistPublishGistIdPlaceholder}">
        </div>
    </div>
    <div class="fn__hr"></div>
    <div class="fn__flex fn__flex-center fn__flex-wrap">
        <select class="b3-select" data-action="gistPublishFilter">
            <option value="all">${this.plugin.i18n.gistPublishFilterAll}</option>
            <option value="css">CSS</option>
            <option value="js">JS</option>
            <option value="enabled">${this.plugin.i18n.gistPublishFilterEnabled}</option>
        </select>
        <div class="fn__space"></div>
        <span class="b3-button b3-button--outline fn__flex-center" data-action="gistPublishToggleAll"></span>
        <div class="fn__space"></div>
        <span class="b3-label__text fn__flex-1" data-action="gistPublishCount"></span>
    </div>
    <div class="jcsm-gist-publish-list"></div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${this.plugin.i18n.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-action="gistPublish">${this.plugin.i18n.gistPublishButton}</button>
</div>
            `,
            width: this.plugin.isMobile ? "92vw" : "720px",
            height: "80vh",
        });
        attachDialogObject(dialog.element, dialog);
        dialog.element.setAttribute("data-key", "jcsm-gist-publish");
        dialog.element.setAttribute("data-modal", "true");
        // 与其它插件对话框一致：备份原生 destroy 到 destroyNative，再把 destroy 覆盖为经
        // closeByElement 统一清理（原生的遮罩/右上角关闭会调 this.destroy，closeByElement 内会调用 destroyNative）
        dialog.destroyNative = dialog.destroy;
        dialog.destroy = () => {
            this.plugin.console.log("gist publish dialog destroy");
            this.plugin.snippetsDialog.closeByElement(dialog.element);
        };

        // gist 输入框仅在选择「更新指定 Gist」时显示（「更新上次发布的 Gist」使用记忆的 gist 链接）
        const gistIdRow = dialog.element.querySelector("[data-action='gistPublishGistIdRow']") as HTMLElement;
        const gistIdInput = dialog.element.querySelector("input[data-action='gistPublishGistId']") as HTMLInputElement;
        // 输入框预填上次发布 gist 链接，便于在「更新指定 Gist」下直接沿用或修改
        if (publishState) {
            gistIdInput.value = publishState.gistUrl;
        }
        const syncGistIdRow = () => {
            gistIdRow.classList.toggle("fn__none", this.publishTarget(dialog.element) !== "update");
        };
        syncGistIdRow();

        // 键盘：Esc 关闭
        setDialogKeyHandler(dialog.element, (key) => {
            if (key === "Escape") {
                this.plugin.snippetsDialog.closeByElement(dialog.element);
            }
        });

        // 渲染片段勾选清单与计数
        const listContainer = dialog.element.querySelector(".jcsm-gist-publish-list") as HTMLElement;
        // 下拉筛选初始同步当前筛选值
        (dialog.element.querySelector("select[data-action='gistPublishFilter']") as HTMLSelectElement).value = this.publishFilter;
        const renderList = () => this.renderPublishList(listContainer, dialog.element);
        renderList();

        // 点击分发（全选切换/发布）
        const clickHandler = (event: MouseEvent) => {
            event.stopPropagation();
            const target = event.target as HTMLElement;
            const tagName = target.tagName.toLowerCase();
            const isScrim = target.classList.contains("b3-dialog__scrim");
            // 取消按钮与遮罩：关闭对话框；其余按钮（发布等）落入下方 action 判断
            if (isScrim || (tagName === "button" && target.dataset.type === "cancel" && !target.dataset.action)) {
                this.plugin.snippetsDialog.closeByElement(dialog.element);
                return;
            }
            const action = target.closest("[data-action]")?.getAttribute("data-action");
            if (action === "gistPublishToggleAll") {
                this.toggleSelectAllPublish();
                renderList();
            } else if (action === "gistPublish") {
                void this.handlePublish(dialog.element);
            } else if (action === "gistPublishPreview") {
                // 点击片段名：弹窗预览该片段内容
                event.preventDefault();
                event.stopPropagation();
                const snippetId = (target.closest("[data-pub-id]") as HTMLElement)?.dataset.pubId ?? "";
                const snippet = this.plugin.snippetsList.find(item => item.id === snippetId);
                if (snippet) {
                    this.openSnippetPreview(snippet);
                }
            }
        };
        this.plugin.addListener(dialog.element, "click", clickHandler, {capture: true});

        // change 分发（切换筛选/切换目标/勾选片段/输入 gist id 实时刷新摘要）
        const changeHandler = (event: Event) => {
            event.stopPropagation();
            const target = event.target as HTMLElement;
            if (target.tagName === "SELECT") {
                // 下拉筛选切换
                const select = target as HTMLSelectElement;
                const filter = select.value as typeof this.publishFilter;
                if (filter === "all" || filter === "css" || filter === "js" || filter === "enabled") {
                    this.publishFilter = filter;
                    renderList();
                }
                return;
            }
            if (target.tagName === "INPUT") {
                const input = target as HTMLInputElement;
                if (input.type === "radio") {
                    // 切换发布目标：新建 secret/公开 / 更新上次 / 更新指定
                    // 「更新指定 Gist」时显示 gist id 输入行，其余隐藏
                    syncGistIdRow();
                } else if (input.type === "checkbox") {
                    this.syncPublishChecked(input);
                }
            }
            this.renderPublishSummary(dialog.element);
        };
        this.plugin.addListener(dialog.element, "change", changeHandler);
        this.plugin.console.log("gist publish dialog opened");
    }

    /** 当前发布目标选择（new-secret/new-public/update-last/update） */
    private publishTarget(dialogElement: HTMLElement): "new-secret" | "new-public" | "update-last" | "update" {
        const checked = dialogElement.querySelector("input[name='jcsm-gist-target']:checked") as HTMLInputElement | null;
        return (checked?.value as "new-secret" | "new-public" | "update-last" | "update") ?? "new-secret";
    }

    /** checkbox 变更同步勾选集合 */
    private syncPublishChecked(input: HTMLInputElement) {
        const snippetId = input.dataset.pubId ?? "";
        if (input.checked) {
            this.publishCheckedIds.add(snippetId);
        } else {
            this.publishCheckedIds.delete(snippetId);
        }
    }

    /** 当前筛选下可见片段是否已全部勾选 */
    private isCurrentFilterAllChecked(): boolean {
        const visible = this.filterSnippets(this.plugin.snippetsList);
        return visible.length > 0 && visible.every(snippet => this.publishCheckedIds.has(snippet.id));
    }

    /**
     * 全选 / 取消全选（作用于当前筛选结果）：
     * 当前可见片段已全部勾选时取消全选，否则全选可见片段
     */
    private toggleSelectAllPublish() {
        const visible = this.filterSnippets(this.plugin.snippetsList);
        if (visible.length === 0) {
            return;
        }
        const allChecked = this.isCurrentFilterAllChecked();
        for (const snippet of visible) {
            if (allChecked) {
                this.publishCheckedIds.delete(snippet.id);
            } else {
                this.publishCheckedIds.add(snippet.id);
            }
        }
    }

    /** 按当前筛选渲染片段勾选清单（发布）：单行名称，点击名称预览内容 */
    private renderPublishList(listContainer: HTMLElement, dialogElement: HTMLElement) {
        const snippets = this.filterSnippets(this.plugin.snippetsList);
        if (this.plugin.snippetsList.length === 0) {
            // 无任何代码片段：显示空态引导并归零计数/清空摘要
            listContainer.textContent = this.plugin.i18n.emptySnippet;
            this.renderPublishSummary(dialogElement);
            return;
        }
        if (snippets.length === 0) {
            // 有片段但当前筛选无命中：提示筛选结果为空
            listContainer.textContent = this.plugin.i18n.gistPublishFilterEmpty;
            this.renderPublishSummary(dialogElement);
            return;
        }
        listContainer.innerHTML = snippets.map(snippet => {
            const title = snippet.enabled
                ? snippetTitle(snippet)
                : `${snippetTitle(snippet)} · ${this.plugin.i18n.gistPublishDisabled}`;
            return `
<label class="jcsm-gist-row">
    <input type="checkbox" data-pub-id="${snippet.id}"${this.publishCheckedIds.has(snippet.id) ? " checked" : ""}>
    <span class="jcsm-gist-name fn__flex-1" data-action="gistPublishPreview" data-pub-id="${snippet.id}" title="${this.escape(title)}">${this.escape(snippetTitle(snippet))}</span>
</label>`;
        }).join("");
        this.renderPublishSummary(dialogElement);
    }

    /** 按当前筛选过滤片段 */
    private filterSnippets(snippets: Snippet[]): Snippet[] {
        switch (this.publishFilter) {
            case "css":
                return snippets.filter(snippet => snippet.type === "css");
            case "js":
                return snippets.filter(snippet => snippet.type === "js");
            case "enabled":
                return snippets.filter(snippet => snippet.enabled);
            default:
                return snippets;
        }
    }

    /** 更新勾选计数与全选按钮文案 */
    private renderPublishSummary(dialogElement: HTMLElement) {
        const countElement = dialogElement.querySelector("[data-action='gistPublishCount']") as HTMLElement;
        const toggleAllButton = dialogElement.querySelector("[data-action='gistPublishToggleAll']") as HTMLElement;
        const selected = this.selectedPublishSnippets();
        countElement.textContent = this.plugin.i18n.gistPublishSelectedCount.replace("${count}", String(selected.length));
        // 全选按钮文案随当前筛选勾选状态切换：全部已勾选时显示「取消全选」，否则显示「全选」
        if (toggleAllButton) {
            toggleAllButton.textContent = this.isCurrentFilterAllChecked()
                ? this.plugin.i18n.gistPublishSelectNone
                : this.plugin.i18n.gistPublishSelectAll;
        }
    }

    /** 当前勾选的片段（按当前列表顺序） */
    private selectedPublishSnippets(): Snippet[] {
        return this.plugin.snippetsList.filter(snippet => this.publishCheckedIds.has(snippet.id));
    }

    /**
     * 执行发布：校验 → （新建公开 / 更新有删除时的二次确认）→ publishToGist
     */
    private async handlePublish(dialogElement: HTMLElement) {
        const selected = this.selectedPublishSnippets();
        if (selected.length === 0) {
            this.plugin.showErrorMessage(this.plugin.i18n.gistPublishNoCheck);
            return;
        }
        const validationError = validatePublishSnippets(selected);
        if (validationError === "too-large") {
            this.plugin.showErrorMessage(this.plugin.i18n.gistPublishTooLarge);
            return;
        }
        if (validationError === "too-many") {
            this.plugin.showErrorMessage(this.plugin.i18n.gistPublishTooMany);
            return;
        }

        const target = this.publishTarget(dialogElement);

        let confirmText = "";
        const confirmTitle = this.plugin.i18n.gistPublishConfirm;
        let publishTarget: {kind: "create"; publicGist: boolean} | {kind: "update"; gistId: string};
        if (target === "update" || target === "update-last") {
            // 更新既有 gist：「更新上次发布的 Gist」用记忆的 gist 链接解析出的 id；「更新指定 Gist」读输入框（也是链接）
            const inputId = target === "update"
                ? parseGistUrl((dialogElement.querySelector("input[data-action='gistPublishGistId']") as HTMLInputElement).value)
                : parseGistUrl(this.lastPublishGistUrl);
            if (!inputId) {
                this.plugin.showErrorMessage(this.plugin.i18n.gistPublishInvalidGistId);
                return;
            }
            // 拉取现有 gist 计算将删除的旧文件（镜像语义），供确认文本展示
            try {
                const existing = await getGist(inputId, {token: this.plugin.gistTokenService.token});
                const rows = buildPublishFiles(selected);
                const payload = planUpdateFiles(existing, rows);
                const deleteCount = Object.values(payload).filter(value => value === null).length;
                if (deleteCount > 0) {
                    confirmText = this.plugin.i18n.gistPublishDeleteConfirm.replace("${count}", String(deleteCount));
                }
            } catch (error) {
                this.plugin.showErrorMessage(this.gistErrorMessage(error));
                return;
            }
            publishTarget = {kind: "update", gistId: inputId};
        } else {
            // 新建：可见性在创建时确定（更新既有 gist 无法改变可见性）
            publishTarget = {kind: "create", publicGist: target === "new-public"};
        }
        if (target === "new-public") {
            // 公开创建：确认内容将公开
            confirmText = this.plugin.i18n.gistPublishPublicConfirm;
        }

        const doPublish = () => {
            void this.plugin.gistSyncService.publishToGist({
                target: publishTarget,
                snippets: selected,
            }).then(gist => {
                // 成功：关闭对话框并弹出含链接的消息
                this.plugin.snippetsDialog.closeByElement(dialogElement);
                const link = `<a href="${gist.html_url}" target="_blank" rel="noopener noreferrer">${gist.html_url}</a>`;
                showMessage(this.plugin.displayName + ": " + this.plugin.i18n.gistPublishSuccess.replace("${url}", link), 10000, "info");
            }).catch(error => {
                this.plugin.showErrorMessage(this.gistErrorMessage(error));
            });
        };

        if (confirmText) {
            this.plugin.snippetsDialog.openConfirm(confirmTitle, confirmText, "jcsm-gist-publish-confirm", undefined, this.plugin.i18n.gistPublishButton, doPublish);
        } else {
            doPublish();
        }
    }

    /**
     * 是否存在除来源设置对话框之外的其它已打开模态对话框（模态守卫）
     * 从设置面板按钮打开 Gist 对话框时，来源设置对话框（data-key 以 jcsm- 开头）自身
     * 会被 getAllModalElements 计入，因此先排除它；其余模态（代码片段编辑/其它确认等）
     * 存在时仍拒绝打开，避免全局键盘协调（Esc/Enter 路由）错乱。
     * @param settingDialogElement 来源设置对话框元素（可为空）
     * @returns 是否被其它模态对话框阻塞
     */
    private blockedByOtherModals(settingDialogElement?: HTMLElement): boolean {
        return this.plugin.snippetsDialog.getAllModalElements().some(element => element !== settingDialogElement);
    }

    /**
     * 打开「从 Gist 导入」对话框
     * @param settingDialogElement 来源设置对话框元素（关闭它以避免模态叠加）
     */
    async openImport(settingDialogElement?: HTMLElement) {
        // 来源设置对话框自身会被计入模态守卫，需先排除（随后下方关闭它）
        if (this.blockedByOtherModals(settingDialogElement)) {
            return;
        }
        if (settingDialogElement) {
            this.plugin.snippetsDialog.closeByElement(settingDialogElement);
        }
        // 关闭插件菜单：菜单容器会拦截弹窗内的滚轮/触摸滚动（与 openPublish 同理）
        this.plugin.menuView.close();
        // 读取「上次导入」与「上次发布」历史，决定导入源（任一存在才显示来源单选，默认选「上次导入的 Gist」）
        const importState = await this.plugin.gistSyncService.loadImportState();
        const publishState = await this.plugin.gistSyncService.loadPublishState();
        this.lastImportGistUrl = importState?.gistUrl ?? "";
        this.lastPublishGistUrl = publishState?.gistUrl ?? "";
        const hasImport = !!this.lastImportGistUrl;
        const hasPublish = !!this.lastPublishGistUrl;
        // 默认源：上次导入 > 上次发布；都无则不显示来源单选，仅自定义链接输入
        const defaultSource = hasImport ? "last-import" : hasPublish ? "last-publish" : "custom";
        // 「上次导入/上次发布的 Gist」句中的短语按各自链接渲染为链接或纯文本
        const importLastImportLabel = hasImport
            ? this.phraseSentence(this.plugin.i18n.gistImportSourceLastImport, "gistLastImportedGist", this.lastImportGistUrl)
            : "";
        const importLastPublishLabel = hasPublish
            ? this.phraseSentence(this.plugin.i18n.gistImportSourceLast, "gistLastGist", this.lastPublishGistUrl)
            : "";
        // 打开前刷新会话列表，供预览「导入动作」列与导入规划使用
        void this.plugin.snippetManager.refreshSnippetsList();

        const dialog = new Dialog({
            title: this.plugin.i18n.gistImport,
            // 结构与设置对话框同构：正文整块放原生 .b3-dialog__content（原生 flex:1 + overflow 保证
            // 正文整体滚动、action 固定底部），不依赖自定义 flex 高度链
            content: `
<div class="b3-dialog__content">
    ${(hasImport || hasPublish) ? `
    <div class="fn__flex fn__flex-center" data-action="gistSourceGroup">
        ${hasImport ? `<label class="fn__flex b3-label jcsm-gist-option"><input type="radio" name="jcsm-gist-source" value="last-import"${defaultSource === "last-import" ? " checked" : ""}>${importLastImportLabel}</label>
        <div class="fn__space"></div>` : ""}
        ${hasPublish ? `<label class="fn__flex b3-label jcsm-gist-option"><input type="radio" name="jcsm-gist-source" value="last-publish"${defaultSource === "last-publish" ? " checked" : ""}>${importLastPublishLabel}</label>
        <div class="fn__space"></div>` : ""}
        <label class="fn__flex b3-label jcsm-gist-option"><input type="radio" name="jcsm-gist-source" value="custom"${defaultSource === "custom" ? " checked" : ""}>${this.plugin.i18n.gistImportSourceCustom}</label>
    </div>` : ""}
    <div class="fn__flex${(hasImport || hasPublish) ? " fn__none" : ""}" data-action="gistUrlRow">
        <input class="b3-text-field fn__flex-1" data-action="gistUrl" type="text" spellcheck="false" placeholder="${this.plugin.i18n.gistImportUrlPlaceholder}">
        <div class="fn__space"></div>
        <span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="gistFetch">${this.plugin.i18n.gistImportFetch}</span>
    </div>
    <div class="b3-label__text" data-action="gistTokenHint"></div>
    <div data-action="gistModeGroup">
        <label class="jcsm-gist-mode-item"><span class="jcsm-gist-mode-title"><input type="radio" name="jcsm-gist-mode" value="merge" checked>${this.plugin.i18n.gistImportModeMerge}</span><span class="jcsm-gist-mode-desc">${this.plugin.i18n.gistImportModeMergeDescription}</span></label>
        <label class="jcsm-gist-mode-item"><span class="jcsm-gist-mode-title"><input type="radio" name="jcsm-gist-mode" value="overwrite">${this.plugin.i18n.gistImportModeOverwrite}</span><span class="jcsm-gist-mode-desc">${this.plugin.i18n.gistImportModeOverwriteDescription}</span></label>
        <label class="jcsm-gist-mode-item"><span class="jcsm-gist-mode-title"><input type="radio" name="jcsm-gist-mode" value="fork">${this.plugin.i18n.gistImportModeFork}</span><span class="jcsm-gist-mode-desc">${this.plugin.i18n.gistImportModeForkDescription}</span></label>
    </div>
    <div class="fn__hr"></div>
    <div class="jcsm-gist-result"></div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="cancel">${this.plugin.i18n.cancel}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-action="gistImport">${this.plugin.i18n.gistImportButton}</button>
</div>
            `,
            width: this.plugin.isMobile ? "92vw" : "720px",
            height: "80vh",
        });
        attachDialogObject(dialog.element, dialog);
        dialog.element.setAttribute("data-key", GIST_IMPORT_DIALOG_KEY);
        dialog.element.setAttribute("data-modal", "true");
        // 备份原生 destroy 到 destroyNative 并覆盖 destroy（见发布对话框注释）
        dialog.destroyNative = dialog.destroy;
        dialog.destroy = () => {
            this.plugin.console.log("gist import dialog destroy");
            this.plugin.snippetsDialog.closeByElement(dialog.element);
        };

        // Token 提示（未配置时提示可匿名拉公开 gist；secret 需要 Token）
        const tokenHint = dialog.element.querySelector("[data-action='gistTokenHint']") as HTMLElement;
        if (!this.plugin.gistTokenService.hasToken) {
            tokenHint.textContent = this.plugin.i18n.gistImportTokenHint;
        } else {
            tokenHint.textContent = "";
        }

        // 对话框级键盘：Esc 关闭；Enter 由全局协调路由（无焦点按钮时不默认操作）
        setDialogKeyHandler(dialog.element, (key) => {
            if (key === "Escape") {
                this.plugin.snippetsDialog.closeByElement(dialog.element);
            }
        });

        // 点击分发（仅本对话框内元素；对话框关闭后监听器随元素移除）
        const clickHandler = (event: MouseEvent) => {
            event.stopPropagation();
            const target = event.target as HTMLElement;
            const tagName = target.tagName.toLowerCase();
            const isScrim = target.classList.contains("b3-dialog__scrim");
            // 取消按钮与遮罩：关闭对话框；其余按钮（导入等）落入下方 action 判断
            if (isScrim || (tagName === "button" && target.dataset.type === "cancel" && !target.dataset.action)) {
                this.plugin.snippetsDialog.closeByElement(dialog.element);
                return;
            }
            const action = target.closest("[data-action]")?.getAttribute("data-action");
            if (action === "gistFetch") {
                void this.handleFetch(dialog.element);
            } else if (action === "gistImport") {
                void this.handleImport(dialog.element);
            } else if (action === "gistImportCompare") {
                // 点击预览行：对比 Gist 文件与本地相同 ID 片段的差异
                event.preventDefault();
                event.stopPropagation();
                this.openImportCompare(target);
            }
        };
        this.plugin.addListener(dialog.element, "click", clickHandler, {capture: true});

        // URL 输入框回车等同「获取」
        const urlInput = dialog.element.querySelector("input[data-action='gistUrl']") as HTMLInputElement;
        urlInput.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                void this.handleFetch(dialog.element);
            }
        });

        // 历史源为默认时隐藏 URL 输入行；切到「指定 Gist」才显示
        const urlRow = dialog.element.querySelector("[data-action='gistUrlRow']") as HTMLElement | null;
        const syncSourceUrlRow = () => {
            const source = dialog.element.querySelector("input[name='jcsm-gist-source']:checked") as HTMLInputElement | null;
            urlRow?.classList.toggle("fn__none", source?.value !== "custom");
        };
        dialog.element.querySelectorAll("input[name='jcsm-gist-source']").forEach(radio => {
            radio.addEventListener("change", syncSourceUrlRow);
        });
        syncSourceUrlRow();

        // 模式切换后按当前模式重渲染预览的动作列
        const resultContainer = dialog.element.querySelector(".jcsm-gist-result") as HTMLElement;
        dialog.element.querySelectorAll("input[name='jcsm-gist-mode']").forEach(radio => {
            radio.addEventListener("change", () => {
                if (this.importData) {
                    this.renderResult(resultContainer);
                }
            });
        });

        // 默认源为历史（上次导入/上次发布）时打开即自动拉取预览：
        // handleFetch 会在结果区先写入「获取中」文案，拉取完成后渲染勾选清单
        if (defaultSource !== "custom") {
            void this.handleFetch(dialog.element);
        }

        this.plugin.console.log("gist import dialog opened");
    }

    /** 当前所选导入模式 */
    private getSelectedMode(dialogElement: HTMLElement): ImportMode {
        const checked = dialogElement.querySelector("input[name='jcsm-gist-mode']:checked") as HTMLInputElement | null;
        return (checked?.value as ImportMode) ?? "merge";
    }

    /**
     * 当前导入源对应的 gist 输入值（随后经 parseGistUrl 解析出 id）
     * 「上次导入/上次发布的 Gist」返回记忆的完整链接；「指定 Gist」取 URL 输入框的值
     */
    private selectedImportGistId(dialogElement: HTMLElement): string {
        const source = dialogElement.querySelector("input[name='jcsm-gist-source']:checked") as HTMLInputElement | null;
        if (source?.value === "last-import") {
            return this.lastImportGistUrl;
        }
        if (source?.value === "last-publish") {
            return this.lastPublishGistUrl;
        }
        const urlInput = dialogElement.querySelector("input[data-action='gistUrl']") as HTMLInputElement | null;
        return urlInput?.value ?? "";
    }

    /**
     * 拉取并渲染 gist 预览
     */
    private async handleFetch(dialogElement: HTMLElement) {
        const resultContainer = dialogElement.querySelector(".jcsm-gist-result") as HTMLElement;
        const gistId = parseGistUrl(this.selectedImportGistId(dialogElement));
        if (!gistId) {
            this.plugin.showErrorMessage(this.plugin.i18n.gistImportInvalidUrl);
            return;
        }
        resultContainer.textContent = this.plugin.i18n.gistImportFetching;
        try {
            const service = this.getSyncService();
            this.importData = await service.fetchImportData(gistId);
            this.renderResult(resultContainer);
        } catch (error) {
            this.importData = undefined;
            resultContainer.textContent = "";
            this.plugin.showErrorMessage(this.gistErrorMessage(error));
        }
    }

    /** 取 Gist 同步服务（惰性装配） */
    private getSyncService(): GistSyncService {
        return this.plugin.gistSyncService;
    }

    /** 归一错误 → 用户可读文案（kind 映射） */
    private gistErrorMessage(error: unknown): string {
        const kind = (error as GistApiError)?.kind;
        const i18n = this.plugin.i18n;
        switch (kind) {
            case "not-found":
                return i18n.gistErrorNotFound;
            case "unauthorized":
                return i18n.gistErrorUnauthorized;
            case "rate-limit":
                return i18n.gistErrorRateLimit;
            case "network":
                return i18n.gistErrorNetwork;
            default:
                return (error as Error)?.message ?? String(error);
        }
    }

    /** 渲染拉取结果：conf 特例按片段列表，普通 gist 按文件列表 */
    private renderResult(resultContainer: HTMLElement) {
        const data = this.importData;
        if (!data) {
            return;
        }
        if (data.confSnippets) {
            this.renderConfRows(resultContainer, data);
        } else {
            this.renderFileRows(resultContainer, data);
        }
    }

    /** conf 特例：逐片段行（保留原 id/enabled；单行名称，点击对比同 ID 差异） */
    private renderConfRows(resultContainer: HTMLElement, data: GistImportData) {
        const rowsHtml = data.confSnippets!.map((snippet, index) => {
            const title = snippet.name || snippet.content.slice(0, 50);
            return `
<label class="jcsm-gist-row">
    <input type="checkbox" data-gist-row="${index}" checked>
    <span class="jcsm-gist-name fn__flex-1" data-action="gistImportCompare" data-gist-src="conf" data-gist-row="${index}" title="${this.escape(title)}">${this.escape(snippet.name || snippet.content.slice(0, 50))}</span>
    <span class="jcsm-gist-type-static">${snippet.type.toUpperCase()}</span>
</label>`;
        }).join("");
        resultContainer.innerHTML = rowsHtml || this.plugin.i18n.gistImportEmpty;
    }

    /** 普通 gist：逐文件行（单行名称；类型可解析时静态文本，解析不出时才给下拉；名称点击对比） */
    private renderFileRows(resultContainer: HTMLElement, data: GistImportData) {
        const rowsHtml = data.files.map((file, index) => {
            if (file.isConf) {
                return "";
            }
            const errorTitle = file.fetchError ? `（${this.plugin.i18n.gistImportTruncatedFailed}）` : "";
            // 默认勾选 css/js 家族文件；README/其它说明文件不勾选（conf 特例文件另行处理）
            const checkable = hasResolvableType(file.fileName);
            const subHint = (file.id ?? this.plugin.i18n.gistImportNoId) + errorTitle;
            const title = `${file.fileName}${errorTitle}\n${subHint}`;
            // 类型：能由扩展名解析时只读展示；解析不出时提供下拉（见 hasResolvableType）
            const typeControl = checkable
                ? `<span class="jcsm-gist-type-static">${file.type.toUpperCase()}</span>`
                : `<select class="b3-select jcsm-gist-type" data-gist-type="${index}">
    <option value="css"${file.type === "css" ? " selected" : ""}>CSS</option>
    <option value="js"${file.type === "js" ? " selected" : ""}>JS</option>
</select>`;
            return `
<label class="jcsm-gist-row">
    <input type="checkbox" data-gist-row="${index}"${checkable ? " checked" : ""}${file.fetchError ? " disabled" : ""}>
    <span class="jcsm-gist-name fn__flex-1" data-action="gistImportCompare" data-gist-src="file" data-gist-row="${index}" title="${this.escape(title)}">${this.escape(file.fileName)}</span>
    ${typeControl}
</label>`;
        }).join("");
        resultContainer.innerHTML = rowsHtml || this.plugin.i18n.gistImportEmpty;
    }

    /**
     * 打开导入行对比：Gist 文件 ↔ 本地相同 ID 片段的行级差异
     */
    private openImportCompare(trigger: HTMLElement) {
        const data = this.importData;
        if (!data) {
            return;
        }
        const src = (trigger.closest("[data-gist-src]") as HTMLElement)?.dataset.gistSrc;
        const index = Number((trigger.closest("[data-gist-row]") as HTMLElement)?.dataset.gistRow);
        if ((src !== "file" && src !== "conf") || Number.isNaN(index)) {
            return;
        }

        // 取 Gist 侧名称/内容与本地侧同 ID 片段
        let gistName = "";
        let gistContent = "";
        let gistId = "";
        let local: Snippet | undefined;
        if (src === "file") {
            const file = data.files[index];
            if (!file) return;
            gistName = file.fileName;
            gistContent = file.content;
            gistId = file.id ?? "";
            local = gistId ? this.plugin.snippetsList.find(snippet => snippet.id === gistId) : undefined;
        } else {
            const snippet = data.confSnippets?.[index];
            if (!snippet) return;
            gistName = snippet.name || snippet.content.slice(0, 50);
            gistContent = snippet.content;
            gistId = snippet.id ?? "";
            local = gistId ? this.plugin.snippetsList.find(item => item.id === gistId) : undefined;
        }

        let body: string;
        if (!local) {
            // 本地无相同 ID：说明将作为新增导入，并展示 Gist 侧内容（无需假 diff）
            body = `
<div class="jcsm-gist-compare">
    <div class="b3-label__text">${this.plugin.i18n.gistCompareNoLocal}</div>
    <div class="jcsm-gist-preview"><code>${this.escape(gistContent) || "&nbsp;"}</code></div>
</div>`;
        } else {
            const lines = diffWithContext(diffLines(local.content, gistContent));
            const identical = lines.length > 0 && lines.every(line => line.type === "equal");
            body = identical
                ? `<div class="b3-label__text">${this.plugin.i18n.gistCompareIdentical}</div>`
                : `
<div class="jcsm-gist-compare">
    <div class="b3-label__text">${this.plugin.i18n.gistCompareLegend}</div>
    ${this.renderDiffRows(lines)}
</div>`;
        }
        this.openResultDialog(this.plugin.i18n.gistCompareTitle, gistName, body);
    }

    /** 渲染 diff 行为 HTML（+ 新增 / - 删除 / 空 相同 / ⋯ 折叠） */
    private renderDiffRows(lines: {type: "equal" | "del" | "add"; text: string}[]): string {
        return lines.map(line => {
            if (line.type === "equal" && line.text === DIFF_SKIPPED) {
                return `<div class="jcsm-gist-diff-skip">${this.escape(this.plugin.i18n.gistDiffSkipped)}</div>`;
            }
            const mark = line.type === "del" ? "−" : line.type === "add" ? "+" : " ";
            return `<div class="jcsm-gist-diff-row jcsm-gist-diff-${line.type}"><span class="jcsm-gist-diff-mark">${mark}</span><span class="jcsm-gist-diff-code">${this.escape(line.text) || "&nbsp;"}</span></div>`;
        }).join("");
    }

    /** 发布行：弹窗预览片段内容 */
    private openSnippetPreview(snippet: Snippet) {
        const body = `<div class="jcsm-gist-preview"><code>${this.escape(snippet.content) || this.plugin.i18n.emptySnippet}</code></div>`;
        this.openResultDialog(this.plugin.i18n.gistPreviewTitle, snippet.name || snippet.content.slice(0, 50), body);
    }

    /** 打开只读结果对话框（diff/内容预览共用；data-key 纳入 jcsm- 模态协调） */
    private openResultDialog(title: string, name: string, body: string) {
        const dialog = new Dialog({
            title,
            content: `
<div class="b3-dialog__content">
    <div class="jcsm-gist-dialog-name">${this.escape(name)}</div>
    ${body}
</div>
            `,
            width: this.plugin.isMobile ? "92vw" : "80vw",
            height: this.plugin.isMobile ? "92vh" : "80vh",
        });
        attachDialogObject(dialog.element, dialog);
        dialog.element.setAttribute("data-key", "jcsm-gist-result");
        dialog.element.setAttribute("data-modal", "true");
        dialog.destroyNative = dialog.destroy;
        dialog.destroy = () => {
            this.plugin.snippetsDialog.closeByElement(dialog.element);
        };
        setDialogKeyHandler(dialog.element, (key) => {
            if (key === "Escape") {
                this.plugin.snippetsDialog.closeByElement(dialog.element);
            }
        });
    }

    /** HTML 转义（预览行名称拼入 innerHTML） */
    private escape(text: string): string {
        return text.replace(/[&<>"']/g, char =>
            char === "&" ? "&amp;" :
            char === "<" ? "&lt;" :
            char === ">" ? "&gt;" :
            char === "\"" ? "&quot;" : "&#39;"
        );
    }

    /**
     * 执行导入（组装勾选集 → importSnippetsFromData → 成功消息）
     */
    private async handleImport(dialogElement: HTMLElement) {
        const data = this.importData;
        if (!data) {
            this.plugin.showErrorMessage(this.plugin.i18n.gistImportFetchFirst);
            return;
        }
        const rows = this.collectCheckedRows(dialogElement);
        if (rows.length === 0) {
            this.plugin.showErrorMessage(this.plugin.i18n.gistImportNoCheck);
            return;
        }
        const mode = this.getSelectedMode(dialogElement);
        const snippetList = rows.map(row => ({
            id: row.id ?? "",
            name: row.name,
            content: row.content,
            type: row.type,
            enabled: row.enabled,
        }) as Snippet);

        const result = await this.plugin.importExportService.importSnippetsFromData(snippetList, mode);
        if (!result) {
            return;
        }
        // 记录上次导入来源（仅用于下次导入默认源；以完整链接标识）
        await this.plugin.gistSyncService.saveImportState({
            gistUrl: data.gistUrl,
            importedAt: new Date().toISOString(),
        });
        // 成功消息（含新增/更新计数）
        const message = this.plugin.i18n.gistImportSuccess
            .replace("${added}", String(result.addedCount))
            .replace("${updated}", String(result.updatedCount));
        showMessage(this.plugin.displayName + ": " + message, 3000, "info");
        this.plugin.snippetsDialog.closeByElement(dialogElement);
    }

    /** 收集勾选行并解析为待导入片段（类型下拉修改生效） */
    private collectCheckedRows(dialogElement: HTMLElement): PreviewRow[] {
        const data = this.importData;
        if (!data) {
            return [];
        }
        const rows: PreviewRow[] = [];
        if (data.confSnippets) {
            dialogElement.querySelectorAll("input[data-gist-row]:checked").forEach(input => {
                const snippet = data.confSnippets![Number((input as HTMLInputElement).dataset.gistRow)];
                if (snippet) {
                    rows.push({
                        key: snippet.id ?? snippet.name,
                        name: snippet.name,
                        id: snippet.id,
                        type: snippet.type,
                        content: snippet.content,
                        enabled: snippet.enabled,
                    });
                }
            });
        } else {
            dialogElement.querySelectorAll("input[data-gist-row]:checked").forEach(input => {
                const file = data.files[Number((input as HTMLInputElement).dataset.gistRow)];
                if (!file || file.isConf || file.fetchError) {
                    return;
                }
                const typeSelect = dialogElement.querySelector(`select[data-gist-type='${(input as HTMLInputElement).dataset.gistRow}']`) as HTMLSelectElement | null;
                const type = (typeSelect?.value as SnippetType) ?? file.type;
                rows.push({
                    key: file.fileName,
                    name: file.name,
                    id: file.id,
                    type,
                    content: file.content,
                    enabled: false,
                });
            });
        }
        return rows;
    }
}
