import { ISiyuan } from "siyuan/types";

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
            jcsm?: {
                isMobile?: boolean;
                isTouchDevice?: boolean;
                snippetsType?: string;
                snippetsList?: Snippet[];
                realTimePreview?: boolean;
                newSnippetEnabled?: boolean;
                listeners?: ListenersArray | null;
                isCheckingListeners?: boolean;
                listenerCheckIntervalId?: number | null;
                consoleDebug?: boolean;
                notificationSwitch?: boolean;
                reloadUIAfterModifyJS?: boolean;
                isReloadUIRequired?: boolean;
                themeObserver?: MutationObserver;
                snippetSearchType?: number;
                fileWatchEnabled?: string;
                fileWatchPath?: string;
                fileWatchInterval?: number;
                fileWatchIntervalId?: number | null;
                fileWatchFileStates?: Map<string, FileState>;
                disableNotification?: (messageI18nKey: string) => void;
                defaultSnippetsType?: string;
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
 * 代码片段类型
 * 参考 app/src/types/index.d.ts 的 ISnippet
 */
interface Snippet {
    id?: string;
    name: string;
    content: string;
    type: "css" | "js";
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

export { Snippet, SettingItem, ListenersArray, ElementListeners, ListenerItem, FileState };