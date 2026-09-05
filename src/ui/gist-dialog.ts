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
import {snippetTitle} from "../domain/snippet";
import type {Snippet, SnippetType} from "../types";
import type PluginSnippets from "../index";

/** 导入对话框 data-key（纳入模态协调） */
const GIST_IMPORT_DIALOG_KEY = "jcsm-gist-import";

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
        await this.plugin.snippetManager.refreshSnippetsList();

        // 默认勾选已启用片段；筛选重置为全部
        this.publishCheckedIds = new Set(this.plugin.snippetsList.filter(snippet => snippet.enabled).map(snippet => snippet.id));
        this.publishFilter = "all";

        // 读取上次发布目标（无历史时以新建 secret 为默认）
        const publishState = await this.plugin.gistSyncService.loadPublishState();

        const dialog = new Dialog({
            title: this.plugin.i18n.gistPublish,
            // 结构复用代码片段编辑对话框：.jcsm-dialog 占满 .b3-dialog__body（flex 布局见 index.scss），
            // 中部 .jcsm-dialog-container 为可滚动内容区（flex:1 + min-height:0），底部 .b3-dialog__action 常驻
            content: `
<div class="jcsm-dialog">
    <div class="jcsm-dialog-container">
        <div class="fn__flex fn__flex-center fn__flex-wrap" data-action="gistPublishToolbar">
            <span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="gistPublishFilter" data-pub-filter="all">${this.plugin.i18n.gistPublishFilterAll}</span>
            <div class="fn__space"></div>
            <span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="gistPublishFilter" data-pub-filter="css">CSS</span>
            <div class="fn__space"></div>
            <span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="gistPublishFilter" data-pub-filter="js">JS</span>
            <div class="fn__space"></div>
            <span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="gistPublishFilter" data-pub-filter="enabled">${this.plugin.i18n.gistPublishFilterEnabled}</span>
            <div class="fn__space"></div>
            <span class="b3-label__text fn__flex-1" data-action="gistPublishCount"></span>
        </div>
        <div class="jcsm-gist-publish-list"></div>
        <div class="fn__hr"></div>
        <div class="fn__flex fn__flex-column fn__flex-wrap" data-action="gistPublishTarget">
            <label class="jcsm-gist-option"><input type="radio" name="jcsm-gist-target" value="new-secret" checked>${this.plugin.i18n.gistPublishTargetNewSecret}</label>
            <label class="jcsm-gist-option"><input type="radio" name="jcsm-gist-target" value="new-public">${this.plugin.i18n.gistPublishTargetNewPublic}</label>
            <label class="jcsm-gist-option"><input type="radio" name="jcsm-gist-target" value="update">${publishState ? this.plugin.i18n.gistPublishTargetUpdateLast : this.plugin.i18n.gistPublishTargetUpdate}</label>
            <div class="fn__flex fn__flex-center" style="margin-top: 4px;">
                <input class="b3-text-field fn__flex-1" data-action="gistPublishGistId" type="text" spellcheck="false" placeholder="${this.plugin.i18n.gistPublishGistIdPlaceholder}">
            </div>
        </div>
        <div class="jcsm-gist-publish-summary b3-label__text" data-action="gistPublishSummary"></div>
    </div>
    <div class="b3-dialog__action">
        <button class="b3-button b3-button--cancel" data-type="cancel">${this.plugin.i18n.cancel}</button>
        <div class="fn__space"></div>
        <button class="b3-button b3-button--text" data-action="gistPublish">${this.plugin.i18n.gistPublishButton}</button>
    </div>
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

        // 上次发布目标预填 gist id（更新单选默认选中）；无历史则更新输入框留空且禁用
        const gistIdInput = dialog.element.querySelector("input[data-action='gistPublishGistId']") as HTMLInputElement;
        const updateRadio = dialog.element.querySelector("input[value='update']") as HTMLInputElement;
        if (publishState) {
            gistIdInput.value = publishState.gistId;
            updateRadio.checked = true;
        }
        const syncTargetState = () => {
            const target = this.publishTarget(dialog.element);
            gistIdInput.disabled = target !== "update";
        };
        syncTargetState();

        // 键盘：Esc 关闭
        setDialogKeyHandler(dialog.element, (key) => {
            if (key === "Escape") {
                this.plugin.snippetsDialog.closeByElement(dialog.element);
            }
        });

        // 渲染片段勾选清单与计数
        const listContainer = dialog.element.querySelector(".jcsm-gist-publish-list") as HTMLElement;
        const renderList = () => this.renderPublishList(listContainer, dialog.element);
        renderList();

        // 点击分发（筛选/发布）
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
            if (action === "gistPublishFilter") {
                const filter = target.closest("[data-pub-filter]")?.getAttribute("data-pub-filter") as typeof this.publishFilter;
                if (filter) {
                    this.publishFilter = filter;
                    renderList();
                }
            } else if (action === "gistPublish") {
                void this.handlePublish(dialog.element);
            }
        };
        this.plugin.addListener(dialog.element, "click", clickHandler, {capture: true});

        // change 分发（勾选片段/切换目标/输入 gist id 实时刷新摘要）
        const changeHandler = (event: Event) => {
            event.stopPropagation();
            const target = event.target as HTMLElement;
            if (target.tagName === "INPUT") {
                const input = target as HTMLInputElement;
                if (input.dataset.action === "gistPublishFilter") {
                    this.publishFilter = input.dataset.pubFilter as typeof this.publishFilter;
                    renderList();
                } else if (input.type === "radio") {
                    syncTargetState();
                    renderList();
                } else if (input.type === "checkbox") {
                    this.syncPublishChecked(input);
                }
            }
            this.renderPublishSummary(dialog.element);
        };
        this.plugin.addListener(dialog.element, "change", changeHandler);
        this.plugin.console.log("gist publish dialog opened");
    }

    /** 当前发布目标选择（new-secret/new-public/update） */
    private publishTarget(dialogElement: HTMLElement): "new-secret" | "new-public" | "update" {
        const checked = dialogElement.querySelector("input[name='jcsm-gist-target']:checked") as HTMLInputElement | null;
        return (checked?.value as "new-secret" | "new-public" | "update") ?? "new-secret";
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

    /** 按当前筛选渲染片段勾选清单 */
    private renderPublishList(listContainer: HTMLElement, dialogElement: HTMLElement) {
        const snippets = this.filterSnippets(this.plugin.snippetsList);
        if (snippets.length === 0 && this.plugin.snippetsList.length === 0) {
            listContainer.textContent = this.plugin.i18n.emptySnippet;
            return;
        }
        listContainer.innerHTML = snippets.map(snippet => `
<label class="fn__flex jcsm-gist-row">
    <input type="checkbox" data-pub-id="${snippet.id}"${this.publishCheckedIds.has(snippet.id) ? " checked" : ""}>
    <span class="fn__flex-1 fn__ellipsis">${this.escape(snippetTitle(snippet))}</span>
    <span class="jcsm-gist-row-sub fn__flex-center">${snippet.type.toUpperCase()}${snippet.enabled ? "" : " · " + this.plugin.i18n.gistPublishDisabled}</span>
</label>`).join("");
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

    /** 更新勾选计数与将写入文件摘要 */
    private renderPublishSummary(dialogElement: HTMLElement) {
        const countElement = dialogElement.querySelector("[data-action='gistPublishCount']") as HTMLElement;
        const summaryElement = dialogElement.querySelector("[data-action='gistPublishSummary']") as HTMLElement;
        const selected = this.selectedPublishSnippets();
        countElement.textContent = this.plugin.i18n.gistPublishSelectedCount.replace("${count}", String(selected.length));
        const files = buildPublishFiles(selected);
        const fileNamePreview = files.length === 0
            ? ""
            : this.plugin.i18n.gistPublishFilesPreview + " " + files.map(file => file.fileName).join(", ");
        summaryElement.textContent = fileNamePreview;
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
        if (target === "update") {
            const gistId = parseGistUrl((dialogElement.querySelector("input[data-action='gistPublishGistId']") as HTMLInputElement).value);
            if (!gistId) {
                this.plugin.showErrorMessage(this.plugin.i18n.gistPublishInvalidGistId);
                return;
            }
            // 拉取现有 gist 计算将删除的旧文件（镜像语义），供确认文本展示
            try {
                const existing = await getGist(gistId, {token: this.plugin.gistTokenService.token});
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
            publishTarget = {kind: "update", gistId};
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
                showMessage(this.plugin.displayName + ": " + this.plugin.i18n.gistPublishSuccess.replace("${url}", link), 6000, "info");
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
    openImport(settingDialogElement?: HTMLElement) {
        // 来源设置对话框自身会被计入模态守卫，需先排除（随后下方关闭它）
        if (this.blockedByOtherModals(settingDialogElement)) {
            return;
        }
        if (settingDialogElement) {
            this.plugin.snippetsDialog.closeByElement(settingDialogElement);
        }
        // 打开前刷新会话列表，供预览「导入动作」列与导入规划使用
        void this.plugin.snippetManager.refreshSnippetsList();

        const dialog = new Dialog({
            title: this.plugin.i18n.gistImport,
            // 结构同发布对话框：.jcsm-dialog + .jcsm-dialog-container（滚动区）+ 底部 .b3-dialog__action
            content: `
<div class="jcsm-dialog">
    <div class="jcsm-dialog-container">
        <div class="fn__flex">
            <input class="b3-text-field fn__flex-1" data-action="gistUrl" type="text" spellcheck="false" placeholder="${this.plugin.i18n.gistImportUrlPlaceholder}">
            <div class="fn__space"></div>
            <span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="gistFetch">${this.plugin.i18n.gistImportFetch}</span>
        </div>
        <div class="b3-label__text" data-action="gistTokenHint"></div>
        <div class="fn__flex fn__flex-center" data-action="gistModeGroup">
            <label class="jcsm-gist-option"><input type="radio" name="jcsm-gist-mode" value="merge" checked>${this.plugin.i18n.gistImportModeMerge}</label>
            <label class="jcsm-gist-option"><input type="radio" name="jcsm-gist-mode" value="overwrite">${this.plugin.i18n.gistImportModeOverwrite}</label>
            <label class="jcsm-gist-option"><input type="radio" name="jcsm-gist-mode" value="fork">${this.plugin.i18n.gistImportModeFork}</label>
        </div>
        <div class="fn__hr"></div>
        <div class="jcsm-gist-result"></div>
    </div>
    <div class="b3-dialog__action">
        <button class="b3-button b3-button--cancel" data-type="cancel">${this.plugin.i18n.cancel}</button>
        <div class="fn__space"></div>
        <button class="b3-button b3-button--text" data-action="gistImport">${this.plugin.i18n.gistImportButton}</button>
    </div>
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

        // 模式切换后按当前模式重渲染预览的动作列
        const resultContainer = dialog.element.querySelector(".jcsm-gist-result") as HTMLElement;
        dialog.element.querySelectorAll("input[name='jcsm-gist-mode']").forEach(radio => {
            radio.addEventListener("change", () => {
                if (this.importData) {
                    this.renderResult(resultContainer, dialog.element);
                }
            });
        });

        this.plugin.console.log("gist import dialog opened");
    }

    /** 当前所选导入模式 */
    private getSelectedMode(dialogElement: HTMLElement): ImportMode {
        const checked = dialogElement.querySelector("input[name='jcsm-gist-mode']:checked") as HTMLInputElement | null;
        return (checked?.value as ImportMode) ?? "merge";
    }

    /**
     * 拉取并渲染 gist 预览
     */
    private async handleFetch(dialogElement: HTMLElement) {
        const urlInput = dialogElement.querySelector("input[data-action='gistUrl']") as HTMLInputElement;
        const resultContainer = dialogElement.querySelector(".jcsm-gist-result") as HTMLElement;
        const gistId = parseGistUrl(urlInput.value);
        if (!gistId) {
            this.plugin.showErrorMessage(this.plugin.i18n.gistImportInvalidUrl);
            return;
        }
        resultContainer.textContent = this.plugin.i18n.gistImportFetching;
        try {
            const service = this.getSyncService();
            this.importData = await service.fetchImportData(gistId);
            this.renderResult(resultContainer, dialogElement);
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
    private renderResult(resultContainer: HTMLElement, dialogElement: HTMLElement) {
        const data = this.importData;
        if (!data) {
            return;
        }
        if (data.confSnippets) {
            this.renderConfRows(resultContainer, dialogElement, data);
        } else {
            this.renderFileRows(resultContainer, dialogElement, data);
        }
    }

    /** conf 特例：逐片段行（保留原 id/enabled） */
    private renderConfRows(resultContainer: HTMLElement, dialogElement: HTMLElement, data: GistImportData) {
        const mode = this.getSelectedMode(dialogElement);
        const localIds = new Set(this.plugin.snippetsList.map(snippet => snippet.id));
        const rowsHtml = data.confSnippets!.map((snippet, index) => {
            const actionText = mode === "merge" && !!snippet.id && localIds.has(snippet.id)
                ? this.plugin.i18n.gistImportActionUpdate
                : this.plugin.i18n.gistImportActionNew;
            return `
<label class="fn__flex jcsm-gist-row">
    <input type="checkbox" data-gist-row="${index}" checked>
    <div class="fn__flex-1 fn__flex fn__flex-column">
        <span class="fn__ellipsis">${this.escape(snippet.name || snippet.content.slice(0, 50))}</span>
        <span class="jcsm-gist-row-sub">${snippet.id ? snippet.id : ""}</span>
    </div>
    <span class="jcsm-gist-row-sub fn__flex-center">${snippet.type.toUpperCase()}</span>
    <span class="jcsm-gist-row-sub fn__flex-center">${actionText}</span>
</label>`;
        }).join("");
        resultContainer.innerHTML = rowsHtml || this.plugin.i18n.gistImportEmpty;
    }

    /** 普通 gist：逐文件行（id 提取、类型下拉、动作列、截断兜底失败标记） */
    private renderFileRows(resultContainer: HTMLElement, dialogElement: HTMLElement, data: GistImportData) {
        const mode = this.getSelectedMode(dialogElement);
        const localIds = new Set(this.plugin.snippetsList.map(snippet => snippet.id));
        const rowsHtml = data.files.map((file, index) => {
            if (file.isConf) {
                return "";
            }
            const actionText = mode === "merge" && file.id && localIds.has(file.id)
                ? this.plugin.i18n.gistImportActionUpdate
                : mode === "overwrite"
                    ? this.plugin.i18n.gistImportActionOverwrite
                    : this.plugin.i18n.gistImportActionNew;
            const errorTitle = file.fetchError ? ` title="${this.escape(file.fetchError)}"` : "";
            // 默认勾选 css/js 家族文件；README/其它说明文件不勾选（conf 特例文件另行处理）
            const checkable = /\.(css|js|mjs|cjs)$/i.test(file.fileName);
            return `
<label class="fn__flex jcsm-gist-row">
    <input type="checkbox" data-gist-row="${index}"${checkable ? " checked" : ""}${file.fetchError ? " disabled" : ""}>
    <div class="fn__flex-1 fn__flex fn__flex-column">
        <span class="fn__ellipsis"${errorTitle}>${this.escape(file.fileName)}</span>
        <span class="jcsm-gist-row-sub">${file.id ? file.id : this.plugin.i18n.gistImportNoId}${file.fetchError ? "（" + this.plugin.i18n.gistImportTruncatedFailed + "）" : ""}</span>
    </div>
    <select class="b3-select jcsm-gist-type" data-gist-type="${index}">
        <option value="css"${file.type === "css" ? " selected" : ""}>CSS</option>
        <option value="js"${file.type === "js" ? " selected" : ""}>JS</option>
    </select>
    <span class="jcsm-gist-row-sub fn__flex-center">${actionText}</span>
</label>`;
        }).join("");
        resultContainer.innerHTML = rowsHtml || this.plugin.i18n.gistImportEmpty;
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
