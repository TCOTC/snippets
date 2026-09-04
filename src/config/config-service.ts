// 插件配置的装配、持久化与热应用（原 index.ts 配置段外迁）
// 职责：配置读取与版本校验 → 缓存于服务内部镜像并挂到插件实例（defineProperty）→
// 构建 Setting 项；对话框保存（saveFromDialog）；配置热应用（applyConfig，onDataChanged 同源）；
// 通知禁用持久化（disableNotification）。
// 简洁化：不设 Host——直接持有 PluginSnippets 实例（import type 避免运行时循环依赖），
// 配置文件读写经插件生命周期方法（loadData/saveData/removeData）与本模块自持的存储键名。
// jcsm 收敛（阶段 6）：配置镜像原存储于 window.siyuan.jcsm（(jcsm as any)[key]，跨插件 reload 存活），
// 因配置每次 init 都会从磁盘重新加载且写配置即落盘，镜像改由本服务内部缓存承载，不再占用 jcsm 全局仓库。
import {hideMessage, Setting} from "siyuan";
import {htmlToElement, isPromiseFulfilled} from "../utils";
import type PluginSnippets from "../index";
import type {SnippetsConfigItem} from "./schema";
import type {SettingItem} from "../types";

const PLUGIN_NAME = "snippets";                    // 插件名（通知消息 id 前缀用）
export const STORAGE_NAME = "plugin-config.json";  // 配置文件名（index 侧 removeData 亦使用）

/**
 * 配置服务（原 index.ts 中对应私有方法外迁，行为等价）
 */
export class ConfigService {
    private readonly plugin: PluginSnippets;

    /**
     * 配置镜像缓存：defineProperty 到插件实例的属性代理本缓存（原存储于 window.siyuan.jcsm）
     * 配置已落盘且 init 每次从磁盘重新加载，reload 后新实例 init 即重建本缓存，无需跨 reload 全局仓库。
     */
    private readonly configValues = new Map<string, any>();

    /**
     * 插件设置对象（仅 init 通过版本校验后创建并填充；失败时保持未初始化）
     */
    private settingInstance: Setting | undefined;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 插件设置对象（init 通过版本校验后才可用）
     */
    get setting(): Setting | undefined {
        return this.settingInstance;
    }

    /**
     * 拉取最新配置文件并返回其内容（loadData 同步插件 data，无文件时为空串）
     */
    private async loadStoredConfig(): Promise<any> {
        await this.plugin.loadData(STORAGE_NAME);
        return this.plugin.data[STORAGE_NAME];
    }

    /**
     * 删除配置文件（版本异常时调用）
     */
    private async removeStoredConfig(): Promise<void> {
        await this.plugin.removeData(STORAGE_NAME);
    }

    /**
     * 写入配置文件
     */
    private async saveStoredConfig(content: any): Promise<void> {
        await this.plugin.saveData(STORAGE_NAME, content);
    }

    /**
     * 读取配置项当前值（定义于配置项 key，缓存于本服务内部镜像）
     */
    private readValue(key: string): any {
        return this.configValues.get(key);
    }

    /**
     * 写入配置项到内部镜像
     */
    private writeValue(key: string, value: any) {
        this.configValues.set(key, value);
    }

    /**
     * 应用单个配置项的 UI 副作用（查 configItems 对应条目的 onApply）
     */
    private async apply(key: string, newValue: any) {
        const configItem = this.plugin.configItems.find(item => item.key === key);
        if (configItem?.onApply) {
            await configItem.onApply(newValue);
        }
    }

    /**
     * 初始化插件设置（原 index.ts initSetting + loadConfig 外迁，行为等价）
     * 加载配置文件 → 版本校验（异常移除配置/高版本提示后中止）→ 写默认值 → 挂载实例属性 → 装配 Setting
     */
    public async init() {
        // TODO测试: 需要测试会不会在同步完成之前加载数据，然后同步修改数据之后插件没有重载。如果有这种情况的话提 issue、试试把 loadData() 和 this.setting 相关的逻辑放在 onLayoutReady 中有没有问题
        const config = await this.loadStoredConfig();
        // 配置不存在时 config === ""
        if (config !== "") {
            // 版本处理
            if (!config.version || typeof config.version !== "number" || isNaN(config.version)) {
                // 判断 config.version 是否不存在或不是数字
                // 配置文件异常，移除配置文件、弹出错误消息
                await this.removeStoredConfig();
                this.plugin.showErrorMessage(this.plugin.i18n.loadConfigError);
            } else if (config.version > this.plugin.version) {
                // 当前配置文件是更高版本的，与当前版本不兼容，弹出消息提示用户升级插件（可以不升级）
                // 如果用户不升级插件，还保存了设置，则直接覆盖掉高版本配置，这样也没有问题，因为高版本加载的时候又会自动调整配置结构
                this.plugin.showErrorMessage(this.plugin.i18n.loadConfigIncompatible, 15000);
                return;
            }
            // else if (config.version < this.version) {
            //     // 预留逻辑
            //     // 当前配置文件是更低版本的，需要调整结构
            //     this.updateConfig(config);
            //     return
            // }
        }

        // 读取配置或者设置默认值
        await this.plugin.initConfigItems();
        this.plugin.configItems.forEach(item => {
            // 缓存配置（缺失时用默认值），供 defineProperty 代理读取
            this.writeValue(item.key, config[item.key] ?? item.defaultValue);
        });

        // 为每个配置项在插件实例上动态生成 getter/setter（代理到内部配置镜像）
        const target = this.plugin;
        this.plugin.configItems.forEach(item => {
            Object.defineProperty(target, item.key, {
                get: () => this.readValue(item.key) ?? item.defaultValue,
                set: (value: any) => this.writeValue(item.key, value),
                enumerable: true,
                configurable: true
            });
        });

        this.settingInstance = new Setting({});

        // 插件设置窗口中的各个配置项
        this.plugin.configItems.forEach(item => {
            if (item.ignore) return;
            this.settingInstance!.addItem(this.createSettingItem(item));
        });
    }

    /**
     * 从对话框元素读取控件值并保存（原 index.ts saveSetting 外迁，行为等价）
     * @param dialogElement 对话框元素
     */
    public saveFromDialog(dialogElement: HTMLElement) {
        this.plugin.configItems.forEach(async item => {
            let newValue;
            let element: HTMLInputElement | HTMLSelectElement | null = null;

            switch (item.type) {
                case "boolean":
                    element = dialogElement.querySelector(`input[data-type='${item.key}']`);
                    if (!element) return;
                    newValue = (element as HTMLInputElement).checked;
                    break;
                case "selectString":
                case "selectNumber":
                    element = dialogElement.querySelector(`select[data-type='${item.key}']`);
                    if (!element) return;
                    newValue = item.type === "selectNumber" ? parseInt((element as HTMLSelectElement).value) : (element as HTMLSelectElement).value;
                    break;
                case "string":
                    element = dialogElement.querySelector(`input[data-type='${item.key}']`);
                    if (!element) return;
                    newValue = (element as HTMLInputElement).value;
                    // fileWatchPath 特殊校验，不允许为空或只有空字符
                    if (item.key === "fileWatchPath" && (!newValue || newValue.trim() === "")) {
                        newValue = "data/snippets";
                        // 重置输入框的值（目前没什么用，因为保存设置之后对话框就关闭了。不过以后有可能有用）
                        // element.value = newValue;
                    }
                    break;
                case "number":
                    element = dialogElement.querySelector(`input[data-type='${item.key}']`);
                    if (!element) return;
                    newValue = parseInt((element as HTMLInputElement).value) || item.defaultValue || 0;
                    break;
            }

            if (this.readValue(item.key) !== newValue) {
                this.writeValue(item.key, newValue);
                this.apply(item.key, newValue).then();
            }
        });

        const saveResponse = this.persistConfig();
        if (!isPromiseFulfilled(saveResponse)) {
            // 写入失败
            const response = saveResponse as any;
            this.plugin.showErrorMessage(this.plugin.i18n.saveConfigFailed + " [" + response?.code + ": " + response?.msg + "]", 20000, "error");
            return;
        }

        // 移除设置对话框
        this.plugin.snippetsDialog.closeByElement(dialogElement);
    }

    /**
     * 应用配置（本地读取或跨窗口/跨设备同步后的统一入口，按值 diff 幂等）
     * @param config 配置对象
     */
    public applyConfig(config: any) {
        if (!config || typeof config !== "object") {
            return;
        }
        // 逐个配置项与当前值比较，有变化时写入并触发对应 UI 更新
        this.plugin.configItems.forEach(item => {
            if (config.hasOwnProperty(item.key)) {
                const newValue = config[item.key];
                if (this.readValue(item.key) !== newValue) {
                    this.writeValue(item.key, newValue);
                    this.apply(item.key, newValue);
                }
            }
        });
    }

    /**
     * 重新读取配置并热应用（原 index.ts onDataChanged 方法体外迁）
     */
    public async reloadFromStorage() {
        // 重新读取配置：loadData 会从内核拉取最新文件并更新插件 data
        const config = await this.loadStoredConfig();
        this.applyConfig(config);
    }

    /**
     * 禁用指定通知并持久化（原 index.ts disableNotification 外迁，行为等价）
     * @param messageI18nKey 通知的 i18n 键
     */
    public disableNotification(messageI18nKey: string) {
        // 移除消息提示
        hideMessage(PLUGIN_NAME + "-" + messageI18nKey);

        // 通知的配置键名
        const noticeConfigKey = messageI18nKey + "Notice";

        // 检查通知键是否存在于配置项中
        const configItem = this.plugin.configItems.find(item => item.key === noticeConfigKey);
        if (!configItem) {
            this.plugin.console.warn(`ignoreNotice: Notification config item "${noticeConfigKey}" not found`);
            return;
        }

        // 检查是否为布尔类型的通知配置
        if (configItem.type !== "boolean") {
            this.plugin.console.warn(`ignoreNotice: Notification config item "${noticeConfigKey}" is not boolean type`);
            return;
        }

        // 禁用通知
        this.writeValue(noticeConfigKey, false);

        // 保存设置到配置文件
        void this.persistConfig();

        this.plugin.console.log(`ignoreNotice: Notification "${noticeConfigKey}" has been disabled and settings saved`);
    }

    /**
     * 将内部配置镜像中的全部配置项收集为配置对象并写入文件
     * @returns saveData 的返回（调用方用 isPromiseFulfilled 判断是否成功）
     */
    private persistConfig(): any {
        const config: any = { version: this.plugin.version };
        this.plugin.configItems.forEach(item => {
            config[item.key] = this.readValue(item.key);
        });
        return this.saveStoredConfig(config);
    }

    /**
     * 创建设置项（原 index.ts createSettingItem 外迁，行为等价）
     * @param item 配置项
     * @returns 设置项
     */
    private createSettingItem(item: SnippetsConfigItem): SettingItem {
        if (!item.direction) {
            item.direction = "column";
            // 或者也可以根据类型设置默认方向，但是目前不需要
        }

        return {
            title: (this.plugin.i18n as any)[item.key],
            description: item.description ? (this.plugin.i18n as any)[item.description] : undefined,
            direction: item.direction,
            createActionElement: () => {
                if (item.type === "boolean") {
                    return htmlToElement(
                        `<input class="b3-switch fn__flex-center" type="checkbox" data-type="${item.key}"${this.readValue(item.key) ? " checked" : ""}>`
                    );
                } else if ((item.type === "selectString" || item.type === "selectNumber") && item.options) {
                    // 创建下拉框
                    const currentValue = this.readValue(item.key) ?? item.defaultValue;
                    const optionsHtml = item.options.map(option => {
                        // 由于 HTML 的 value 属性最终都会被转为字符串，这里直接用字符串比较即可
                        const isSelected = String(currentValue) === String(option.value);
                        return `<option value="${option.value}"${isSelected ? " selected" : ""}>${(this.plugin.i18n as any)[option.text]}</option>`;
                    }).join("");

                    return htmlToElement(
                        `<select class="b3-select fn__flex-center" data-type="${item.key}">${optionsHtml}</select>`
                    );
                } else if (item.type === "string") {
                    // 创建文本输入框
                    const currentValue = this.readValue(item.key) ?? item.defaultValue ?? "";
                    return htmlToElement(
                        `<input class="b3-text-field fn__flex-center" type="text" data-type="${item.key}" value="${currentValue}"${item.defaultValue ? ` placeholder="${item.defaultValue}"` : ""}>`
                    );
                } else if (item.type === "number") {
                    // 创建数字输入框
                    const currentValue = this.readValue(item.key) ?? item.defaultValue ?? 0;
                    return htmlToElement(
                        `<input class="b3-text-field fn__flex-center" type="number" data-type="${item.key}" value="${currentValue}" min="1" max="300" step="1"${item.defaultValue ? ` placeholder="${item.defaultValue}"` : ""}>`
                    );
                } else if (item.type === "createActionElement" || item.createActionElement) {
                    return item.createActionElement?.() as HTMLElement;
                }
                // 理论不可达：configItems 的类型均已在上方处理，返回 undefined 以保持原运行时行为
                return undefined as unknown as HTMLElement;
            },
        };
    }
}
