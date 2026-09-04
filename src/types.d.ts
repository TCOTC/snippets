import { ISiyuan } from "siyuan/types";

// 允许副作用导入 SCSS 样式文件（由 webpack/css-loader 处理）
declare module "*.scss";

/**
 * 单个监听器类型
 */
type ListenerItem = {
    event: string;
    fn: (event?: Event) => void;
    options?: AddEventListenerOptions;
};

/**
 * 元素监听器类型
 */
type ElementListeners = {
    element: HTMLElement;
    listeners: ListenerItem[];
};

/**
 * 监听器数组类型
 */
type ListenersArray = Array<ElementListeners>;

declare global {
    interface Window {
        siyuan: ISiyuan & {
            isPublish?: boolean;
            // 运行时 window.siyuan.config/languages/menus 恒存在，此处显式置为必选以消除大量空值断言
            config: NonNullable<ISiyuan["config"]>;
            menus: NonNullable<ISiyuan["menus"]>;
            languages: NonNullable<ISiyuan["languages"]>;
            jcsm?: {
                // window.siyuan.jcsm 是跨插件 reload 存活的全局变量仓库；此处仅声明仍被
                // 类型化读写（手写 getter/setter / 直接 jcsm.x）的字段。
                // 配置类字段（realTimePreview/newSnippetEnabled/consoleDebug/snippetSearchType/
                // fileWatch* 等）经 ConfigService 内部缓存 + Object.defineProperty 以实例属性访问，
                // 不再存于 jcsm（阶段 6 已收敛，见 config-service.ts）。
                isMobile?: boolean;
                isTouchDevice?: boolean;
                snippetsType?: SnippetType;
                snippetsList?: Snippet[];
                listeners?: ListenersArray | null;
                isCheckingListeners?: boolean;
                listenerCheckIntervalId?: number | null;
                isReloadUIRequired?: boolean;
                themeObserver?: MutationObserver;
                disableNotification?: (messageI18nKey: string) => void;
            };
        };
        JSAndroid?: {
            openExternal: (uri: string) => void;
            exportByDefault: (uri: string) => void;
        };
        JSHarmony?: {
            openExternal: (uri: string) => void;
            exportByDefault: (uri: string) => void;
        };
        webkit?: {
            messageHandlers?: {
                openLink?: {
                    postMessage: (uri: string) => void;
                };
            };
        };
    }
}

/**
 * 设置项类型
 */
interface SettingItem {
    title?: string;
    description?: string;
    direction?: "row" | "column";
    actionElement?: HTMLElement;
    createActionElement?: () => HTMLElement;
}

/**
 * 文件状态类型
 */
interface FileState {
    path: string;
    lastModified: number;
    content: string;
}

/**
 * 代码片段类型（css 或 js）
 */
type SnippetType = "css" | "js";

/**
 * 代码片段类型
 * 参考 app/src/types/index.d.ts 的 ISnippet
 */
interface Snippet {
    id: string;
    name: string;
    content: string;
    type: SnippetType;
    enabled: boolean;
    disabledInPublish?: boolean | undefined;
}

// 扩展 Setting 类
declare module "siyuan" {
    interface Setting {
        items: SettingItem[];

        addItem(options: {
            title?: string;
            direction?: "column" | "row";
            description?: string;
            actionElement?: HTMLElement;
            createActionElement?(): HTMLElement;
        }): void;
    }
}

// 拓展 Dialog 类
declare module "siyuan" {
    interface Dialog {
        id: string;
        destroyNative: () => void;
    }
}

// 补充 petal v1.1.2 尚未发布的 saveExportFile 声明，待 petal 发布新版后可移除
// 参考：https://github.com/siyuan-note/petal/blob/main/siyuan.d.ts
declare module "siyuan" {
    export function saveExportFile(uri: string, msgId?: string): Promise<void>;
}

export { Snippet, SnippetType, SettingItem, ListenersArray, ElementListeners, ListenerItem, FileState };