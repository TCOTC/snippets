// 插件配置：声明式配置项定义 + 装配、持久化与热应用
// 本模块统一承载：配置项类型与条目构建（SnippetsConfigItem/createSnippetsConfigItems，条目持有插件实例
// 引用，运行态属性在调用时才求值）、ConfigService（配置读取并与默认值合并 → 写入插件 config
// 对象字段 → 构建 Setting 项；对话框保存 saveFromDialog；配置热应用 applyConfig（onDataChanged 同源）；
// 通知禁用持久化 disableNotification）。
// 配置值存于插件 config 对象（SnippetsConfig 字段默认值为事实源，见 config.ts；init 从磁盘合并、写配置即落盘）；
// 配置文件读写经插件生命周期方法（loadData/saveData/removeData）与本模块自持的存储键名。
import {hideMessage, Setting} from "siyuan";
import {htmlToElement, PLUGIN_NAME, settleWriteResponse, SNIPPET_DIALOG_SELECTOR} from "../utils";
import {buildGistTokenSettingElement} from "../services/gist-token";
import type PluginSnippets from "../index";
import type {SettingItem} from "../types";

/**
 * 配置项下拉选项
 */
interface SnippetsConfigOption {
    value: string | number;
    text: string;
}

/**
 * 配置项定义（configItems 元素的类型定义）
 */
interface SnippetsConfigItem {
    key: string;
    description?: string;
    type?: "boolean" | "string" | "number" | "selectString" | "selectNumber" | "createActionElement";
    direction?: "row" | "column";
    createActionElement?: () => HTMLElement;
    options?: SnippetsConfigOption[];
    ignore?: boolean;
    /** 应用该配置项时的 UI 副作用 */
    onApply?: (newValue: any) => void | Promise<void>;
}


export const STORAGE_NAME = "plugin-config.json";  // 配置文件名（index 侧 removeData 亦使用）

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
     * 有配置值的条目（init 时由 configItems 过滤按钮类条目得到）
     */
    private valueItems: SnippetsConfigItem[] = [];

    /**
     * 插件设置对象（init 装配后可用）
     */
    private settingInstance: Setting | undefined;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 插件设置对象（init 完成后可用）
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
     * 写入配置文件
     * @returns saveData 的响应（内核 { code, msg }，供调用方判断写入是否成功）
     */
    private async saveStoredConfig(content: any): Promise<any> {
        // 必须返回 saveData 的响应：saveFromDialog 依赖它判断 code 决定是否关闭对话框
        return this.plugin.saveData(STORAGE_NAME, content);
    }

    /**
     * 读取配置项当前值（存于插件 config 对象对应字段，键与 configItems 条目 key 一致）
     * configItems 以字符串 key 声明式驱动，字符串索引必然经过 any，边界收在本方法内
     */
    private read(key: string): any {
        return (this.plugin.config as any)[key];
    }

    /**
     * 写配置项到插件 config 对象对应字段
     */
    private write(key: string, value: any) {
        (this.plugin.config as any)[key] = value;
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
     * 应用单个配置项（值有变化才写入并触发 onApply）
     */
    private async setValue(item: SnippetsConfigItem, newValue: any) {
        if (this.read(item.key) !== newValue) {
            this.write(item.key, newValue);
            await this.apply(item.key, newValue);
        }
    }

    /**
     * 构建配置项（条目定义见本模块 createSnippetsConfigItems；仅构建一次并复用，
     * 条目持有插件实例引用，运行态属性在 onApply/createActionElement 调用时才求值）
     * 注意：构建时不使用 this.plugin.console 之类的方法——它们需配置加载完成后才可用
     */
    private initConfigItems() {
        if (this.configItems.length > 0) {
            return;
        }
        this.configItems = createSnippetsConfigItems(this.plugin);
        // 按钮类条目无配置值，装配 Setting 仍遍历全量，其余路径统一遍历 valueItems
        this.valueItems = this.configItems.filter(item => item.type !== "createActionElement");
    }

    /**
     * 初始化插件设置
     * 加载配置文件 → 与默认配置合并（存储有值的键覆盖 config 对象字段默认值）→ 装配 Setting
     */
    public async init() {
        const stored = await this.loadStoredConfig();
        // 配置文件不存在时 loadData 返回空串，视为无历史配置
        const config = (typeof stored === "object" && stored !== null) ? stored : {};

        // 从配置文件合并到 config 对象（值缺失/新增键时保持字段默认值，默认值事实源见 config.ts）
        this.initConfigItems();
        this.valueItems.forEach(item => {
            if (Object.prototype.hasOwnProperty.call(config, item.key)) {
                this.write(item.key, config[item.key]);
            }
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
    public async saveFromDialog(dialogElement: HTMLElement) {
        // 按钮类条目无控件，且逐个 await 副作用完成后再持久化/关窗
        for (const item of this.valueItems) {
            let newValue;
            let element: HTMLInputElement | HTMLSelectElement | null = null;

            switch (item.type) {
                case "boolean":
                    element = dialogElement.querySelector(`input[data-type='${item.key}']`);
                    if (!element) continue;
                    newValue = (element as HTMLInputElement).checked;
                    break;
                case "selectString":
                case "selectNumber":
                    element = dialogElement.querySelector(`select[data-type='${item.key}']`);
                    if (!element) continue;
                    newValue = item.type === "selectNumber" ? parseInt((element as HTMLSelectElement).value) : (element as HTMLSelectElement).value;
                    break;
                case "string":
                    element = dialogElement.querySelector(`input[data-type='${item.key}']`);
                    if (!element) continue;
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
                    if (!element) continue;
                    newValue = parseInt((element as HTMLInputElement).value) || this.read(item.key) || 0;
                    break;
            }

            await this.setValue(item, newValue);
        }

        // 等待写入完成后再决定是否关闭对话框：
        // 写 API 失败（只读模式/插件已销毁等场景 reject）已归一为 { code: 非 0 }（见 settleWriteResponse）
        const saveResponse = await settleWriteResponse(this.persistConfig());
        if (saveResponse.code !== 0) {
            // 写入失败：提示并保持对话框打开，用户可重试或取消
            this.plugin.showErrorMessage(this.plugin.i18n.saveConfigFailed + " [" + saveResponse.code + ": " + saveResponse.msg + "]", 20000, "error");
            return;
        }

        // 移除设置对话框
        this.plugin.snippetsDialog.closeByElement(dialogElement);
    }

    /**
     * 应用配置（本地读取或跨窗口/跨设备同步后的统一入口，按值 diff 幂等）
     * @param config 配置对象
     */
    private applyConfig(config: any) {
        if (!config || typeof config !== "object") {
            return;
        }
        // 逐个配置项与当前值比较，有变化时写入并触发对应 UI 更新
        this.valueItems.forEach(item => {
            if (Object.prototype.hasOwnProperty.call(config, item.key)) {
                void this.setValue(item, config[item.key]);
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
            this.plugin.console.warn(`disableNotification: Notification config item "${noticeConfigKey}" not found`);
            return;
        }

        // 检查是否为布尔类型的通知配置
        if (configItem.type !== "boolean") {
            this.plugin.console.warn(`disableNotification: Notification config item "${noticeConfigKey}" is not boolean type`);
            return;
        }

        // 禁用通知
        this.write(noticeConfigKey, false);

        // 保存设置到配置文件
        void this.persistConfig();

        this.plugin.console.log(`disableNotification: Notification "${noticeConfigKey}" has been disabled and settings saved`);
    }

    /**
     * 将全部配置项收集为配置对象并写入文件
     * @returns saveData 的返回（调用方 await 后检查响应 code 是否为 0 判断是否成功）
     */
    private persistConfig(): any {
        const config: any = {};
        this.valueItems.forEach(item => {
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
            title: this.plugin.i18n[item.key],
            description: item.description ? this.plugin.i18n[item.description] : undefined,
            direction: item.direction,
            createActionElement: () => {
                if (item.type === "boolean") {
                    return htmlToElement(
                        `<input class="b3-switch fn__flex-center" type="checkbox" data-type="${item.key}"${this.read(item.key) ? " checked" : ""}>`
                    );
                } else if ((item.type === "selectString" || item.type === "selectNumber") && item.options) {
                    // 创建下拉框
                    const currentValue = this.read(item.key);
                    const optionsHtml = item.options.map(option => {
                        // 由于 HTML 的 value 属性最终都会被转为字符串，这里直接用字符串比较即可
                        const isSelected = String(currentValue) === String(option.value);
                        return `<option value="${option.value}"${isSelected ? " selected" : ""}>${this.plugin.i18n[option.text]}</option>`;
                    }).join("");

                    return htmlToElement(
                        `<select class="b3-select fn__flex-center" data-type="${item.key}">${optionsHtml}</select>`
                    );
                } else if (item.type === "string") {
                    // 创建文本输入框（无 placeholder：输入框恒有当前值，placeholder 永不可见）
                    const currentValue = this.read(item.key) ?? "";
                    return htmlToElement(
                        `<input class="b3-text-field fn__flex-center" type="text" data-type="${item.key}" value="${currentValue}">`
                    );
                } else if (item.type === "number") {
                    // 创建数字输入框（无 placeholder：输入框恒有当前值，placeholder 永不可见）
                    const currentValue = this.read(item.key) ?? 0;
                    return htmlToElement(
                        `<input class="b3-text-field fn__flex-center" type="number" data-type="${item.key}" value="${currentValue}" min="1" max="300" step="1">`
                    );
                } else if (item.createActionElement) {
                    return item.createActionElement();
                }
                // 理论不可达：configItems 的类型均已在上方处理
                throw new Error("Unhandled config item type: " + item.type);
            },
        };
    }
}

/**
 * 显示/隐藏菜单片段项上的操作按钮（删除/复制/编辑，三个 show* 配置共用）
 */
const applySnippetButtonVisibility = (plugin: PluginSnippets, buttonType: string, show: boolean) => {
    const buttons = plugin.menuView.menuItems?.querySelectorAll(`.jcsm-snippet-item button[data-type='${buttonType}']`) as NodeListOf<HTMLButtonElement> | undefined;
    buttons?.forEach(button => button.classList.toggle("fn__none", !show));
};

/**
 * 构建操作按钮条目的元素（导出/导入按钮同模板）
 */
const createOutlineActionElement = (action: string, icon: string, label: string): HTMLElement =>
    htmlToElement(
        `<span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="${action}"><svg><use xlink:href="#${icon}"></use></svg>${label}</span>`
    );

/**
 * 构建全部配置项（条目持有插件实例引用）
 * 求值时机：ignore/description 等属性值在构建时刻求值；
 * createActionElement/onApply 箭头函数体内的 plugin 读取在函数被调用时才执行，
 * 因此菜单容器等运行态引用能拿到实时值，不会停留在构建时刻的快照。
 * @param plugin 插件实例
 * @returns 配置项数组
 */
const createSnippetsConfigItems = (plugin: PluginSnippets): SnippetsConfigItem[] => [
    {
        key: "openNativeSnippets",
        description: "openNativeSnippetsDescription",
        type: "createActionElement",
        createActionElement: () => {
            return htmlToElement(
                `<span class="b3-button b3-button--outline fn__flex-center fn__size200" data-action="settingsSnippets"><svg><use xlink:href="#iconJcsm"></use></svg>${plugin.i18n.openNativeSnippetsWindow}</span>`
            );
        },
        ignore: plugin.isMobile,
    },
    {
        key: "multipleSnippetEditors",
        description: "multipleSnippetEditorsDescription",
        type: "boolean",
        ignore: plugin.isMobile,
    },
    {
        key: "realTimePreview",
        description: "realTimePreviewDescription",
        type: "boolean",
        // 修改 realTimePreview 之后，显示/隐藏已打开 CSS 编辑对话框中的手动预览按钮
        // （启用实时预览时由输入事件驱动预览，手动按钮隐藏；禁用后恢复手动按钮）
        onApply: (newValue) => {
            const cssDialogs = document.querySelectorAll(`${SNIPPET_DIALOG_SELECTOR}[data-snippet-type="css"]`);
            cssDialogs.forEach(cssDialog => {
                const previewButton = cssDialog.querySelector("button[data-action='preview']") as HTMLButtonElement;
                previewButton?.classList.toggle("fn__none", newValue === true);
                if (newValue === true) {
                    // 已打开的 CSS 对话框立即按实时预览刷新一次（keydown 监听器按 detail 识别该请求）
                    cssDialog.dispatchEvent(new CustomEvent("keydown", {detail: "realTimePreview"}));
                }
            });
        },
    },
    {
        key: "autoReloadUIAfterModifyJS",
        description: "autoReloadUIAfterModifyJSDescription",
        type: "boolean",
    },
    {
        key: "newSnippetEnabled",
        type: "boolean",
    },
    {
        key: "showDuplicateButton",
        description: "showDuplicateButtonDescription",
        type: "boolean",
        // 修改 showDuplicateButton 之后，显示/隐藏所有菜单片段项上的创建副本按钮
        onApply: (newValue) => applySnippetButtonVisibility(plugin, "duplicate", !!newValue),
    },
    {
        key: "showDeleteButton",
        description: "showDeleteButtonDescription",
        type: "boolean",
        // 修改 showDeleteButton 之后，显示/隐藏所有菜单片段项上的删除按钮
        onApply: (newValue) => applySnippetButtonVisibility(plugin, "delete", !!newValue),
    },
    {
        key: "showEditButton",
        description: "showEditButtonDescription",
        type: "boolean",
        // 修改 showEditButton 之后，显示/隐藏所有菜单片段项上的编辑按钮
        onApply: (newValue) => applySnippetButtonVisibility(plugin, "edit", !!newValue),
    },
    {
        key: "showPublishCheckbox",
        description: "showPublishCheckboxDescription",
        type: "selectNumber",
        options: [
            { value: 0, text: "showPublishCheckboxWithPublish" },
            { value: 1, text: "showPublishCheckboxShowAlways" },
            { value: 2, text: "showPublishCheckboxHideAlways" }
        ],
        // 修改 showPublishCheckbox 之后，显示/隐藏菜单与代码片段编辑对话框中的发布开关
        // （显示条件与菜单项生成时一致：跟随发布服务开关或总是显示）
        onApply: (newValue) => {
            const show = newValue === 0 ? window.siyuan.config!.publish.enable === true : newValue === 1;
            const publishSwitchInputs = document.querySelectorAll(`.jcsm-snippets-container .jcsm-snippet-item input[data-type='publishSwitch'], ${SNIPPET_DIALOG_SELECTOR} input[data-type='publishSwitch']`);
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
        options: [
            { value: "css", text: "defaultSnippetsTypeCSS" },
            { value: "js", text: "defaultSnippetsTypeJS" }
        ],
    },
    {
        key: "snippetOptionClickBehavior",
        description: "snippetOptionClickBehaviorDescription",
        type: "selectNumber",
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
            if (!plugin.menuView.menu) return;
            const snippetsContainer = plugin.menuView.menuItems?.querySelector(".jcsm-snippets-container");
            if (!snippetsContainer) return;
            const snippetsItems = plugin.menuView.genMenuSnippetsItems();
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
        options: [
            { value: 0, text: "snippetSearchTypeDisabled" },
            { value: 1, text: "snippetSearchTypeName" },
            { value: 2, text: "snippetSearchTypeContent" },
            { value: 3, text: "snippetSearchTypeNameAndContent" }
        ],
        // 修改 snippetSearchType 之后，显示/隐藏菜单中的搜索按钮与搜索输入框
        onApply: (newValue) => {
            if (newValue === 0) {
                const searchButton = plugin.menuView.menuItems?.querySelector(".jcsm-top-container button[data-type='search']") as HTMLButtonElement;
                if (searchButton) {
                    searchButton.classList.add("fn__none");
                    searchButton.classList.remove("jcsm-active");
                }
                const searchInput = plugin.menuView.menuItems?.querySelector("input[data-action='search']") as HTMLInputElement;
                if (searchInput) {
                    searchInput.classList.add("fn__none");
                    searchInput.value = "";
                    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
                }
            } else {
                plugin.menuView.menuItems?.querySelector(".jcsm-top-container button[data-type='search']")?.classList.remove("fn__none");
            }
        },
    },
    {
        key: "editorIndentUnit",
        description: "editorIndentUnitDescription",
        type: "selectString",
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
        onApply: () => plugin.editorManager.updateAllEditorConfigs("indent unit"),
    },
    {
        key: "fileWatchEnabled",
        description: "fileWatchEnabledDescription",
        type: "selectString",
        options: [
            { value: "disabled", text: "fileWatchModeDisabled" },
            { value: "enabled", text: "fileWatchModeEnabled" },
            { value: "loadOnly", text: "fileWatchModeLoadOnly" }
        ],
        // 修改 fileWatchEnabled 之后，按新模式启动或停止文件监听
        onApply: (newValue) => {
            if (newValue === "disabled") {
                plugin.fileWatchService.stop();
            } else {
                plugin.fileWatchService.start();
            }
        },
    },
    {
        key: "fileWatchPath",
        description: "fileWatchPathDescription",
        type: "string",
        // 修改 fileWatchPath 之后，重载监听文件（方法内部会按当前监听模式判断是否可执行）
        onApply: () => plugin.fileWatchService.handlePathChange(),
    },
    {
        key: "fileWatchInterval",
        description: "fileWatchIntervalDescription",
        type: "number",
        // 修改 fileWatchInterval 之后，按新间隔重置监听定时器
        onApply: () => plugin.fileWatchService.handleIntervalChange(),
    },
    {
        key: "topBarPosition",
        description: "topBarPositionDescription",
        type: "selectString",
        options: [
            { value: "left", text: "topBarPositionLeft" },
            { value: "right", text: "topBarPositionRight" }
        ],
        ignore: plugin.isMobile,
        // 修改 topBarPosition 之后，移除并重建顶栏按钮；菜单已打开时按新位置重排
        onApply: async () => {
            plugin.menuView.removeTopBarElement();
            await plugin.menuView.initTopBar();
            if (plugin.menuView.menu) {
                plugin.menuView.setMenuPosition(true);
            }
        },
    },
    {
        key: "githubToken",
        type: "createActionElement",
        // GitHub Token 管理区域：事件在元素内部直接绑定（gist-token.ts buildGistTokenSettingElement），
        // 不经 saveFromDialog 收集（Token 绝不写入 plugin-config.json，见 gist-token.ts 顶部约束）
        createActionElement: () => buildGistTokenSettingElement(plugin),
    },
    {
        key: "gistImport",
        description: "gistImportDescription",
        type: "createActionElement",
        createActionElement: () => createOutlineActionElement("gistImport", "iconDownload", plugin.i18n.gistImportButton),
    },
    {
        key: "gistPublish",
        description: "gistPublishDescription",
        type: "createActionElement",
        createActionElement: () => createOutlineActionElement("gistPublish", "iconUpload", plugin.i18n.gistPublishButton),
    },
    {
        key: "exportSnippets",
        description: "exportSnippetsDescription",
        type: "createActionElement",
        createActionElement: () => createOutlineActionElement("exportSnippets", "iconUpload", plugin.i18n.export),
    },
    {
        key: "importSnippetsWithAppend",
        description: "importSnippetsWithAppendDescription",
        type: "createActionElement",
        createActionElement: () => createOutlineActionElement("importSnippetsWithAppend", "iconDownload", plugin.i18n.importWithAppend),
    },
    {
        key: "importSnippetsWithOverwrite",
        description: "importSnippetsWithOverwriteDescription",
        type: "createActionElement",
        createActionElement: () => createOutlineActionElement("importSnippetsWithOverwrite", "iconDownload", plugin.i18n.importWithOverwrite),
    },
    {
        key: "feedbackIssue",
        description: "feedbackIssueDescription",
        type: "createActionElement",
        createActionElement: () => {
            const repoLink = "https://github.com/TCOTC/snippets";
            return htmlToElement(
                `<a href="${repoLink}" target="_blank" rel="noopener noreferrer" class="b3-button b3-button--outline fn__flex-center fn__size200 ariaLabel" aria-label="${repoLink}" data-position="north"><svg><use xlink:href="#iconGithub"></use></svg>${plugin.i18n.feedbackIssueButton}</a>`
            );
        },
    },
    {
        key: "consoleDebug",
        description: "consoleDebugDescription",
        type: "boolean",
    },
    {
        key: "reloadUIAfterModifyJSNotice",
        description: !plugin.isMobile ? "reloadUIAfterModifyJSNoticeDescription" : "reloadUIAfterModifyJSNoticeDescriptionMobile",
        type: "boolean",
    }
];
