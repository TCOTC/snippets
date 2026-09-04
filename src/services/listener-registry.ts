// 事件监听器统一簿记（原 index.ts「事件监听管理」分节外迁，行为等价）
// 职责：所有 addListener/removeListener 统一登记（卸载时移除全部监听器）；定时检查元素是否仍在 DOM，
// 不在则移除监听器；联动主题监听启停。
// 简洁化：不设 Host——直接持有 PluginSnippets 实例（import type 避免运行时循环依赖），
// 日志/调试开关/主题监听检查/对话框菜单开合判断经插件实例直连。
// jcsm 收敛（阶段 6）：簿记三字段（listeners/listenerCheckIntervalId/isCheckingListeners）原存于
// window.siyuan.jcsm，改为实例字段——监听器绑定在元素上（元素移除即自动释放），跨实例共用簿记的
// 唯一用途是卸载时清点，实例字段在插件卸载（uninstall）时仍持有全部本页登记记录，语义等价。
import type PluginSnippets from "../index";
import type {ListenersArray} from "../types";

/**
 * 事件监听器簿记（原 index.ts「事件监听管理」分节外迁，行为等价）
 */
export class ListenerRegistry {
    private readonly plugin: PluginSnippets;

    /**
     * 事件监听器的映射（卸载时移除所有插件监听器）
     */
    private listeners: ListenersArray = [];

    /**
     * 监听器检查定时器 ID
     */
    private listenerCheckIntervalId: number | null = null;

    /**
     * 是否正在检查监听器元素
     */
    private isCheckingListeners = false;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 添加事件监听器
     * @param element 元素
     * @param event 事件
     * @param fn 回调函数
     * @param options 监听器选项
     */
    add(element: HTMLElement, event: string, fn: (event?: Event) => void, options?: AddEventListenerOptions) {
        // 查找元素是否已存在监听器记录
        let elementListeners = this.listeners.find(item => item.element === element);
        if (!elementListeners) {
            // 创建该元素的监听器列表
            elementListeners = { element, listeners: [] };
            this.listeners.push(elementListeners);
        }

        // 检查是否已存在相同的监听器
        if (elementListeners.listeners.some(item => item.event === event && item.fn === fn && item.options === options)) {
            // 如果元素上已经存在相同的监听器，则不重复添加
            return;
        }

        // 将监听器添加到列表中、注册监听器
        elementListeners.listeners.push({ event, fn, options });
        element.addEventListener(event, fn, options);

        // 启动监听器元素检查机制
        this.checkListenerElement();
    }

    /**
     * 移除事件监听器
     * @param element 元素
     * @param event 事件
     * @param fn 回调函数
     * @param options 监听器选项
     */
    remove(element: HTMLElement, event?: string, fn?: (event?: Event) => void, options?: AddEventListenerOptions) {
        this.plugin.console.log("removeListener:", element);
        if (!element) {
            this.plugin.console.warn("removeListener: element is not found");
            return;
        }

        // 查找元素的监听器记录
        const elementIndex = this.listeners.findIndex(item => item.element === element);
        if (elementIndex === -1) return;

        const elementListeners = this.listeners[elementIndex];
        if (!elementListeners) {
            // 未获取到 elementListeners，有可能是重复调用了 removeListener，直接返回
            this.plugin.console.warn("removeListener: elementListeners is not found");
            return;
        }

        if (event) {
            if (fn) {
                // 移除特定的监听器
                element.removeEventListener(event, fn, options);
                const index = elementListeners.listeners.findIndex(item =>
                    item.event === event && item.fn === fn && item.options === options
                );
                if (index > -1) {
                    elementListeners.listeners.splice(index, 1);
                    // 如果移除后该元素没有任何监听器了，从数组中移除该元素的记录
                    if (elementListeners.listeners.length === 0) {
                        this.listeners.splice(elementIndex, 1);
                    }
                }
            } else {
                // 只移除该事件类型的所有监听器
                // 先筛选出所有该事件类型的监听器
                const toRemove = elementListeners.listeners.filter(item => item.event === event);
                toRemove.forEach(({ event, fn, options }) => {
                    element.removeEventListener(event, fn, options);
                });
                // 从监听器列表中移除所有该事件类型的监听器
                elementListeners.listeners = elementListeners.listeners.filter(item => item.event !== event);
                // 如果移除后该元素没有任何监听器了，从数组中移除该元素的记录
                if (elementListeners.listeners.length === 0) {
                    this.listeners.splice(elementIndex, 1);
                }
            }
        } else {
            // 移除该元素的所有监听器
            elementListeners.listeners.forEach(({ event, fn, options }) => {
                element.removeEventListener(event, fn, options);
            });
            // 从数组中移除该元素的记录
            this.listeners.splice(elementIndex, 1);
        }

        // 启动监听器元素检查机制
        this.checkListenerElement();
    }

    /**
     * 销毁监听器（卸载插件时调用）
     */
    destroy() {
        // 移除所有监听器
        for (const elementListeners of this.listeners) {
            const { element, listeners } = elementListeners;
            // 移除该元素上的所有监听器
            listeners.forEach(({ event, fn, options }) => {
                element.removeEventListener(event, fn, options);
            });
        }
        // 清空簿记
        this.listeners = [];
        // 重置检查标志
        this.isCheckingListeners = false;
        // 停止监听器检查定时器
        this.stopListenerCheckInterval();
    }

    /**
     * 检查监听器元素是否还在 DOM 中
     * 如果元素不在 DOM 中，则移除对应的监听器
     * 如果 listeners 中还有监听器，则每隔一段时间检查一次
     * 直到 listeners 中没有监听器为止才停止检查
     */
    private checkListenerElement() {
        // 如果已经在检查中，则不重复执行
        if (this.isCheckingListeners) {
            return;
        }

        // 设置检查标志
        this.isCheckingListeners = true;

        // 检查主题监听状态
        this.plugin.editorManager.checkAndManageThemeWatch();

        // 如果没有监听器，停止定时器并返回
        if (!this.listeners || this.listeners.length === 0) {
            this.isCheckingListeners = false;
            this.stopListenerCheckInterval();
            return;
        }

        this.plugin.console.log("check Listener:", this.listeners);

        // 如果窗口内没有打开的 Dialog 和菜单，则移除 Document 的监听器
        if (!this.plugin.menuView.isDialogAndMenuOpen()) {
            this.remove(document.documentElement);
        }

        // 检查每个元素的监听器
        for (let i = this.listeners.length - 1; i >= 0; i--) {
            const elementListeners = this.listeners[i];
            const { element, listeners } = elementListeners;

            // 检查元素是否还在 DOM 中
            if (!document.contains(element)) {
                // 元素不在 DOM 中，移除该元素的所有监听器
                listeners.forEach(({ event, fn, options }) => {
                    element.removeEventListener(event, fn, options);
                });
                // 从数组中移除该元素的记录
                this.listeners.splice(i, 1);
                this.plugin.console.warn("checkListenerElement: remove listener of element which is not in DOM", element);
            }
        }

        // 如果还有监听器，则启动定期检查
        if (this.listeners && this.listeners.length > 0) {
            this.startListenerCheckInterval();
        } else {
            // 没有监听器了，重置检查标志并停止定时器
            this.isCheckingListeners = false;
            this.stopListenerCheckInterval();
        }
    }

    /**
     * 启动监听器检查定时器
     */
    private startListenerCheckInterval() {
        // 如果已经有定时器在运行，则不重复启动
        if (this.listenerCheckIntervalId) {
            return;
        }

        // 每隔 30 秒检查一次（调试时每隔 20 秒检查一次）
        this.listenerCheckIntervalId = window.setInterval(() => {
            this.isCheckingListeners = false; // 重置检查标志
            this.checkListenerElement();
        }, this.plugin.consoleDebug ? 20000 : 30000);
    }

    /**
     * 停止监听器检查定时器
     */
    private stopListenerCheckInterval() {
        if (this.listenerCheckIntervalId) {
            window.clearInterval(this.listenerCheckIntervalId);
            this.listenerCheckIntervalId = null;
        }
    }
}
