// config/config-service.ts ConfigService 单测
// 覆盖：init 的存储合并语义（存储值覆盖默认、按钮/未知键忽略）、reloadFromStorage 热应用
//       （值变化触发 onApply、同值幂等不触发）、saveFromDialog（控件读取、fileWatchPath
//       空回退、写入失败保持对话框）、disableNotification（键守卫、落盘）。
// siyuan 的 Setting/hideMessage 与 config-service 的 DOM 副作用经 mock/桩隔离，
// 只观测配置对象状态与桩调用，不触碰真实 DOM。
import {beforeEach, describe, expect, it, vi} from "vitest";
import {hideMessage} from "siyuan";
import type PluginSnippets from "../index";
import {SnippetsConfig} from "./config";
import {ConfigService, STORAGE_NAME} from "./config-service";

/**
 * 构造最小插件替身（覆盖 ConfigService 全部读取路径；
 * onApply 会触达的服务以 vi.fn 桩提供，避免副作用扩散）
 * @param stored 配置存储内容（等价于 plugin.data[STORAGE_NAME]）
 * @returns 插件替身
 */
const createFakePlugin = (stored: unknown = undefined) => {
    const savedContents: unknown[] = [];
    const plugin = {
        config: new SnippetsConfig(),
        data: {[STORAGE_NAME]: stored},
        isMobile: false,
        i18n: {},
        console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
        showErrorMessage: vi.fn(),
        loadData: vi.fn(async () => {}),
        saveData: vi.fn(async (_name: string, content: unknown) => {
            savedContents.push(content);
            return {code: 0};
        }),
        snippetsDialog: {closeByElement: vi.fn()},
        menuView: {
            menu: undefined,
            menuItems: undefined,
            genMenuSnippetsItems: vi.fn(),
            removeTopBarElement: vi.fn(),
            initTopBar: vi.fn(),
            setMenuPosition: vi.fn(),
            setMenuSnippetCount: vi.fn(),
        },
        fileWatchService: {
            start: vi.fn(),
            stop: vi.fn(),
            handlePathChange: vi.fn(),
            handleIntervalChange: vi.fn(),
        },
        editorManager: {updateAllEditorConfigs: vi.fn()},
    };
    return {plugin: plugin as unknown as PluginSnippets, savedContents};
};

describe("ConfigService", () => {
    let fake: ReturnType<typeof createFakePlugin>;
    let plugin: PluginSnippets;
    let service: ConfigService;
    /** saveData 收集到的落盘内容（最后一次） */
    let lastSaved: () => unknown;

    const initService = async (stored: unknown = undefined) => {
        fake = createFakePlugin(stored);
        plugin = fake.plugin;
        service = new ConfigService(plugin);
        await service.init();
    };

    const getConfig = (key: string): unknown => (plugin.config as unknown as Record<string, unknown>)[key];

    beforeEach(async () => {
        await initService();
        lastSaved = () => fake.savedContents[fake.savedContents.length - 1];
    });

    describe("init 存储合并", () => {
        it("无存储内容时配置全部保持字段默认值", async () => {
            const config = plugin.config;
            expect(config.realTimePreview).toBe(true);
            expect(config.consoleDebug).toBe(false);
            expect(config.snippetSortType).toBe("customSort");
            expect(config.fileWatchPath).toBe("data/snippets");
            expect(config.showDuplicateButton).toBe(false);
        });

        it("存储有值的键覆盖字段默认值", async () => {
            await initService({realTimePreview: false, consoleDebug: true, snippetSortType: "createdASC"});
            expect(plugin.config.realTimePreview).toBe(false);
            expect(plugin.config.consoleDebug).toBe(true);
            expect(plugin.config.snippetSortType).toBe("createdASC");
        });

        it("按钮类条目与未知键不写入 config 对象", async () => {
            await initService({exportSnippets: "ignored", bogusKey: 1});
            expect(getConfig("exportSnippets")).toBeUndefined();
            expect(getConfig("bogusKey")).toBeUndefined();
        });

        it("存储内容为非法类型时视为空配置", async () => {
            await initService("not-an-object");
            expect(plugin.config.realTimePreview).toBe(true);
        });

        it("init 后装配了设置对象并添加了设置项", async () => {
            expect(service.setting).toBeDefined();
            expect(service.setting?.addItem).toHaveBeenCalled();
        });
    });

    describe("reloadFromStorage 热应用", () => {
        it("存储值有变化时应用并触发对应 onApply 副作用", async () => {
            // showDuplicateButton 默认 false；onApply 会经 applySnippetButtonVisibility 查询菜单按钮
            const querySelectorAll = vi.fn(() => []);
            (plugin.menuView as unknown as {menuItems: unknown}).menuItems = {querySelectorAll};
            (fake.plugin.data as Record<string, unknown>)[STORAGE_NAME] = {showDuplicateButton: true};

            await service.reloadFromStorage();
            expect(plugin.config.showDuplicateButton).toBe(true);
            // setValue 内 await onApply，等待微任务完成
            await vi.waitFor(() => expect(querySelectorAll).toHaveBeenCalled());
        });

        it("同值重复应用幂等：值无变化时不触发 onApply", async () => {
            const querySelectorAll = vi.fn(() => []);
            (plugin.menuView as unknown as {menuItems: unknown}).menuItems = {querySelectorAll};
            (fake.plugin.data as Record<string, unknown>)[STORAGE_NAME] = {showDuplicateButton: true};

            await service.reloadFromStorage();
            await vi.waitFor(() => expect(querySelectorAll).toHaveBeenCalledTimes(1));

            // 再次以相同值热应用：diff 相同，不再触发 onApply
            await service.reloadFromStorage();
            await vi.waitFor(() => expect(querySelectorAll).toHaveBeenCalledTimes(1));
        });
    });

    describe("saveFromDialog 保存", () => {
        it("对话框无任何控件时只落盘并关闭对话框", async () => {
            const dialogElement = {querySelector: vi.fn(() => null)} as unknown as HTMLElement;
            await service.saveFromDialog(dialogElement);
            expect(fake.savedContents).toHaveLength(1);
            expect(plugin.snippetsDialog.closeByElement).toHaveBeenCalledWith(dialogElement);
        });

        it("读取 boolean 控件勾选值并写入", async () => {
            const querySelector = vi.fn((selector: string) =>
                selector === "input[data-type='consoleDebug']" ? {checked: true} : null
            );
            await service.saveFromDialog({querySelector} as unknown as HTMLElement);
            expect(plugin.config.consoleDebug).toBe(true);
            expect(lastSaved()).toMatchObject({consoleDebug: true});
        });

        it("fileWatchPath 输入为空时回退默认路径并触发路径变更", async () => {
            // 先让路径偏离默认值，才能观测到“回退写入”
            plugin.config.fileWatchPath = "data/custom";
            const querySelector = vi.fn((selector: string) =>
                selector === "input[data-type='fileWatchPath']" ? {value: ""} : null
            );
            await service.saveFromDialog({querySelector} as unknown as HTMLElement);
            expect(plugin.config.fileWatchPath).toBe("data/snippets");
            expect(plugin.fileWatchService.handlePathChange).toHaveBeenCalled();
            expect(lastSaved()).toMatchObject({fileWatchPath: "data/snippets"});
        });

        it("落盘失败时提示错误并保持对话框打开", async () => {
            (plugin.saveData as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({code: 403, msg: "denied"});
            const dialogElement = {querySelector: vi.fn(() => null)} as unknown as HTMLElement;
            await service.saveFromDialog(dialogElement);
            expect(plugin.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("[403: denied]"), 20000, "error");
            expect(plugin.snippetsDialog.closeByElement).not.toHaveBeenCalled();
        });
    });

    describe("disableNotification 通知禁用", () => {
        it("禁用有效布尔通知键并落盘", async () => {
            service.disableNotification("reloadUIAfterModifyJS");
            expect(plugin.config.reloadUIAfterModifyJSNotice).toBe(false);
            expect(hideMessage).toHaveBeenCalledWith("snippets-reloadUIAfterModifyJS");
            await vi.waitFor(() => expect(fake.savedContents).toHaveLength(1));
            expect(lastSaved()).toMatchObject({reloadUIAfterModifyJSNotice: false});
        });

        it("未知通知键记录告警且不落盘", async () => {
            service.disableNotification("bogus");
            expect(plugin.console.warn).toHaveBeenCalledWith(
                expect.stringContaining('Notification config item "bogusNotice" not found')
            );
            expect(fake.savedContents).toHaveLength(0);
        });
    });
});
