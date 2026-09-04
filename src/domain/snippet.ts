import {parse as acornParse} from "acorn";
import type {ExpressionStatement} from "acorn";
import type {Snippet, SnippetType} from "../types";

/**
 * 深拷贝（优先使用 structuredClone，不支持时回退 JSON 序列化）
 * @param value 原值
 * @returns 深拷贝副本
 */
export function deepClone<T>(value: T): T {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 代码片段显示标题（名称为空时回退内容前 200 字符）
 * @param snippet 代码片段
 * @returns 显示标题
 */
export function snippetTitle(snippet: Snippet): string {
    return snippet.name || snippet.content.slice(0, 200);
}

/**
 * 简单判断内容是否为有效的 JavaScript 代码
 * @param code 代码
 * @returns 是否为有效的 JavaScript 代码
 */
export function isValidJavaScriptCode(code: string): boolean {
    code = code.trim();
    if (code === "") return false;
    // 使用 acorn 解析代码，判断是否为有效的 JavaScript 代码
    try {
        // https://github.com/acornjs/acorn/tree/master/acorn/
        const ast = acornParse(code, { ecmaVersion: "latest" });
        const statements = ast.body;
        const length = statements.length;
        if (length === 0) {
            return false;
        } else if (
            length === 1 &&                                        // 代码只包含一个顶级语句或表达式
            statements[0].type === "ExpressionStatement"          // 代码是一行表达式
        ) {
            const expressionType = (statements[0] as ExpressionStatement).expression.type;
            if (
                expressionType === "Literal" ||          // 字面量（Literal）是值本身，比如数字、字符串、布尔值等。只有一个值，没有其他语法结构
                expressionType === "Identifier" ||       // 标识符（Identifier）是变量名、函数名等标识。只是引用一个变量，没有做赋值、调用、声明等操作
                expressionType === "MemberExpression" || // 成员表达式（MemberExpression）是访问对象属性的表达式，比如 obj.prop 或 arr[index]
                expressionType === "ThisExpression" ||   // this 表达式，单独一行 this 无任何副作用
                // expressionType === "Super" ||         // Super 仅在 class 方法体内合法，脚本顶层解析即抛错，此判断恒 false（TS2367），注释保留说明不可达
                expressionType === "ArrayExpression" ||
                expressionType === "ObjectExpression" ||
                expressionType === "TemplateLiteral" ||
                expressionType === "FunctionExpression" ||
                expressionType === "ArrowFunctionExpression" ||
                expressionType === "UpdateExpression" ||
                expressionType === "UnaryExpression" ||
                expressionType === "BinaryExpression" ||
                expressionType === "LogicalExpression" ||
                expressionType === "ConditionalExpression" ||
                // expressionType === "CallExpression" || // 调用（含 IIFE、console.log 等）是有效代码，排除会把有效代码误判为无效，注释保留说明不可排除
                expressionType === "NewExpression" ||
                expressionType === "SequenceExpression"
            ) {
                return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * 判断 CSS 代码片段内容是否会被思源内核拒绝
 * 思源内核 setSnippet 对 CSS 片段做安全校验：内容（不区分大小写）包含 "</style" 或 "<script" 时
 * 整表保存失败并返回 invalid css snippet content（见 siyuan kernel/api/snippet.go），
 * 插件保存/导入前须按同一判据预校验，否则报错无法定位到具体片段
 * @param content CSS 代码
 * @returns 是否为内核可接受的 CSS 代码
 */
export function isValidCssSnippetContent(content: string): boolean {
    const lowerContent = content.toLowerCase();
    return !lowerContent.includes("</style") && !lowerContent.includes("<script");
}

/**
 * 判断代码片段类型是否启用
 * @param snippetType 代码片段类型
 * @returns 是否启用
 */
export function isSnippetsTypeEnabled(snippetType: SnippetType): boolean {
    if (snippetType === "css") {
        return window.siyuan.config.snippet.enabledCSS;
    }
    return window.siyuan.config.snippet.enabledJS;
}

/**
 * 按插件排序方式处理代码片段列表
 * fixedSort/customSort 保持原顺序（返回原引用）；其余排序方式先深拷贝再按键值排序，避免排序影响原数据。
 * 排序键：enabled 启用状态、fileName 名称（可选 natural 数值比较）、created 创建时间（id 前 14 位）。
 * @param snippetsList 代码片段列表
 * @param sortType 排序方式（插件配置 snippetSortType）
 * @returns 处理后的列表（fixedSort/customSort 返回原引用，其余返回排序后的新数组）
 */
export function sortSnippets(snippetsList: Snippet[], sortType: string): Snippet[] {
    let sortedList: Snippet[] = snippetsList;
    if (sortType !== "fixedSort" && sortType !== "customSort") {
        // 深拷贝，避免排序影响原数据
        sortedList = deepClone(snippetsList);
        // 各排序方式为同一 sort 骨架 + 不同比较器（created 从 id 前 14 位取创建时间，
        // id 格式为 "20250813161014-se1mend"，前 14 位是时间、后段是随机字符串）
        const comparators: Record<string, (a: Snippet, b: Snippet) => number> = {
            enabledASC: (a, b) => Number(b.enabled) - Number(a.enabled),              // 已开启优先
            enabledDESC: (a, b) => Number(a.enabled) - Number(b.enabled),             // 未开启优先
            fileNameASC: (a, b) => a.name.localeCompare(b.name),                       // 名称字母升序
            fileNameDESC: (a, b) => b.name.localeCompare(a.name),                      // 名称字母降序
            fileNameNatASC: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),   // 名称自然升序
            fileNameNatDESC: (a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }),  // 名称自然降序
            createdASC: (a, b) => a.id.slice(0, 14).localeCompare(b.id.slice(0, 14)), // 创建时间升序
            createdDESC: (a, b) => b.id.slice(0, 14).localeCompare(a.id.slice(0, 14)),// 创建时间降序
        };
        const comparator = comparators[sortType];
        if (comparator) {
            sortedList.sort(comparator);
        }
    }
    return sortedList;
}

/**
 * 按关键字与搜索类型筛选代码片段
 * 搜索类型：1 按标题（标题为空回退内容前 200 字）、2 按代码内容、3 按标题或内容；不区分大小写。
 * @param snippetsList 代码片段列表
 * @param snippetSearchType 搜索类型（插件配置 snippetSearchType）
 * @param searchText 搜索关键字
 * @returns 命中片段的 id 数组；禁用搜索（0）或关键字为空时返回 false
 */
export function filterSnippetsByKeyword(snippetsList: Snippet[], snippetSearchType: number, searchText: string): string[] | false {
    // 如果禁用搜索或搜索文本为空，返回 false，表示不搜索
    if (snippetSearchType === 0 || !searchText || searchText.trim() === "") {
        return false;
    }

    const normalizedText = searchText.toLowerCase().trim();

    return snippetsList
        .filter((snippet: Snippet) => {
            switch (snippetSearchType) {
                case 1:
                    // 按标题筛选
                    return snippetTitle(snippet).toLowerCase().includes(normalizedText);
                case 2:
                    // 按代码内容筛选
                    return snippet.content.toLowerCase().includes(normalizedText);
                case 3:
                    // 按标题和代码内容筛选
                    return (
                        snippet.name.toLowerCase().includes(normalizedText) ||
                        snippet.content.toLowerCase().includes(normalizedText)
                    );
                default:
                    // 不支持的搜索类型，直接跳过
                    return false;
            }
        })
        .map((snippet: Snippet) => snippet.id); // 只返回 id 字符串数组
}
