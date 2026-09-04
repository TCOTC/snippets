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
     * 拖拽排序：将代码片段移动到目标片段前/后
     * 保持 CSS 在前、JS 在后的分区：拖拽跨分区时按分区边界落位；
     * 目标片段不存在或位置实际未变化时返回 false。
     * 位置变化后统一触发 SNIPPETS_CHANGED 事件。
     * @param id 被移动的代码片段 ID
     * @param targetId 目标代码片段 ID
     * @param isTop 是否移动到目标上方
     * @returns 是否真的发生了位置变化
     */
    move(id: string, targetId: string, isTop: boolean): boolean {
        const snippetsList = this.storage.get();
        const fromIndex = snippetsList.findIndex((s: Snippet) => s.id === id);
        const toIndex = snippetsList.findIndex((s: Snippet) => s.id === targetId);
        if (fromIndex === -1 || toIndex === -1) {
            return false;
        }
        const snippetType = snippetsList[fromIndex].type;
        const targetType = snippetsList[toIndex].type;

        // 先移除原有项
        const [moved] = snippetsList.splice(fromIndex, 1);
        let targetIndex = toIndex;

        // 如果 snippetType 是 CSS 而 targetType 是 JS，则将片段排序到最后一个 CSS 后面
        if (snippetType === "css" && targetType === "js") {
            const cssCount = snippetsList.filter((s: Snippet) => s.type === "css").length;
            if (cssCount > 1) {
                // 找到最后一个 CSS 的位置
                targetIndex = snippetsList.map((s: Snippet) => s.type).lastIndexOf("css") + 1;
            } else {
                // CSS 数量小于等于 1，不进行排序
                snippetsList.splice(fromIndex, 0, moved);
                return false;
            }
        }
        // 如果 snippetType 是 JS 而 targetType 是 CSS，则将片段排序到第一个 JS 前面
        else if (snippetType === "js" && targetType === "css") {
            const jsCount = snippetsList.filter((s: Snippet) => s.type === "js").length;
            if (jsCount > 1) {
                // 找到第一个 JS 的位置
                targetIndex = snippetsList.findIndex((s: Snippet) => s.type === "js");
            } else {
                // JS 数量小于等于 1，不进行排序
                snippetsList.splice(fromIndex, 0, moved);
                return false;
            }
        }
        // 如果 snippetType 和 targetType 都是 CSS 或都是 JS，则根据拖拽方向排序
        else {
            if (isTop) {
                // 拖拽到上方
                if (fromIndex < toIndex) {
                    targetIndex = toIndex - 1; // 从前面拖拽到后面
                } else {
                    targetIndex = toIndex;     // 从后面拖拽到前面
                }
            } else {
                // 拖拽到下方
                if (fromIndex < toIndex) {
                    targetIndex = toIndex;     // 从前面拖拽到后面
                } else {
                    targetIndex = toIndex + 1; // 从后面拖拽到前面
                }
            }
        }

        // 插入到目标索引位置
        snippetsList.splice(targetIndex, 0, moved);

        // 位置没有变化的话就不继续执行
        if (targetIndex === fromIndex) {
            return false;
        }

        this.storage.set(snippetsList);
        this.eventBus.emit(SNIPPETS_CHANGED, id);
        return true;
    }

    /**
     * 在指定代码片段之前插入新代码片段（复制场景：副本紧邻原片段上方）
     * 前置条件：锚点存在于列表中（复制源来自列表）；若缺失，回退按分区插入（upsert 新增语义），
     * 避免副本丢失，同时保证 CSS 在前、JS 在后的分区不被破坏。
     * 列表变更后统一触发 SNIPPETS_CHANGED 事件。
     * @param snippet 要插入的代码片段
     * @param anchorId 锚点代码片段 ID
     */
    insertBefore(snippet: Snippet, anchorId: string): void {
        const newList = [...this.storage.get()];
        const anchorIndex = newList.findIndex((s: Snippet) => s.id === anchorId);
        if (anchorIndex < 0) {
            this.upsert(snippet);
            return;
        }
        newList.splice(anchorIndex, 0, snippet);
        this.storage.set(newList);
        this.eventBus.emit(SNIPPETS_CHANGED, snippet.id);
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
