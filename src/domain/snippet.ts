import {parse as acornParse} from "acorn";
import type {SnippetType} from "../types";

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
