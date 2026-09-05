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

/** 经典 Token 创建页（需手动勾选 gist scope；GitHub 不支持 URL 预选） */
const CLASSIC_TOKEN_URL = "https://github.com/settings/tokens/new";
/** fine-grained Token 创建页（URL 参数预选 Gists 账户权限为 write，打开即默认勾选） */
const FINE_GRAINED_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new?description=SiYuan+Snippets+Gist&gists=write";

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

/** Token 设置区域容器标记（SettingDialog 点击分发经 closest 定位到本作用域） */
const GIST_TOKEN_SCOPE_CLASS = "jcsm-gist-token";

/**
 * 处理 Token 设置区域的点击动作（保存 / 清除 / 切换明文显示）
 * 设置对话框的 click 监听挂在对话框元素上且使用捕获阶段并 stopPropagation，
 * 区域内元素自绑的 click 监听不会触发，因此这里把动作集中成可被对话框分发调用的函数。
 * @param plugin 插件实例
 * @param action data-action 值（gistTokenSave / gistTokenClear / gistTokenTogglePassword）
 * @param element 触发元素（用于向上定位 Token 作用域）
 */
export function handleGistTokenAction(plugin: PluginSnippets, action: string, element: HTMLElement): void {
    const scope = element.closest(`.${GIST_TOKEN_SCOPE_CLASS}`) as HTMLElement | null;
    if (!scope) {
        return;
    }
    const tokenInput = scope.querySelector("input[data-action='gistTokenInput']") as HTMLInputElement | null;
    const statusElement = scope.querySelector("span[data-action='gistTokenStatus']") as HTMLElement | null;
    const refreshStatus = (hasToken: boolean) => {
        if (statusElement) {
            statusElement.textContent = hasToken
                ? plugin.i18n.gistTokenStatusConfigured
                : plugin.i18n.gistTokenStatusNotConfigured;
        }
    };

    if (action === "gistTokenTogglePassword" && tokenInput) {
        // 眼睛图标切换明文显示（仅用于输入确认，不落盘明文）
        tokenInput.type = tokenInput.type === "password" ? "text" : "password";
        return;
    }
    if (action === "gistTokenSave") {
        // 保存 Token：输入为空时提示，避免误把「清除」语义揉进保存
        const token = tokenInput?.value.trim() ?? "";
        if (!token) {
            plugin.showErrorMessage(plugin.i18n.gistTokenEmpty);
            return;
        }
        void plugin.gistTokenService.saveToken(token).then(success => {
            if (success) {
                if (tokenInput) {
                    tokenInput.value = "";
                }
                refreshStatus(true);
                showMessage(plugin.displayName + ": " + plugin.i18n.gistTokenSaved, 3000, "info");
            }
        });
        return;
    }
    if (action === "gistTokenClear") {
        // 清除 Token：删除磁盘密文并清空缓存
        void plugin.gistTokenService.removeToken().then(success => {
            if (success) {
                if (tokenInput) {
                    tokenInput.value = "";
                }
                refreshStatus(false);
                showMessage(plugin.displayName + ": " + plugin.i18n.gistTokenRemoved, 3000, "info");
            }
        });
    }
}

/**
 * 构建设置面板中的 GitHub Token 管理区域元素
 * 区域内按钮/眼睛图标的点击由 SettingDialog 的 data-action 分发调用
 * handleGistTokenAction 处理（见 src/ui/setting-dialog.ts）：
 * - 「保存 Token」：把输入框明文经 GistTokenService 加密落盘；
 * - 「清除 Token」：删除磁盘密文并清空会话缓存；
 * - 输入框留空不回显明文（安全），placeholder 与状态文案提示当前是否已配置。
 * @param plugin 插件实例
 * @returns Token 设置区域元素
 */
export function buildGistTokenSettingElement(plugin: PluginSnippets): HTMLElement {
    const container = htmlToElement(`<div class="fn__block ${GIST_TOKEN_SCOPE_CLASS}">
    <div class="fn__flex fn__flex-center" style="flex-wrap: wrap;">
        <a class="b3-button b3-button--outline fn__flex-center ariaLabel" href="${FINE_GRAINED_TOKEN_URL}" target="_blank" rel="noopener noreferrer" aria-label="${FINE_GRAINED_TOKEN_URL}" data-position="north">
            <svg><use xlink:href="#iconGithub"></use></svg>${plugin.i18n.gistTokenCreateFineGrained}
        </a>
        <div class="fn__space"></div>
        <a class="b3-button b3-button--outline fn__flex-center ariaLabel" href="${CLASSIC_TOKEN_URL}" target="_blank" rel="noopener noreferrer" aria-label="${CLASSIC_TOKEN_URL}" data-position="north">
            <svg><use xlink:href="#iconGithub"></use></svg>${plugin.i18n.gistTokenCreateClassic}
        </a>
    </div>
    <div class="b3-label__text fn__block" style="margin-top: 4px;">${plugin.i18n.gistTokenCreateHint}</div>
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

    const statusElement = container.querySelector("span[data-action='gistTokenStatus']") as HTMLElement;

    // 初始状态：会话缓存无明文时尝试从磁盘预热（幂等），随后按结果刷新状态文案
    const refreshStatus = (hasToken: boolean) => {
        statusElement.textContent = hasToken
            ? plugin.i18n.gistTokenStatusConfigured
            : plugin.i18n.gistTokenStatusNotConfigured;
    };
    void plugin.gistTokenService.loadToken().then(hasToken => {
        refreshStatus(hasToken || plugin.gistTokenService.hasToken);
    });

    return container;
}
