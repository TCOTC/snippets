import {htmlToElement} from "../utils";

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
    /** 应用该配置项时的 UI 副作用（原 applySetting 中对应的 switch case 迁入此处声明） */
    onApply?: (newValue: any) => void | Promise<void>;
}

/**
 * 构建全部配置项（原 index.ts 中 initConfigItems 的内联数组外迁）
 * 与旧实现的求值时机保持一致：ignore/description 等属性值在构建时刻求值，
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
