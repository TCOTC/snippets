// GitHub Token 加密存储服务
// 职责：以 siyuan-token-vault 为底层，把 GitHub Token 密文保存到插件数据目录
// （data/storage/petal/snippets/secret/token_<hash>.dat），并维护会话明文缓存。
// 关键约束：Token 绝不写入 plugin-config.json（该文件随跨窗口/跨设备同步明文传播），
// 因此本服务不参与 ConfigService 的 valueItems/persistConfig 路径。
import {createTokenVault, seedFromSiyuanSystem} from "siyuan-token-vault";
import type {TokenVault} from "siyuan-token-vault";
import {showMessage} from "siyuan";
import {htmlToElement} from "../utils";
import type PluginSnippets from "../index";

/**
 * GitHub Token 服务（明文仅存于会话内存：vault.cachedToken；onunload 时 clear 即可）
 */
export class GistTokenService {
    private readonly plugin: PluginSnippets;

    /**
     * Token Vault（首次使用时惰性创建；种子绑定当前工作空间与设备特征）
     */
    private vault: TokenVault | undefined;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 获取（或惰性创建）Token Vault
     * 思源多窗口同内核时各窗口为独立插件实例、各自解密同一份密文，行为一致
     */
    private getVault(): TokenVault {
        if (!this.vault) {
            const seed = seedFromSiyuanSystem(window.siyuan.config.system);
            this.vault = createTokenVault({
                seed,
                storage: {
                    save: (name, content) => this.plugin.saveData(name, content),
                    load: async (name) => {
                        const data = await this.plugin.loadData(name);
                        // 思源 loadData 无文件时返回空串，归一为 null
                        return typeof data === "string" && data.trim() ? data : null;
                    },
                    remove: (name) => this.plugin.removeData(name),
                },
            });
        }
        return this.vault;
    }

    /**
     * 会话缓存中的明文 Token（未配置或尚未加载时为空串）
     */
    get token(): string {
        return this.vault?.cachedToken ?? "";
    }

    /**
     * 会话缓存中是否已有明文 Token（与磁盘是否已保存密文无关）
     */
    get hasToken(): boolean {
        return (this.vault?.cachedToken ?? "") !== "";
    }

    /**
     * 从磁盘加载并解密 Token 到会话缓存（插件加载时预热）
     * @returns 是否加载成功（磁盘无密文时静默返回 false，密文损坏时提示重配）
     */
    async loadToken(): Promise<boolean> {
        const vault = this.getVault();
        try {
            // 磁盘上无密文（首次使用或换设备/工作空间）时静默，不视为解密失败
            if (!(await vault.hasStoredToken())) {
                vault.clear();
                return false;
            }
            const token = await vault.loadToken();
            if (token === null) {
                this.plugin.showErrorMessage(this.plugin.i18n.gistTokenDecryptFailed);
                return false;
            }
            return true;
        } catch {
            // 首次启用或无历史数据时忽略
            return false;
        }
    }

    /**
     * 加密保存 Token 到磁盘并写入会话缓存
     * @param plain 明文 Token
     * @returns 是否保存成功（失败时已弹错误提示）
     */
    async saveToken(plain: string): Promise<boolean> {
        const token = plain.trim();
        try {
            // 加密与落盘任一失败统一提示
            await this.getVault().saveToken(token);
            return true;
        } catch {
            this.plugin.showErrorMessage(this.plugin.i18n.gistTokenSaveFailed);
            return false;
        }
    }

    /**
     * 删除磁盘密文并清空会话缓存
     * @returns 是否删除成功（失败时已弹错误提示）
     */
    async removeToken(): Promise<boolean> {
        try {
            await this.getVault().removeToken();
            return true;
        } catch {
            this.plugin.showErrorMessage(this.plugin.i18n.gistTokenRemoveFailed);
            return false;
        }
    }

    /**
     * 仅清空会话明文缓存（不删除磁盘密文；插件卸载时调用）
     */
    clear(): void {
        this.vault?.clear();
    }
}

/**
 * 构建设置面板中的 GitHub Token 管理区域元素
 * 事件直接在元素上绑定（不经 SettingDialog 的 data-action 分发，避免命名空间冲突）：
 * - 「保存 Token」：把输入框明文经 GistTokenService 加密落盘；
 * - 「清除 Token」：删除磁盘密文并清空会话缓存；
 * - 输入框留空不回显明文（安全），placeholder 与状态文案提示当前是否已配置。
 * @param plugin 插件实例
 * @returns Token 设置区域元素
 */
export function buildGistTokenSettingElement(plugin: PluginSnippets): HTMLElement {
    const tokenUrl = "https://github.com/settings/tokens/new";
    const container = htmlToElement(`<div class="fn__block">
    <div class="fn__flex fn__flex-center">
        <a class="b3-button b3-button--outline fn__flex-center fn__size200 ariaLabel" href="${tokenUrl}" target="_blank" rel="noopener noreferrer" aria-label="${tokenUrl}" data-position="north">
            <svg><use xlink:href="#iconGithub"></use></svg>${plugin.i18n.gistTokenOpenGithubButton}
        </a>
    </div>
    <div class="b3-form__icona fn__block" style="margin-top: 8px;">
        <input data-action="gistTokenInput" type="password" class="b3-text-field b3-form__icona-input" placeholder="${plugin.i18n.gistTokenPlaceholder}" spellcheck="false" autocomplete="off">
        <svg data-action="gistTokenTogglePassword" class="b3-form__icona-icon" style="cursor: pointer; user-select: none;"><use xlink:href="#iconEye"></use></svg>
    </div>
    <div class="fn__flex fn__flex-center" style="margin-top: 8px;">
        <span data-action="gistTokenSave" class="b3-button b3-button--outline fn__flex-center fn__size200">${plugin.i18n.gistTokenSaveButton}</span>
        <div class="fn__space"></div>
        <span data-action="gistTokenClear" class="b3-button b3-button--outline fn__flex-center fn__size200">${plugin.i18n.gistTokenClearButton}</span>
        <div class="fn__space"></div>
        <span data-action="gistTokenStatus" class="b3-label__text fn__flex-1"></span>
    </div>
</div>`);

    const tokenInput = container.querySelector("input[data-action='gistTokenInput']") as HTMLInputElement;
    const togglePasswordIcon = container.querySelector("svg[data-action='gistTokenTogglePassword']") as SVGElement;
    const saveButton = container.querySelector("span[data-action='gistTokenSave']") as HTMLElement;
    const clearButton = container.querySelector("span[data-action='gistTokenClear']") as HTMLElement;
    const statusElement = container.querySelector("span[data-action='gistTokenStatus']") as HTMLElement;

    // 已配置状态展示（明文不回显）
    const refreshStatus = (hasToken: boolean) => {
        statusElement.textContent = hasToken
            ? plugin.i18n.gistTokenStatusConfigured
            : plugin.i18n.gistTokenStatusNotConfigured;
    };

    // 眼睛图标切换明文显示（仅用于输入确认，不落盘明文）
    togglePasswordIcon.addEventListener("click", () => {
        tokenInput.type = tokenInput.type === "password" ? "text" : "password";
    });

    // 保存 Token：输入为空时提示，避免误把「清除」语义揉进保存
    saveButton.addEventListener("click", () => {
        const token = tokenInput.value.trim();
        if (!token) {
            plugin.showErrorMessage(plugin.i18n.gistTokenEmpty);
            return;
        }
        void plugin.gistTokenService.saveToken(token).then(success => {
            if (success) {
                tokenInput.value = "";
                refreshStatus(true);
                showMessage(plugin.displayName + ": " + plugin.i18n.gistTokenSaved, 3000, "info");
            }
        });
    });

    // 清除 Token：删除磁盘密文并清空缓存
    clearButton.addEventListener("click", () => {
        void plugin.gistTokenService.removeToken().then(success => {
            if (success) {
                tokenInput.value = "";
                refreshStatus(false);
                showMessage(plugin.displayName + ": " + plugin.i18n.gistTokenRemoved, 3000, "info");
            }
        });
    });

    // 初始状态：会话缓存无明文时尝试从磁盘预热（幂等），随后按结果刷新状态文案
    void plugin.gistTokenService.loadToken().then(hasToken => {
        refreshStatus(hasToken || plugin.gistTokenService.hasToken);
    });

    return container;
}
