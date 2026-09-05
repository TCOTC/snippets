// services/gist-token.ts GistTokenService 与设置元素构建单测
// 覆盖：saveToken 加密落盘 + 会话缓存、loadToken（无密文静默/损坏提示/成功恢复）、
//       removeToken、clear、设置元素交互（保存/空输入/清除/初始状态刷新）。
// 加密底层经 siyuan-token-vault（PBKDF2 500k 迭代），用例数受限以免拖慢测试。
// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {showMessage} from "siyuan";
import type PluginSnippets from "../index";
import {buildGistTokenSettingElement, GistTokenService} from "./gist-token";

/** 内存存储插件替身（loadData 无文件返回空串，与思源语义一致） */
const setup = () => {
    const store = new Map<string, string>();
    const plugin = {
        displayName: "Snippets",
        i18n: {
            gistTokenEmpty: "请输入 Token",
            gistTokenOpenGithubButton: "打开创建页",
            gistTokenPlaceholder: "ghp_…",
            gistTokenSaveButton: "保存 Token",
            gistTokenClearButton: "清除 Token",
            gistTokenStatusConfigured: "已配置",
            gistTokenStatusNotConfigured: "未配置",
            gistTokenSaved: "Token 已保存",
            gistTokenRemoved: "Token 已清除",
            gistTokenSaveFailed: "保存失败",
            gistTokenRemoveFailed: "清除失败",
            gistTokenDecryptFailed: "解密失败",
        },
        loadData: vi.fn(async (name: string) => store.get(name) ?? ""),
        saveData: vi.fn(async (name: string, content: string) => {
            store.set(name, content);
        }),
        removeData: vi.fn(async (name: string) => {
            store.delete(name);
        }),
        showErrorMessage: vi.fn(),
    } as unknown as PluginSnippets;
    const service = new GistTokenService(plugin);
    // 设置元素构建函数经 plugin.gistTokenService 访问服务
    (plugin as any).gistTokenService = service;
    return {plugin, service, store};
};

/** 点击元素 */
const click = (element: HTMLElement) => {
    element.dispatchEvent(new MouseEvent("click", {bubbles: true}));
};

/** 等待异步链（加密/落盘/加载） */
const waitChain = () => new Promise<void>(resolve => setTimeout(resolve, 30));

describe("GistTokenService", () => {
    beforeEach(() => {
        // 设备特征种子桩（与单测环境一致即可，无需真实思源）
        (window as any).siyuan = {config: {system: {workspaceDir: "/test/workspace", id: "test-device", name: "Test", osPlatform: "test"}}};
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("saveToken 加密落盘且写入会话缓存", async () => {
        const {plugin, service, store} = setup();
        expect(await service.saveToken("ghp_secret")).toBe(true);
        expect(service.token).toBe("ghp_secret");
        expect(service.hasToken).toBe(true);
        // 落盘内容为密文，不含明文
        expect(store.size).toBe(1);
        const stored = [...store.values()][0];
        expect(stored).not.toContain("ghp_secret");
        expect(stored.startsWith("v1.")).toBe(true);
        expect(plugin.showErrorMessage).not.toHaveBeenCalled();
    });

    it("saveToken 空明文被 UI 层拦截（服务层仍拒绝）", async () => {
        const {service} = setup();
        // 底层库对空串抛错，服务层归一为失败提示
        expect(await service.saveToken("   ")).toBe(false);
    });

    it("loadToken 无密文时静默返回 false", async () => {
        const {service} = setup();
        expect(await service.loadToken()).toBe(false);
        expect(service.token).toBe("");
    });

    it("loadToken 成功恢复会话缓存", async () => {
        const {service} = setup();
        await service.saveToken("ghp_secret");
        service.clear();
        expect(service.hasToken).toBe(false);
        expect(await service.loadToken()).toBe(true);
        expect(service.token).toBe("ghp_secret");
    });

    it("loadToken 密文损坏时提示并返回 false", async () => {
        const {plugin, service, store} = setup();
        await service.saveToken("ghp_secret");
        // 篡改密文内容使解密失败
        const name = [...store.keys()][0];
        store.set(name, "v1.!!!.xx.yy");
        expect(await service.loadToken()).toBe(false);
        expect(plugin.showErrorMessage).toHaveBeenCalledWith(plugin.i18n.gistTokenDecryptFailed);
    });

    it("removeToken 删除密文并清空缓存", async () => {
        const {plugin, service, store} = setup();
        await service.saveToken("ghp_secret");
        expect(await service.removeToken()).toBe(true);
        expect(store.size).toBe(0);
        expect(service.hasToken).toBe(false);
        expect(plugin.showErrorMessage).not.toHaveBeenCalled();
    });

    it("保存失败（saveData reject）时提示且不缓存", async () => {
        const {plugin, service} = setup();
        (plugin.saveData as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("readonly"));
        expect(await service.saveToken("ghp_secret")).toBe(false);
        expect(plugin.showErrorMessage).toHaveBeenCalledWith(plugin.i18n.gistTokenSaveFailed);
        expect(service.hasToken).toBe(false);
    });

    it("clear 仅清会话缓存", async () => {
        const {service, store} = setup();
        await service.saveToken("ghp_secret");
        service.clear();
        expect(service.hasToken).toBe(false);
        expect(store.size).toBe(1);
    });
});

describe("buildGistTokenSettingElement", () => {
    beforeEach(() => {
        (window as any).siyuan = {config: {system: {workspaceDir: "/test/workspace", id: "test-device", name: "Test", osPlatform: "test"}}};
    });

    it("保存 Token：加密落盘 + 状态更新 + 成功提示", async () => {
        const {plugin, service, store} = setup();
        const element = buildGistTokenSettingElement(plugin);
        const input = element.querySelector("input[data-action='gistTokenInput']") as HTMLInputElement;
        const save = element.querySelector("span[data-action='gistTokenSave']") as HTMLElement;
        const status = element.querySelector("span[data-action='gistTokenStatus']") as HTMLElement;
        expect(element.querySelector("a[href='https://github.com/settings/tokens/new']")).not.toBeNull();
        expect(element.querySelector("svg[data-action='gistTokenTogglePassword']")).not.toBeNull();

        input.value = "ghp_secret";
        click(save);
        await vi.waitFor(() => expect(store.size).toBe(1));

        expect(service.hasToken).toBe(true);
        await vi.waitFor(() => expect(status.textContent).toBe(plugin.i18n.gistTokenStatusConfigured));
        expect(input.value).toBe("");
        expect(showMessage).toHaveBeenCalledWith(expect.stringContaining(plugin.i18n.gistTokenSaved), 3000, "info");
    });

    it("输入为空点保存：提示且不落盘", async () => {
        const {plugin, store} = setup();
        const element = buildGistTokenSettingElement(plugin);
        const save = element.querySelector("span[data-action='gistTokenSave']") as HTMLElement;
        click(save);
        await waitChain();
        expect(plugin.showErrorMessage).toHaveBeenCalledWith(plugin.i18n.gistTokenEmpty);
        expect(store.size).toBe(0);
    });

    it("清除 Token：删除密文 + 状态更新", async () => {
        const {plugin, service, store} = setup();
        const element = buildGistTokenSettingElement(plugin);
        const input = element.querySelector("input[data-action='gistTokenInput']") as HTMLInputElement;
        const save = element.querySelector("span[data-action='gistTokenSave']") as HTMLElement;
        const clear = element.querySelector("span[data-action='gistTokenClear']") as HTMLElement;
        const status = element.querySelector("span[data-action='gistTokenStatus']") as HTMLElement;
        // 先保存再清除
        input.value = "ghp_secret";
        click(save);
        await vi.waitFor(() => expect(service.hasToken).toBe(true));

        click(clear);
        await vi.waitFor(() => expect(store.size).toBe(0));
        expect(service.hasToken).toBe(false);
        await vi.waitFor(() => expect(status.textContent).toBe(plugin.i18n.gistTokenStatusNotConfigured));
    });

    it("构建时若磁盘已有密文则状态显示已配置", async () => {
        const {plugin, service} = setup();
        await service.saveToken("ghp_secret");
        service.clear();
        const element = buildGistTokenSettingElement(plugin);
        const status = element.querySelector("span[data-action='gistTokenStatus']") as HTMLElement;
        await vi.waitFor(() => expect(status.textContent).toBe(plugin.i18n.gistTokenStatusConfigured));
    });

    it("眼睛图标切换密码可见性", async () => {
        const {plugin} = setup();
        const element = buildGistTokenSettingElement(plugin);
        const input = element.querySelector("input[data-action='gistTokenInput']") as HTMLInputElement;
        const toggle = element.querySelector("svg[data-action='gistTokenTogglePassword']") as SVGElement;
        expect(input.type).toBe("password");
        click(toggle as unknown as HTMLElement);
        expect(input.type).toBe("text");
        click(toggle as unknown as HTMLElement);
        expect(input.type).toBe("password");
    });
});
