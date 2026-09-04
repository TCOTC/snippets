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
}
