// 插件强类型配置对象
// 值来源：字段初始化默认值（默认值唯一事实源，configItems 不再携带 defaultValue）；
// ConfigService.init 按 configItems 键从配置文件合并（存储有值则覆盖字段默认值）；
// 序列化经 ConfigService.persistConfig 遍历 configItems 值项键读取本对象字段落盘。
// 运行态会话状态（snippetsList/snippetsType/isReloadUIRequired 等）不属于配置，仍留在插件实例。
import type {SnippetType} from "../types";

/**
 * 插件配置（字段名与 config-service.ts createSnippetsConfigItems 的值项 key 一一对应）
 */
export class SnippetsConfig {
    /** CSS 代码片段实时预览（须与 snippet.type === "css" 一起使用） */
    realTimePreview = true;

    /** 新建代码片段时默认启用 */
    newSnippetEnabled = true;

    /** 在开发者工具中输出插件日志 */
    consoleDebug = false;

    /** JS 修改后自动重新加载界面 */
    autoReloadUIAfterModifyJS = true;

    /** 点击代码片段选项的行为：0 无操作 / 1 切换开关 / 2 打开编辑器 */
    snippetOptionClickBehavior = 1;

    /** 代码片段排序方式（排序逻辑见 domain/snippet.ts sortSnippets） */
    snippetSortType = "customSort";

    /** 代码片段搜索类型：0 不搜索 / 1 标题 / 2 内容 / 3 标题或内容 */
    snippetSearchType = 1;

    /** 是否显示创建副本按钮 */
    showDuplicateButton = false;

    /** 是否显示删除按钮 */
    showDeleteButton = true;

    /** 是否显示编辑按钮 */
    showEditButton = true;

    /** 发布开关显示策略：0 跟随发布服务 / 1 总是显示 / 2 总是隐藏 */
    showPublishCheckbox = 0;

    /** 新建片段时的默认类型 */
    defaultSnippetsType: SnippetType = "css";

    /** 编辑器缩进单位（CodeMirror 解析见 ui/editor-manager.ts getEditorIndentUnit） */
    editorIndentUnit = "followSiyuan";

    /** 是否允许同时打开多个代码片段编辑器 */
    multipleSnippetEditors = true;

    /** 文件夹监听模式：disabled 禁用 / enabled 监听 / loadOnly 仅启动时加载 */
    fileWatchEnabled = "disabled";

    /** 文件夹监听路径 */
    fileWatchPath = "data/snippets";

    /** 文件夹监听间隔（秒） */
    fileWatchInterval = 5;

    /** 顶栏按钮位置 */
    topBarPosition: "left" | "right" = "right";

    /** “修改 JS 后重新加载界面”通知开关（feedback.ts 按 i18n 键动态读取 *Notice 字段） */
    reloadUIAfterModifyJSNotice = true;
}
