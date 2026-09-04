// 插件配置：声明式配置项定义 + 装配、持久化与热应用
// 本模块统一承载：配置项类型与条目构建（SnippetsConfigItem/SnippetsConfigContext/createSnippetsConfigItems，
// 条目经 ctx 读取器/动作函数实时转发插件运行态）、ConfigService（配置读取与版本校验 → 逐项写入插件实例
// 字段 → 构建 Setting 项；对话框保存 saveFromDialog；配置热应用 applyConfig（onDataChanged 同源）；
// 通知禁用持久化 disableNotification）。
// 配置值存于插件实例同名字段（配置每次 init 从磁盘重新加载、写配置即落盘，无需外部全局仓库）；
// 配置文件读写经插件生命周期方法（loadData/saveData/removeData）与本模块自持的存储键名。
import {hideMessage, Setting} from "siyuan";
import {htmlToElement, isPromiseFulfilled} from "../utils";
import type PluginSnippets from "../index";
import type {SettingItem} from "../types";

/**
 * 配置项下拉选项
 */
export interface SnippetsConfigOption {
    value: string | number;
    text: string;
}

/**
 * 构建配置项时所需的插件运行态上下文
 * 以读取器/动作函数形式提供，由调用方用箭头函数闭包捕获插件实例（避免 no-this-alias）；
 * 注意：条目构建时的静态属性值（ignore/description 等）在构建时刻调用读取器求值；
 * 条目内箭头函数体（createActionElement/onApply）中的读取器/动作则在函数被调用时才执行，
 * 因此菜单容器等运行态引用能拿到实时值，不会停留在构建时刻的快照。
 */
export interface SnippetsConfigContext {
    /** 读取：是否移动端 */
    readonly isMobile: () => boolean;
    /** 读取：插件 i18n 文案 */
    readonly i18n: () => any;
    /** 读取：顶栏菜单列表容器（可能尚未打开） */
    readonly menuItems: () => HTMLElement | undefined;
    /** 读取：顶栏菜单是否打开（菜单关闭后 menuItems 仍引用已脱离文档的节点，不可据此判断） */
    readonly menuOpen: () => boolean;
    /** 读取：按当前排序规则生成的代码片段列表 HTML（用于菜单项重渲染） */
    readonly menuSnippetsItemsHtml: () => string;
    /** 动作：更新所有已打开的编辑器对话框中的编辑器配置 */
    readonly updateAllEditorConfigs: (reason: string) => void;
    /** 动作：移除顶栏按钮 */
    readonly removeTopBarElement: () => void;
    /** 动作：重建顶栏按钮（含快捷键提示标题） */
    readonly initTopBar: () => Promise<void>;
    /** 动作：定位或更新已打开顶栏菜单的位置 */
    readonly setMenuPosition: (isUpdate?: boolean) => void;
    /** 动作：启动/停止文件监听 */
    readonly startFileWatch: () => void;
    readonly stopFileWatch: () => void;
    /** 动作：文件监听路径变更后的重载处理（内部会按当前监听模式判断是否可执行） */
    readonly handleFileWatchPathChange: () => void;
    /** 动作：文件监听间隔变更后的定时器重置 */
    readonly handleFileWatchIntervalChange: () => void;
}

/**
 * 配置项定义（configItems 元素的类型定义）
 */
export interface SnippetsConfigItem {
    key: string;
    description?: string;
    type?: "boolean" | "string" | "number" | "selectString" | "selectNumber" | "createActionElement";
    defaultValue?: any;
    direction?: "row" | "column";
    createActionElement?: () => HTMLElement;
    options?: SnippetsConfigOption[];
    ignore?: boolean;
    /** 应用该配置项时的 UI 副作用 */
    onApply?: (newValue: any) => void | Promise<void>;
}


const PLUGIN_NAME = "snippets";                    // 插件名（通知消息 id 前缀用）
export const STORAGE_NAME = "plugin-config.json";  // 配置文件名（index 侧 removeData 亦使用）

/**
 * 当前插件配置结构版本（配置结构有变化时升级）
 */
const CONFIG_VERSION = 1;

/**
 * 配置服务
 */
export class ConfigService {
    private readonly plugin: PluginSnippets;

    /**
     * 配置项定义（条目构建见本模块 createSnippetsConfigItems，init 时构建一次）
     */
    private configItems: SnippetsConfigItem[] = [];

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
     * 读取配置项当前值（存于插件实例对应字段，键与 configItems 条目 key 一致）
     */
    private read(key: string): any {
        return (this.plugin as any)[key];
    }

    /**
     * 写配置项到插件实例对应字段
     */
    private write(key: string, value: any) {
        (this.plugin as any)[key] = value;
    }

    /**
     * 应用单个配置项的 UI 副作用（查 configItems 对应条目的 onApply）
     */
    private async apply(key: string, newValue: any) {
        const configItem = this.configItems.find(item => item.key === key);
        if (configItem?.onApply) {
            await configItem.onApply(newValue);
        }
    }

    /**
     * 构建配置项（条目定义见本模块 createSnippetsConfigItems；仅构建一次并复用，
     * 构建结果与运行态无关，运行态由 ctx 读取器/动作函数实时转发到插件实例）
     * 注意：构建时不使用 this.plugin.console 之类的方法——它们需配置加载完成后才可用
     */
    private initConfigItems() {
        if (this.configItems.length > 0) {
            return;
        }
        this.configItems = createSnippetsConfigItems({
            isMobile: () => this.plugin.isMobile,
            i18n: () => this.plugin.i18n,
            menuItems: () => this.plugin.menuView.menuItems,
            menuOpen: () => !!this.plugin.menuView.menu,
            menuSnippetsItemsHtml: () => this.plugin.menuView.genMenuSnippetsItems(),
            updateAllEditorConfigs: (reason) => this.plugin.editorManager.updateAllEditorConfigs(reason),
            removeTopBarElement: () => this.plugin.menuView.removeTopBarElement(),
            initTopBar: () => this.plugin.menuView.initTopBar(),
            setMenuPosition: (isUpdate) => this.plugin.menuView.setMenuPosition(isUpdate),
            startFileWatch: () => this.plugin.fileWatchService.start(),
            stopFileWatch: () => this.plugin.fileWatchService.stop(),
            handleFileWatchPathChange: () => void this.plugin.fileWatchService.handlePathChange(),
            handleFileWatchIntervalChange: () => this.plugin.fileWatchService.handleIntervalChange(),
        });
    }

    /**
     * 初始化插件设置
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
            } else if (config.version > CONFIG_VERSION) {
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
        this.initConfigItems();
        this.configItems.forEach(item => {
            // 写配置到实例字段（缺失时用默认值；无默认值的按钮类条目写 undefined，不参与持久化）
            this.write(item.key, config[item.key] ?? item.defaultValue);
        });

        this.settingInstance = new Setting({});

        // 插件设置窗口中的各个配置项
        this.configItems.forEach(item => {
            if (item.ignore) return;
            this.settingInstance!.addItem(this.createSettingItem(item));
        });
    }

    /**
     * 从对话框元素读取控件值并保存（值有变化时写入并应用对应 UI 副作用）
     * @param dialogElement 对话框元素
     */
    public saveFromDialog(dialogElement: HTMLElement) {
        this.configItems.forEach(async item => {
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

            if (this.read(item.key) !== newValue) {
                this.write(item.key, newValue);
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
        this.configItems.forEach(item => {
            if (config.hasOwnProperty(item.key)) {
                const newValue = config[item.key];
                if (this.read(item.key) !== newValue) {
                    this.write(item.key, newValue);
                    this.apply(item.key, newValue);
                }
            }
        });
    }

    /**
     * 重新读取配置并热应用（本地读取与跨窗口/跨设备同步推送的共用入口）
     */
    public async reloadFromStorage() {
        // 重新读取配置：loadData 会从内核拉取最新文件并更新插件 data
        const config = await this.loadStoredConfig();
        this.applyConfig(config);
    }

    /**
     * 禁用指定通知并持久化
     * @param messageI18nKey 通知的 i18n 键
     */
    public disableNotification(messageI18nKey: string) {
        // 移除消息提示
        hideMessage(PLUGIN_NAME + "-" + messageI18nKey);

        // 通知的配置键名
        const noticeConfigKey = messageI18nKey + "Notice";

        // 检查通知键是否存在于配置项中
        const configItem = this.configItems.find(item => item.key === noticeConfigKey);
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
        this.write(noticeConfigKey, false);

        // 保存设置到配置文件
        void this.persistConfig();

        this.plugin.console.log(`ignoreNotice: Notification "${noticeConfigKey}" has been disabled and settings saved`);
    }

    /**
     * 将全部配置项收集为配置对象并写入文件
     * @returns saveData 的返回（调用方用 isPromiseFulfilled 判断是否成功）
     */
    private persistConfig(): any {
        const config: any = { version: CONFIG_VERSION };
        this.configItems.forEach(item => {
            config[item.key] = this.read(item.key);
        });
        return this.saveStoredConfig(config);
    }

    /**
     * 创建设置项
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
                        `<input class="b3-switch fn__flex-center" type="checkbox" data-type="${item.key}"${this.read(item.key) ? " checked" : ""}>`
                    );
                } else if ((item.type === "selectString" || item.type === "selectNumber") && item.options) {
                    // 创建下拉框
                    const currentValue = this.read(item.key) ?? item.defaultValue;
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
                    const currentValue = this.read(item.key) ?? item.defaultValue ?? "";
                    return htmlToElement(
                        `<input class="b3-text-field fn__flex-center" type="text" data-type="${item.key}" value="${currentValue}"${item.defaultValue ? ` placeholder="${item.defaultValue}"` : ""}>`
                    );
                } else if (item.type === "number") {
                    // 创建数字输入框
                    const currentValue = this.read(item.key) ?? item.defaultValue ?? 0;
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

/**
 * 构建全部配置项
 * 求值时机：ignore/description 等属性值在构建时刻求值，
 * 箭头函数体内的 ctx 读取器/动作在调用时才执行（由调用方以箭头函数实时转发到插件实例）。
 * @param ctx 配置项构建上下文（见 SnippetsConfigContext）
 * @returns 配置项数组
 */
export const createSnippetsConfigItems = (ctx: SnippetsConfigContext): SnippetsConfigItem[] => [
    {
        key: "openNativeSnippets",
        description: "openNativeSnippetsDescription",
        type: "createActionElement",
        createActionElement: () => {
            return htmlToElement(
                `<span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="settingsSnippets"><svg><use xlink:href="#iconJcsm"></use></svg>${ctx.i18n().openNativeSnippetsWindow}</span>`
            );
        },
        ignore: ctx.isMobile(),
    },
    {
        key: "multipleSnippetEditors",
        description: "multipleSnippetEditorsDescription",
        type: "boolean",
        defaultValue: true,
        ignore: ctx.isMobile(),
    },
    {
        key: "realTimePreview",
        description: "realTimePreviewDescription",
        type: "boolean",
        defaultValue: true,
        // 修改 realTimePreview 之后，显示/隐藏已打开 CSS 编辑对话框中的手动预览按钮
        // （启用实时预览时由输入事件驱动预览，手动按钮隐藏；禁用后恢复手动按钮）
        onApply: (newValue) => {
            const cssDialogs = document.querySelectorAll(".b3-dialog--open[data-key='jcsm-snippet-dialog'][data-snippet-type='css']");
            if (newValue === true) {
                cssDialogs.forEach(cssDialog => {
                    const previewButton = cssDialog.querySelector("button[data-action='preview']") as HTMLButtonElement;
                    if (previewButton) {
                        previewButton.classList.add("fn__none");
                    }
                    // 已打开的 CSS 对话框立即按实时预览刷新一次（keydown 监听器按 detail 识别该请求）
                    cssDialog.dispatchEvent(new CustomEvent("keydown", {detail: "realTimePreview"}));
                });
            } else {
                cssDialogs.forEach(cssDialog => {
                    const previewButton = cssDialog.querySelector("button[data-action='preview']") as HTMLButtonElement;
                    if (previewButton) {
                        previewButton.classList.remove("fn__none");
                    }
                });
            }
        },
    },
    {
        key: "autoReloadUIAfterModifyJS",
        description: "autoReloadUIAfterModifyJSDescription",
        type: "boolean",
        defaultValue: true,
    },
    {
        key: "newSnippetEnabled",
        type: "boolean",
        defaultValue: true,
    },
    {
        key: "showDuplicateButton",
        description: "showDuplicateButtonDescription",
        type: "boolean",
        defaultValue: false,
        // 修改 showDuplicateButton 之后，查询所有菜单项修改创建副本按钮的 fn__none
        onApply: (newValue) => {
            const duplicateButtons = ctx.menuItems()?.querySelectorAll(".jcsm-snippet-item button[data-type='duplicate']") as NodeListOf<HTMLButtonElement>;
            duplicateButtons.forEach(duplicateButton => {
                if (newValue) {
                    duplicateButton.classList.remove("fn__none");
                } else {
                    duplicateButton.classList.add("fn__none");
                }
            });
        },
    },
    {
        key: "showDeleteButton",
        description: "showDeleteButtonDescription",
        type: "boolean",
        defaultValue: true,
        // 修改 showDeleteButton 之后，查询所有菜单项修改删除按钮的 fn__none
        onApply: (newValue) => {
            const deleteButtons = ctx.menuItems()?.querySelectorAll(".jcsm-snippet-item button[data-type='delete']") as NodeListOf<HTMLButtonElement>;
            deleteButtons.forEach(deleteButton => {
                if (newValue) {
                    deleteButton.classList.remove("fn__none");
                } else {
                    deleteButton.classList.add("fn__none");
                }
            });
        },
    },
    {
        key: "showEditButton",
        description: "showEditButtonDescription",
        type: "boolean",
        defaultValue: true,
        // 修改 showEditButton 之后，查询所有菜单项修改编辑按钮的 fn__none
        onApply: (newValue) => {
            const editButtons = ctx.menuItems()?.querySelectorAll(".jcsm-snippet-item button[data-type='edit']") as NodeListOf<HTMLButtonElement>;
            editButtons.forEach(editButton => {
                if (newValue) {
                    editButton.classList.remove("fn__none");
                } else {
                    editButton.classList.add("fn__none");
                }
            });
        },
    },
    {
        key: "showPublishCheckbox",
        description: "showPublishCheckboxDescription",
        type: "selectNumber",
        defaultValue: 0,
        options: [
            { value: 0, text: "showPublishCheckboxWithPublish" },
            { value: 1, text: "showPublishCheckboxShowAlways" },
            { value: 2, text: "showPublishCheckboxHideAlways" }
        ],
        // 修改 showPublishCheckbox 之后，显示/隐藏菜单与代码片段编辑对话框中的发布开关
        // （显示条件与菜单项生成时一致：跟随发布服务开关或总是显示）
        onApply: (newValue) => {
            const show = newValue === 0 ? window.siyuan.config!.publish.enable === true : newValue === 1;
            const publishSwitchInputs = document.querySelectorAll(".jcsm-snippets-container .jcsm-snippet-item input[data-type='publishSwitch'], .b3-dialog--open[data-key='jcsm-snippet-dialog'] input[data-type='publishSwitch']");
            if (show) {
                publishSwitchInputs.forEach(input => {
                    input.classList.remove("fn__none");
                });
            } else {
                publishSwitchInputs.forEach(input => {
                    input.classList.add("fn__none");
                });
            }
        },
    },
    {
        key: "defaultSnippetsType",
        description: "defaultSnippetsTypeDescription",
        type: "selectString",
        defaultValue: "css",
        options: [
            { value: "css", text: "defaultSnippetsTypeCSS" },
            { value: "js", text: "defaultSnippetsTypeJS" }
        ],
    },
    {
        key: "snippetOptionClickBehavior",
        description: "snippetOptionClickBehaviorDescription",
        type: "selectNumber",
        defaultValue: 1,
        options: [
            { value: 0, text: "snippetOptionClickBehaviorNone" },
            { value: 1, text: "snippetOptionClickBehaviorToggle" },
            { value: 2, text: "snippetOptionClickBehaviorOpenEditor" }
        ],
    },
    {
        key: "snippetSortType",
        description: "snippetSortTypeDescription",
        type: "selectString",
        defaultValue: "customSort",
        options: [
            { value: "fixedSort", text: "fixedSort" },             // 固定排序
            { value: "customSort", text: "customSort" },           // 自定义排序
            { value: "enabledASC", text: "enabledASC" },           // 已开启优先
            { value: "enabledDESC", text: "enabledDESC" },         // 未开启优先
            { value: "fileNameASC", text: "fileNameASC" },         // 名称字母升序
            { value: "fileNameDESC", text: "fileNameDESC" },       // 名称字母降序
            { value: "fileNameNatASC", text: "fileNameNatASC" },   // 名称自然升序
            { value: "fileNameNatDESC", text: "fileNameNatDESC" }, // 名称自然降序
            { value: "createdASC", text: "createdASC" },           // 创建时间升序
            { value: "createdDESC", text: "createdDESC" }          // 创建时间降序
        ],
        // 修改 snippetSortType 之后，按新排序重新生成菜单中的片段项（仅菜单已打开时需要）
        onApply: () => {
            if (!ctx.menuOpen()) return;
            const snippetsContainer = ctx.menuItems()?.querySelector(".jcsm-snippets-container");
            if (!snippetsContainer) return;
            const snippetsItems = ctx.menuSnippetsItemsHtml();
            snippetsContainer.querySelectorAll(".jcsm-snippet-item:is([data-type='js'], [data-type='css'])").forEach(item => {
                item.remove();
            });
            snippetsContainer.insertAdjacentHTML("afterbegin", snippetsItems);
        },
    },
    {
        key: "snippetSearchType",
        description: "snippetSearchTypeDescription",
        type: "selectNumber",
        defaultValue: 1,
        options: [
            { value: 0, text: "snippetSearchTypeDisabled" },
            { value: 1, text: "snippetSearchTypeName" },
            { value: 2, text: "snippetSearchTypeContent" },
            { value: 3, text: "snippetSearchTypeNameAndContent" }
        ],
        // 修改 snippetSearchType 之后，显示/隐藏菜单中的搜索按钮与搜索输入框
        onApply: (newValue) => {
            if (newValue === 0) {
                const searchButton = ctx.menuItems()?.querySelector(".jcsm-top-container button[data-type='search']") as HTMLButtonElement;
                if (searchButton) {
                    searchButton.classList.add("fn__none");
                    searchButton.classList.remove("jcsm-active");
                }
                const searchInput = ctx.menuItems()?.querySelector("input[data-action='search']") as HTMLInputElement;
                if (searchInput) {
                    searchInput.classList.add("fn__none");
                    searchInput.value = "";
                    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
                }
            } else {
                ctx.menuItems()?.querySelector(".jcsm-top-container button[data-type='search']")?.classList.remove("fn__none");
            }
        },
    },
    {
        key: "editorIndentUnit",
        description: "editorIndentUnitDescription",
        type: "selectString",
        defaultValue: "followSiyuan",
        options: [
            { value: "followSiyuan", text: "editorIndentUnitFollowSiyuan" },
            { value: "tab1", text: "editorIndentUnitTab1" },
            { value: "tab2", text: "editorIndentUnitTab2" },
            { value: "space1", text: "editorIndentUnitSpace1" },
            { value: "space2", text: "editorIndentUnitSpace2" },
            { value: "space3", text: "editorIndentUnitSpace3" },
            { value: "space4", text: "editorIndentUnitSpace4" },
            { value: "space5", text: "editorIndentUnitSpace5" },
            { value: "space6", text: "editorIndentUnitSpace6" },
            { value: "space7", text: "editorIndentUnitSpace7" },
            { value: "space8", text: "editorIndentUnitSpace8" }
        ],
        // 修改编辑器缩进单位后，更新所有已打开的编辑器
        onApply: () => ctx.updateAllEditorConfigs("indent unit"),
    },
    {
        key: "fileWatchEnabled",
        description: "fileWatchEnabledDescription",
        type: "selectString",
        defaultValue: "disabled",
        options: [
            { value: "disabled", text: "fileWatchModeDisabled" },
            { value: "enabled", text: "fileWatchModeEnabled" },
            { value: "loadOnly", text: "fileWatchModeLoadOnly" }
        ],
        // 修改 fileWatchEnabled 之后，按新模式启动或停止文件监听
        onApply: (newValue) => {
            if (newValue === "disabled") {
                ctx.stopFileWatch();
            } else {
                ctx.startFileWatch();
            }
        },
    },
    {
        key: "fileWatchPath",
        description: "fileWatchPathDescription",
        type: "string",
        defaultValue: "data/snippets",
        // 修改 fileWatchPath 之后，重载监听文件（方法内部会按当前监听模式判断是否可执行）
        onApply: () => ctx.handleFileWatchPathChange(),
    },
    {
        key: "fileWatchInterval",
        description: "fileWatchIntervalDescription",
        type: "number",
        defaultValue: 5,
        // 修改 fileWatchInterval 之后，按新间隔重置监听定时器
        onApply: () => ctx.handleFileWatchIntervalChange(),
    },
    {
        key: "topBarPosition",
        description: "topBarPositionDescription",
        type: "selectString",
        defaultValue: "right",
        options: [
            { value: "left", text: "topBarPositionLeft" },
            { value: "right", text: "topBarPositionRight" }
        ],
        ignore: ctx.isMobile(),
        // 修改 topBarPosition 之后，移除并重建顶栏按钮；菜单已打开时按新位置重排
        onApply: async () => {
            ctx.removeTopBarElement();
            await ctx.initTopBar();
            if (ctx.menuOpen()) {
                ctx.setMenuPosition(true);
            }
        },
    },
    {
        key: "exportSnippets",
        description: "exportSnippetsDescription",
        type: "createActionElement",
        createActionElement: () => {
            return htmlToElement(
                `<span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="exportSnippets"><svg><use xlink:href="#iconUpload"></use></svg>${ctx.i18n().export}</span>`
            );
        },
    },
    {
        key: "importSnippetsWithAppend",
        description: "importSnippetsWithAppendDescription",
        type: "createActionElement",
        createActionElement: () => {
            return htmlToElement(
                `<span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="importSnippetsWithAppend"><svg><use xlink:href="#iconDownload"></use></svg>${ctx.i18n().importWithAppend}</span>`
            );
        },
    },
    {
        key: "importSnippetsWithOverwrite",
        description: "importSnippetsWithOverwriteDescription",
        type: "createActionElement",
        createActionElement: () => {
            return htmlToElement(
                `<span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="importSnippetsWithOverwrite"><svg><use xlink:href="#iconDownload"></use></svg>${ctx.i18n().importWithOverwrite}</span>`
            );
        },
    },
    {
        key: "feedbackIssue",
        description: "feedbackIssueDescription",
        type: "createActionElement",
        createActionElement: () => {
            const repoLink = "https://github.com/TCOTC/snippets";
            return htmlToElement(
                `<a href="${repoLink}" target="_blank" rel="noopener noreferrer" class="b3-button b3-button--outline fn__flex-center fn__size200 ariaLabel" aria-label="${repoLink}" data-position="north"><svg><use xlink:href="#iconGithub"></use></svg>${ctx.i18n().feedbackIssueButton}</a>`
            );
        },
    },
    {
        key: "consoleDebug",
        description: "consoleDebugDescription",
        type: "boolean",
        defaultValue: false,
    },
    {
        key: "reloadUIAfterModifyJSNotice",
        description: !ctx.isMobile() ? "reloadUIAfterModifyJSNoticeDescription" : "reloadUIAfterModifyJSNoticeDescriptionMobile",
        type: "boolean",
        defaultValue: true,
    }
];
