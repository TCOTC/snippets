import {htmlToElement} from "../utils";

/**
 * 配置项下拉选项
 */
export interface SnippetsConfigOption {
    value: string | number;
    text: string;
}

/**
 * 构建配置项时所需的插件运行态上下文（阶段 4：配置项定义自 index.ts 外迁至此）
 * 以读取器函数形式提供，由调用方用箭头函数闭包捕获插件实例（避免 no-this-alias）；
 * 注意：条目构建时的静态属性值（ignore/description 等）在构建时刻调用读取器求值；
 * 条目内箭头函数体（createActionElement/onApply）中的读取器则在函数被调用时才执行，
 * 因此菜单容器等运行态引用能拿到实时值，不会停留在构建时刻的快照。
 */
export interface SnippetsConfigContext {
    /** 读取：是否移动端 */
    readonly isMobile: () => boolean;
    /** 读取：插件 i18n 文案 */
    readonly i18n: () => any;
    /** 读取：顶栏菜单列表容器（可能尚未打开） */
    readonly menuItems: () => HTMLElement | undefined;
}

/**
 * 配置项定义（阶段 4：configItems 元素的类型定义）
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
    /** 应用该配置项时的 UI 副作用（阶段 4：逐步从 applySetting 大 switch 迁入，全部迁完后删除 switch） */
    onApply?: (newValue: any) => void | Promise<void>;
}

/**
 * 构建全部配置项（阶段 4：原 index.ts 中 initConfigItems 的内联数组外迁）
 * 与旧实现的求值时机保持一致：ignore/description 等属性值在构建时刻求值，
 * 箭头函数体内的 ctx 读取器（i18n/menuItems）在调用时才执行（由调用方以箭头函数实时转发）。
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
    },
    {
        key: "fileWatchPath",
        description: "fileWatchPathDescription",
        type: "string",
        defaultValue: "data/snippets",
    },
    {
        key: "fileWatchInterval",
        description: "fileWatchIntervalDescription",
        type: "number",
        defaultValue: 5,
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
