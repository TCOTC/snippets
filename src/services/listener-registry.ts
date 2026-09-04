// 事件监听器统一簿记
// 职责：插件内 addListener/removeListener 统一登记，实例卸载（uninstall）时经 destroy 移除全部监听器。
// 监听器绑定在插件自建元素上，元素生命周期（对话框/菜单关闭、插件卸载）均显式 removeListener 清理，
// 登记记录同步摘除，无需后台轮询检查 DOM。
import type PluginSnippets from "../index";

/**
 * 单个监听器记录
 */
type ListenerItem = {
    event: string;
    fn: (event?: Event) => void;
    options?: AddEventListenerOptions;
};

/**
 * 元素监听器记录
 */
type ElementListeners = {
    element: HTMLElement;
    listeners: ListenerItem[];
};

/**
 * 事件监听器簿记数组（仅本类使用，故定义于本模块）
 */
type ListenersArray = Array<ElementListeners>;

/**
 * 事件监听器簿记
 */
export class ListenerRegistry {
    private readonly plugin: PluginSnippets;

    /**
     * 事件监听器的映射（卸载时移除所有插件监听器）
     */
    private listeners: ListenersArray = [];

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
    }

    /**
     * 销毁监听器（卸载插件时调用）：移除全部登记的监听器并清空簿记
     */
    destroy() {
        for (const elementListeners of this.listeners) {
            const {element, listeners} = elementListeners;
            listeners.forEach(({event, fn, options}) => {
                element.removeEventListener(event, fn, options);
            });
        }
        this.listeners = [];
    }
}
