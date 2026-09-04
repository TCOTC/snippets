import { ISiyuan } from "siyuan/types";

declare global {
    interface Window {
        siyuan: ISiyuan & {
            isPublish?: boolean;
            // 运行时 window.siyuan.config/languages/menus 恒存在，此处显式置为必选以消除大量空值断言
            config: NonNullable<ISiyuan["config"]>;
            menus: NonNullable<ISiyuan["menus"]>;
            languages: NonNullable<ISiyuan["languages"]>;
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

        // 上游 siyuan 类型 addItem 的 title 为必选，本插件设置项标题来自 i18n 键（类型上可能缺失），
        // 此处覆盖为可选以匹配 createSettingItem 的返回类型
        addItem(options: {
            title?: string;
            direction?: "column" | "row";
            description?: string;
            actionElement?: HTMLElement;
            createActionElement?(): HTMLElement;
        }): void;
    }
}

// 拓展 Dialog 类（上游 siyuan 类型未含 id/destroyNative）
declare module "siyuan" {
    interface Dialog {
        id: string;
        destroyNative: () => void;
    }
}

export { Snippet, SnippetType, SettingItem, FileState };
