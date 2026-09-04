// src/utils.ts DOM 类工具单测（与 utils.test.ts 的 node 用例分离：以下工具依赖真实 document）
// 覆盖：attachDialogObject/getDialogObject、setDialogKeyHandler/getDialogKeyHandler、
//       isDialogButtonFocused、hideTooltip/showElementTooltip、isInputElementActive、
//       htmlToElement、moveElementToTop。
// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Dialog} from "siyuan";
import {
    attachDialogObject,
    getDialogKeyHandler,
    getDialogObject,
    hideTooltip,
    htmlToElement,
    isDialogButtonFocused,
    isInputElementActive,
    moveElementToTop,
    setDialogKeyHandler,
    showElementTooltip,
    SNIPPET_DIALOG_DATA_KEY,
} from "./utils";

describe("attachDialogObject / getDialogObject", () => {
    it("挂载后可取回同一 Dialog 实例", () => {
        const element = document.createElement("div");
        const dialog = {element} as unknown as Dialog;
        expect(getDialogObject(element)).toBeUndefined();
        attachDialogObject(element, dialog);
        expect(getDialogObject(element)).toBe(dialog);
    });
});

describe("setDialogKeyHandler / getDialogKeyHandler", () => {
    it("登记后可取回同一处理器，未登记为 undefined", () => {
        const element = document.createElement("div");
        expect(getDialogKeyHandler(element)).toBeUndefined();
        const handler = (key: string) => void key;
        setDialogKeyHandler(element, handler);
        expect(getDialogKeyHandler(element)).toBe(handler);
    });
});

describe("isDialogButtonFocused", () => {
    it("焦点在对话框内按钮上时返回 true", () => {
        const dialog = document.createElement("div");
        const button = document.createElement("button");
        dialog.appendChild(button);
        document.body.appendChild(dialog);
        button.focus();
        expect(isDialogButtonFocused(dialog)).toBe(true);
        document.body.innerHTML = "";
    });

    it("焦点不在对话框内时返回 false", () => {
        const dialog = document.createElement("div");
        const outside = document.createElement("button");
        document.body.appendChild(dialog);
        document.body.appendChild(outside);
        outside.focus();
        expect(isDialogButtonFocused(dialog)).toBe(false);
        document.body.innerHTML = "";
    });

    it("焦点在对话框内非按钮元素上时返回 false", () => {
        const dialog = document.createElement("div");
        const input = document.createElement("input");
        dialog.appendChild(input);
        document.body.appendChild(dialog);
        input.focus();
        expect(isDialogButtonFocused(dialog)).toBe(false);
        document.body.innerHTML = "";
    });
});

describe("hideTooltip / showElementTooltip", () => {
    it("hideTooltip 给 #tooltip 添加 fn__none", () => {
        const tooltip = document.createElement("div");
        tooltip.id = "tooltip";
        document.body.appendChild(tooltip);
        hideTooltip();
        expect(tooltip.classList.contains("fn__none")).toBe(true);
        document.body.innerHTML = "";
    });

    it("showElementTooltip 触发元素的 mouseover（冒泡）事件", () => {
        const element = document.createElement("div");
        document.body.appendChild(element);
        const onMouseover = vi.fn();
        element.addEventListener("mouseover", onMouseover);
        showElementTooltip(element);
        expect(onMouseover).toHaveBeenCalledTimes(1);
        document.body.innerHTML = "";
    });
});

describe("isInputElementActive", () => {
    it("焦点在 input（非 checkbox）或 textarea 时返回 true", () => {
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        expect(isInputElementActive()).toBe(true);
        const textarea = document.createElement("textarea");
        document.body.appendChild(textarea);
        textarea.focus();
        expect(isInputElementActive()).toBe(true);
        document.body.innerHTML = "";
    });

    it("焦点在 checkbox 或普通元素时返回 false", () => {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        document.body.appendChild(checkbox);
        checkbox.focus();
        expect(isInputElementActive()).toBe(false);
        const div = document.createElement("div");
        div.setAttribute("tabindex", "0");
        document.body.appendChild(div);
        div.focus();
        expect(isInputElementActive()).toBe(false);
        document.body.innerHTML = "";
    });
});

describe("htmlToElement", () => {
    it("解析 HTML 字符串为元素", () => {
        const element = htmlToElement('<span class="x" data-k="v">text</span>');
        expect(element.tagName.toLowerCase()).toBe("span");
        expect(element.classList.contains("x")).toBe(true);
        expect(element.dataset.k).toBe("v");
        expect(element.textContent).toBe("text");
    });
});

describe("moveElementToTop", () => {
    beforeEach(() => {
        (window as unknown as {siyuan: {zIndex: number}}).siyuan = {zIndex: 10};
    });

    it("zIndex 低于已打开的对话框/菜单时提升到全局 zIndex 递增后的新值", () => {
        const other = document.createElement("div");
        other.className = "b3-dialog b3-dialog--open";
        other.dataset.key = SNIPPET_DIALOG_DATA_KEY;
        other.style.zIndex = "20";
        document.body.appendChild(other);

        const element = document.createElement("div");
        element.style.zIndex = "5";
        document.body.appendChild(element);

        moveElementToTop(element);
        // 全局 zIndex 由 10 递增到 11，元素被置顶
        expect(element.style.zIndex).toBe("11");
        expect((window as unknown as {siyuan: {zIndex: number}}).siyuan.zIndex).toBe(11);
        document.body.innerHTML = "";
    });

    it("zIndex 已最高时不重复提升", () => {
        const element = document.createElement("div");
        element.style.zIndex = "99";
        document.body.appendChild(element);
        moveElementToTop(element);
        expect(element.style.zIndex).toBe("99");
        document.body.innerHTML = "";
    });
});
