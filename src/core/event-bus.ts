/**
 * 类型化事件总线（core 层基础设施）
 * 目标架构中用于"store 变更 → 各 UI 视图订阅并自行重渲染"的解耦通道。
 * 本模块为零依赖的纯新增积木；后续逐步将跨模块通信接入此总线。
 */

/**
 * 事件处理器
 */
export type EventHandler<T> = (payload: T) => void;

/**
 * 取消订阅函数
 */
export type Unsubscribe = () => void;

/**
 * 事件总线：同一事件可注册多个处理器，emit 时按注册顺序依次调用。
 * 事件名到载荷类型的映射由使用方自行约定；emit 运行时不校验载荷。
 */
export class EventBus {
    private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

    /**
     * 订阅事件
     * @param event 事件名
     * @param listener 事件处理器
     * @returns 取消订阅函数
     */
    on<T>(event: string, listener: EventHandler<T>): Unsubscribe {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(listener as (payload: unknown) => void);
        return () => {
            this.off(event, listener);
        };
    }

    /**
     * 取消订阅事件
     * @param event 事件名
     * @param listener 事件处理器
     */
    off<T>(event: string, listener: EventHandler<T>): void {
        this.listeners.get(event)?.delete(listener as (payload: unknown) => void);
    }

    /**
     * 触发事件
     * @param event 事件名
     * @param payload 事件载荷
     */
    emit<T>(event: string, payload: T): void {
        const set = this.listeners.get(event);
        if (!set) {
            return;
        }
        // 先快照再遍历，允许处理器在回调中取消/新增订阅而不影响本轮派发
        Array.from(set).forEach((listener) => {
            listener(payload);
        });
    }

    /**
     * 清空全部或指定事件的订阅
     * @param event 事件名；省略则清空全部
     */
    clear(event?: string): void {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }
}
