// Gist 导入/发布对话框
// 职责：从设置面板打开「从 Gist 导入」对话框（拉取预览 → 勾选片段 → merge/overwrite/fork 导入），
// 以及后续里程碑的「发布到 Gist」对话框。对话框以 data-key 前缀 jcsm- 接入统一模态协调
// （SnippetsDialog.closeByElement/getAllModalElements/closeAllDialogs 与菜单全局键盘）。
import {Dialog, showMessage} from "siyuan";
import {
    attachDialogObject,
    setDialogKeyHandler,
} from "../utils";
import {parseGistUrl} from "../services/gist";
import type {GistApiError} from "../services/gist";
import type {GistImportData, GistSyncService} from "../services/gist-sync";
import type {ImportMode} from "../domain/import-plan";
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

    /**
     * 打开「从 Gist 导入」对话框
     * @param settingDialogElement 来源设置对话框元素（关闭它以避免模态叠加）
     */
    openImport(settingDialogElement?: HTMLElement) {
        if (this.plugin.snippetsDialog.getAllModalElements().length > 0) {
            return;
        }
        if (settingDialogElement) {
            this.plugin.snippetsDialog.closeByElement(settingDialogElement);
        }
        // 打开前刷新会话列表，供预览「导入动作」列与导入规划使用
        void this.plugin.snippetManager.refreshSnippetsList();

        const dialog = new Dialog({
            title: this.plugin.i18n.gistImport,
            content: `
<div class="jcsm-gist-dialog fn__flex-column">
    <div class="fn__flex">
        <input class="b3-text-field fn__flex-1" data-action="gistUrl" type="text" spellcheck="false" placeholder="${this.plugin.i18n.gistImportUrlPlaceholder}">
        <div class="fn__space"></div>
        <span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="gistFetch">${this.plugin.i18n.gistImportFetch}</span>
    </div>
    <div class="b3-label__text" data-action="gistTokenHint"></div>
    <div class="fn__flex fn__flex-center" data-action="gistModeGroup">
        <label class="b3-label fn__flex-center"><input type="radio" name="jcsm-gist-mode" value="merge" checked>${this.plugin.i18n.gistImportModeMerge}</label>
        <label class="b3-label fn__flex-center"><input type="radio" name="jcsm-gist-mode" value="overwrite">${this.plugin.i18n.gistImportModeOverwrite}</label>
        <label class="b3-label fn__flex-center"><input type="radio" name="jcsm-gist-mode" value="fork">${this.plugin.i18n.gistImportModeFork}</label>
    </div>
    <div class="fn__hr"></div>
    <div class="jcsm-gist-result" style="max-height: 48vh; overflow-y: auto;"></div>
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
            if (tagName === "button" || isScrim) {
                const type = target.dataset.type;
                if (type === "cancel" || isScrim) {
                    this.plugin.snippetsDialog.closeByElement(dialog.element);
                }
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
<label class="fn__flex b3-label jcsm-gist-row">
    <input type="checkbox" data-gist-row="${index}" checked>
    <div class="fn__flex-1 fn__flex fn__flex-column">
        <span class="fn__ellipsis">${this.escape(snippet.name || snippet.content.slice(0, 50))}</span>
        <span class="b3-label__text">${snippet.id ? snippet.id : ""}</span>
    </div>
    <span class="b3-label__text fn__flex-center">${snippet.type.toUpperCase()}</span>
    <span class="b3-label__text fn__flex-center">${actionText}</span>
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
<label class="fn__flex b3-label jcsm-gist-row">
    <input type="checkbox" data-gist-row="${index}"${checkable ? " checked" : ""}${file.fetchError ? " disabled" : ""}>
    <div class="fn__flex-1 fn__flex fn__flex-column">
        <span class="fn__ellipsis"${errorTitle}>${this.escape(file.fileName)}</span>
        <span class="b3-label__text">${file.id ? file.id : this.plugin.i18n.gistImportNoId}${file.fetchError ? "（" + this.plugin.i18n.gistImportTruncatedFailed + "）" : ""}</span>
    </div>
    <select class="b3-select" data-gist-type="${index}">
        <option value="css"${file.type === "css" ? " selected" : ""}>CSS</option>
        <option value="js"${file.type === "js" ? " selected" : ""}>JS</option>
    </select>
    <span class="b3-label__text fn__flex-center">${actionText}</span>
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
