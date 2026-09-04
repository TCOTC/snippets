// 代码片段格式化服务
// 基于 Prettier 浏览器端构建（standalone + meriyah/estree/postcss 插件）格式化 CSS/JS 代码片段。
// 说明：
// - 缩进设置与编辑器保持一致，由调用方传入 getEditorIndentUnit 的解析结果（制表符或空格串）；
// - formatCodeWithCursor 使用 Prettier 的 formatWithCursor 在格式化时同步换算光标偏移，
//   编辑器收到结果后做一次整文档替换即可，撤销一步即还原格式化（不产生多处零散事务）；
// - JS parser 选 meriyah 而非 babel：prettier 各 JS parser 解析后共用同一 estree 打印器，
//   输出逐字节一致；meriyah 体积最小（124 KB vs babel 311 KB）且覆盖 stage 3/JSX/装饰器，
//   仅不支持 TS 语法（粘贴 TS 片段会报语法错误，由调用方提示）；
// - 打包注意：Prettier 体积较大（standalone + 所需插件约 500 KB 未压缩），因此必须静态
//   import 打进插件单一 bundle，且仅在用户执行格式化时才真正调用，避免启动开销。
import * as prettierModule from "prettier/standalone";
import * as pluginMeriyah from "prettier/plugins/meriyah";
import * as pluginEstree from "prettier/plugins/estree";
import * as pluginPostcss from "prettier/plugins/postcss";
import type {Plugin} from "prettier";

/**
 * Prettier 浏览器端 API 中格式化所需的方法集合
 */
type PrettierApi = Pick<typeof import("prettier/standalone"), "format" | "formatWithCursor">;

/**
 * 兼容 webpack（解析到 ESM .mjs 命名导出）与 Vitest/Node（CJS interop 把导出挂在 default 上）：
 * 命名空间自带 format 时直接使用，否则退回 default 导出
 */
const prettier: PrettierApi = (() => {
    const ns = prettierModule as unknown as {default?: PrettierApi; format?: unknown};
    return typeof ns.format === "function" ? (ns as unknown as PrettierApi) : ns.default!;
})();

/**
 * 插件模块归一：ESM 命名空间与 CJS interop 都把插件对象挂在 default 上
 */
const unwrapPlugin = (pluginModule: unknown): Plugin => {
    const candidate = (pluginModule as {default?: unknown}).default ?? pluginModule;
    return candidate as Plugin;
};

// JS 格式化需要 meriyah（解析）与 estree（打印）配对
const jsPlugins = [unwrapPlugin(pluginMeriyah), unwrapPlugin(pluginEstree)];
// CSS 格式化只需 postcss
const postcssPlugins = [unwrapPlugin(pluginPostcss)];

/**
 * 格式化结果
 */
export interface FormatCodeResult {
    code: string;
    cursorOffset: number;
}

/**
 * 将编辑器缩进单位换算为 Prettier 缩进选项
 * @param indentUnitText 缩进单位（getEditorIndentUnit 的解析结果）
 */
const toPrettierIndentOptions = (indentUnitText: string): {useTabs: boolean; tabWidth: number} => {
    if (indentUnitText.startsWith("\t")) {
        // 制表符缩进（useTabs 时 tabWidth 不参与排版，仅补全选项）
        return {useTabs: true, tabWidth: 2};
    }
    // 空格缩进：一个缩进级别的空格数
    return {useTabs: false, tabWidth: indentUnitText.length || 2};
};

/**
 * 按代码片段类型解析 Prettier parser 与所需插件
 * @param snippetType 代码片段类型（css | js）
 */
const resolveParser = (snippetType: "css" | "js"): {parser: "css" | "meriyah"; plugins: Plugin[]} => {
    if (snippetType === "css") {
        return {parser: "css", plugins: postcssPlugins};
    }
    return {parser: "meriyah", plugins: jsPlugins};
};

/**
 * 格式化代码片段内容并换算格式化后的光标位置
 * @param code 代码片段内容
 * @param snippetType 代码片段类型（css | js）
 * @param indentUnitText 缩进单位（getEditorIndentUnit 的解析结果，制表符或空格串）
 * @param cursorOffset 格式化前光标在 code 中的偏移（编辑器选区主游标位置）
 * @returns 格式化结果与光标在新内容中的偏移
 * @throws 语法错误等导致格式化失败时抛出 Prettier 原始错误，调用方应保留原内容并提示
 */
export async function formatCodeWithCursor(code: string, snippetType: "css" | "js", indentUnitText: string, cursorOffset: number): Promise<FormatCodeResult> {
    // 空白内容直接返回，避免空文档解析报错
    if (code.trim() === "") {
        return {code, cursorOffset};
    }
    const {parser, plugins} = resolveParser(snippetType);
    const result = await prettier.formatWithCursor(code, {
        parser,
        plugins,
        cursorOffset,
        ...toPrettierIndentOptions(indentUnitText),
    });
    return {code: result.formatted, cursorOffset: result.cursorOffset};
}
