import {EventBus} from "../core/event-bus";
import type {Snippet} from "../types";

/**
 * 代码片段列表变更事件
 * payload 为变更涉及的代码片段 ID：删除时为被删除的代码片段 ID，后续新增/更新时为对应代码片段 ID。
 */
export const SNIPPETS_CHANGED = "snippets-changed";

/**
 * 代码片段列表在内存中的存取适配
 * 当前实现为读写 window.siyuan.jcsm.snippetsList，以保证插件 reload 后列表不丢失；
 * 将来收敛 jcsm 时只需替换注入的实现。
 */
export interface SnippetListStorage {
    get(): Snippet[];
    set(snippetsList: Snippet[]): void;
}

/**
 * 代码片段列表 Store（单一写路径）
 * 收敛散落在各方法中的 this.snippetsList 增/删/改逻辑，统一在数据变更后触发
 * SNIPPETS_CHANGED 事件，供菜单计数等订阅方自行刷新；
 * 为后续"本地操作与跨窗口同步合并为同一条路径"做准备。
 */
export class SnippetStore {
    private readonly eventBus: EventBus;
    private readonly storage: SnippetListStorage;

    constructor(eventBus: EventBus, storage: SnippetListStorage) {
        this.eventBus = eventBus;
        this.storage = storage;
    }

    /**
     * 当前代码片段列表（内存态）
     */
    get list(): Snippet[] {
        return this.storage.get();
    }

    /**
     * 删除指定 ID 的代码片段
     * @param id 代码片段 ID
     * @returns 列表中存在该 ID 并实际删除时为 true
     */
    remove(id: string): boolean {
        const oldList = this.storage.get();
        const newList = oldList.filter((snippet: Snippet) => snippet.id !== id);
        if (newList.length === oldList.length) {
            return false;
        }
        this.storage.set(newList);
        this.eventBus.emit(SNIPPETS_CHANGED, id);
        return true;
    }

    /**
     * 新增或更新代码片段
     * 存在同 ID 片段时整体替换；不存在时按类型分区插入（CSS 保持在前、JS 保持在后，
     * 与思源原生列表的分区规则一致：JS 插入到当前首个 JS 片段之前，无 JS 片段时追加到末尾）。
     * 列表变更后统一触发 SNIPPETS_CHANGED 事件。
     * @param snippet 代码片段
     * @returns 变更详情：added 表示是否为新增；oldSnippet 为被替换的旧片段（更新时存在）
     */
    upsert(snippet: Snippet): { added: boolean; oldSnippet?: Snippet } {
        const oldList = this.storage.get();
        const oldSnippet = oldList.find((s: Snippet) => s.id === snippet.id);
        if (oldSnippet) {
            // 更新：整体替换同 ID 片段
            this.storage.set(oldList.map((s: Snippet) => (s.id === snippet.id ? snippet : s)));
        } else {
            // 新增：按类型分区插入
            const newList = [...oldList];
            if (snippet.type === "css") {
                // CSS 插入到开头
                newList.unshift(snippet);
            } else {
                // 找到第一个 JS 代码片段，插入到它的前面，保证 CSS 在前，JS 在后
                const firstJsIndex = newList.findIndex((s: Snippet) => s.type === "js");
                if (firstJsIndex >= 0) {
                    newList.splice(firstJsIndex, 0, snippet);
                } else {
                    // 不存在 JS 代码片段，则直接插入到末尾
                    newList.push(snippet);
                }
            }
            this.storage.set(newList);
        }
        this.eventBus.emit(SNIPPETS_CHANGED, snippet.id);
        return { added: !oldSnippet, oldSnippet };
    }
}
