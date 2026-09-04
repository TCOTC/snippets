// services/listener-registry.ts ListenerRegistry 单测
// 覆盖：add 的簿记登记与去重（同 event/fn/options 不重复注册）、remove 的三种粒度
//       （指定监听/指定事件/整元素）与簿记摘除、无效元素告警、destroy 全量清理。
// 元素以假对象桩替代（仅暴露 addEventListener/removeEventListener），不依赖真实 DOM。
import {beforeEach, describe, expect, it, vi} from "vitest";
import type PluginSnippets from "../index";
import {ListenerRegistry} from "./listener-registry";

/** 构造最小插件替身（ListenerRegistry 仅使用 console） */
const createFakePlugin = () => ({
    console: {log: vi.fn(), warn: vi.fn(), error: vi.fn()},
}) as unknown as PluginSnippets;

/** 构造假元素（记录监听器注册/移除调用） */
const createFakeElement = () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    return {addEventListener, removeEventListener} as unknown as HTMLElement;
};

describe("ListenerRegistry", () => {
    let registry: ListenerRegistry;
    let plugin: PluginSnippets;

    beforeEach(() => {
        plugin = createFakePlugin();
        registry = new ListenerRegistry(plugin);
    });

    describe("add", () => {
        it("登记新元素监听并透传 addEventListener 参数", () => {
            const element = createFakeElement();
            const fn = vi.fn();
            registry.add(element, "click", fn, {once: true});
            expect((element as unknown as {addEventListener: ReturnType<typeof vi.fn>}).addEventListener)
                .toHaveBeenCalledWith("click", fn, {once: true});
        });

        it("未传 options 时同样注册（透传 undefined）", () => {
            const element = createFakeElement();
            const fn = vi.fn();
            registry.add(element, "click", fn);
            expect((element as unknown as {addEventListener: ReturnType<typeof vi.fn>}).addEventListener)
                .toHaveBeenCalledWith("click", fn, undefined);
        });

        it("相同元素/事件/回调/options 的重复添加不重复注册", () => {
            const element = createFakeElement();
            const fn = vi.fn();
            registry.add(element, "click", fn);
            registry.add(element, "click", fn);
            const addEventListener = (element as unknown as {addEventListener: ReturnType<typeof vi.fn>}).addEventListener;
            expect(addEventListener).toHaveBeenCalledTimes(1);
        });

        it("options 不同视为不同监听，分别注册", () => {
            const element = createFakeElement();
            const fn = vi.fn();
            registry.add(element, "click", fn);
            registry.add(element, "click", fn, {once: true});
            const addEventListener = (element as unknown as {addEventListener: ReturnType<typeof vi.fn>}).addEventListener;
            expect(addEventListener).toHaveBeenCalledTimes(2);
        });

        it("同元素不同事件/回调均分别登记", () => {
            const element = createFakeElement();
            const fnA = vi.fn();
            const fnB = vi.fn();
            registry.add(element, "click", fnA);
            registry.add(element, "click", fnB);
            registry.add(element, "keydown", fnA);
            const addEventListener = (element as unknown as {addEventListener: ReturnType<typeof vi.fn>}).addEventListener;
            expect(addEventListener).toHaveBeenCalledTimes(3);
        });
    });

    describe("remove", () => {
        it("元素不存在时记录告警", () => {
            registry.remove(undefined as unknown as HTMLElement);
            expect(plugin.console.warn).toHaveBeenCalledWith(expect.stringContaining("element is not found"));
        });

        it("移除未登记的元素无副作用（不抛错、不调用 removeEventListener）", () => {
            const element = createFakeElement();
            registry.remove(element, "click", vi.fn());
            expect((element as unknown as {removeEventListener: ReturnType<typeof vi.fn>}).removeEventListener)
                .not.toHaveBeenCalled();
        });

        it("指定事件与回调移除对应监听并摘除簿记", () => {
            const element = createFakeElement();
            const fn = vi.fn();
            const removeEventListener = (element as unknown as {removeEventListener: ReturnType<typeof vi.fn>}).removeEventListener;
            registry.add(element, "click", fn);
            registry.remove(element, "click", fn);
            expect(removeEventListener).toHaveBeenCalledWith("click", fn, undefined);
            // 簿记已摘除：再次移除同监听不再触发 removeEventListener（早退）
            registry.remove(element, "click", fn);
            expect(removeEventListener).toHaveBeenCalledTimes(1);
        });

        it("指定事件移除该事件全部监听，保留其他事件", () => {
            const element = createFakeElement();
            const fnA = vi.fn();
            const fnB = vi.fn();
            const other = vi.fn();
            const removeEventListener = (element as unknown as {removeEventListener: ReturnType<typeof vi.fn>}).removeEventListener;
            registry.add(element, "click", fnA);
            registry.add(element, "click", fnB);
            registry.add(element, "keydown", other);
            registry.remove(element, "click");
            expect(removeEventListener).toHaveBeenCalledTimes(2);
            // keydown 监听仍保留：可正常移除
            registry.remove(element, "keydown", other);
            expect(removeEventListener).toHaveBeenCalledTimes(3);
        });

        it("不指定事件时移除元素全部监听", () => {
            const element = createFakeElement();
            const fnA = vi.fn();
            const fnB = vi.fn();
            const removeEventListener = (element as unknown as {removeEventListener: ReturnType<typeof vi.fn>}).removeEventListener;
            registry.add(element, "click", fnA);
            registry.add(element, "keydown", fnB);
            registry.remove(element);
            expect(removeEventListener).toHaveBeenCalledTimes(2);
            // 簿记已清空：再次移除不再触发
            registry.remove(element);
            expect(removeEventListener).toHaveBeenCalledTimes(2);
        });
    });

    describe("destroy", () => {
        it("移除全部已登记监听并清空簿记", () => {
            const elementA = createFakeElement();
            const elementB = createFakeElement();
            const fnA = vi.fn();
            const fnB = vi.fn();
            registry.add(elementA, "click", fnA);
            registry.add(elementA, "keydown", fnA);
            registry.add(elementB, "click", fnB);
            registry.destroy();
            expect((elementA as unknown as {removeEventListener: ReturnType<typeof vi.fn>}).removeEventListener)
                .toHaveBeenCalledTimes(2);
            expect((elementB as unknown as {removeEventListener: ReturnType<typeof vi.fn>}).removeEventListener)
                .toHaveBeenCalledTimes(1);
            // 簿记已清空：destroy 后再移除不再触发任何 removeEventListener
            registry.remove(elementA);
            expect((elementA as unknown as {removeEventListener: ReturnType<typeof vi.fn>}).removeEventListener)
                .toHaveBeenCalledTimes(2);
        });
    });
});
