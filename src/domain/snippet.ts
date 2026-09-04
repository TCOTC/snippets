import {parse as acornParse} from "acorn";
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
        const ast = acornParse(code, { ecmaVersion: "latest" }) as any;
        const length = ast.body.length;
        if (length === 0) {
            return false;
        } else if (
            length === 1 &&                            // 代码只包含一个顶级语句或表达式
            ast.body[0].type === "ExpressionStatement" // 代码是一行表达式
        ) {
            const type = ast.body[0].expression.type;
            if (
                type === "Literal" ||          // 字面量（Literal）是值本身，比如数字、字符串、布尔值等。只有一个值，没有其他语法结构
                type === "Identifier" ||       // 标识符（Identifier）是变量名、函数名等标识。只是引用一个变量，没有做赋值、调用、声明等操作
                type === "MemberExpression" || // 成员表达式（MemberExpression）是访问对象属性的表达式，比如 obj.prop 或 arr[index]
                type === "ThisExpression" ||   // 懒得写注释了
                type === "Super" ||
                type === "ArrayExpression" ||
                type === "ObjectExpression" ||
                type === "TemplateLiteral" ||
                type === "FunctionExpression" ||
                type === "ArrowFunctionExpression" ||
                type === "UpdateExpression" ||
                type === "UnaryExpression" ||
                type === "BinaryExpression" ||
                type === "LogicalExpression" ||
                type === "ConditionalExpression" ||
                // 立即执行函数是这个类型，需要排除 type === 'CallExpression' ||
                type === "NewExpression" ||
                type === "SequenceExpression"
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
        switch (sortType) {
            case "enabledASC":
                sortedList.sort((a, b) => Number(b.enabled) - Number(a.enabled));
                break;
            case "enabledDESC":
                sortedList.sort((a, b) => Number(a.enabled) - Number(b.enabled));
                break;
            case "fileNameASC":
                sortedList.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case "fileNameDESC":
                sortedList.sort((a, b) => b.name.localeCompare(a.name));
                break;
            case "fileNameNatASC":
                sortedList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                break;
            case "fileNameNatDESC":
                sortedList.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
                break;
            case "createdASC":
                // 创建时间要从 id 中获取，id 的格式是 "20250813161014-se1mend"，其中 "20250813161014" 是创建时间，"se1mend" 是随机字符串
                sortedList.sort((a, b) => a.id!.slice(0, 14).localeCompare(b.id!.slice(0, 14)));
                break;
            case "createdDESC":
                sortedList.sort((a, b) => b.id!.slice(0, 14).localeCompare(a.id!.slice(0, 14)));
                break;
            default:
                break;
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
        .map((snippet: Snippet) => snippet.id!); // 只返回 id 字符串数组
}
