// 行级文本差异（diff）纯逻辑（无插件/宿主依赖，便于单测）
// 用于导入预览中对比「gist 待导入」与「本地同 ID 片段」的代码差异。

/** diff 行结果：相等 / 删除（仅本地有）/ 新增（仅 gist 有） */
export type DiffOp =
    | {type: "equal"; text: string}
    | {type: "del"; text: string}
    | {type: "add"; text: string};

/** diff 展示行：类型 + 原文（保留空行占位） */
export interface DiffLine {
    type: "equal" | "del" | "add";
    text: string;
}

/** 相等行折叠时的占位文案（由调用方 i18n 替换，此处给原始插值占位） */
export const DIFF_SKIPPED = "\u0000skipped\u0000";

/**
 * 计算两份文本的行级差异（LCS 回溯）
 * 结果仅包含差异片段：头部相等的 context 行保留（由 diffWithContext 处理折叠）。
 * @param oldText 本地当前文本
 * @param newText gist 待导入文本
 * @returns diff 行序列
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
    // 空文本视为 0 行（直接 split 会得到 [""]）
    const oldLines = oldText === "" ? [] : oldText.split("\n");
    const newLines = newText === "" ? [] : newText.split("\n");

    // 快速路径：完全相同
    if (oldText === newText) {
        return oldLines.map(text => ({type: "equal" as const, text}));
    }
    if (oldLines.length === 0 || newLines.length === 0) {
        // 一侧为空：全删或全增
        const result: DiffLine[] = [];
        for (const text of oldLines) result.push({type: "del", text});
        for (const text of newLines) result.push({type: "add", text});
        return result;
    }

    const n = oldLines.length;
    const m = newLines.length;
    // LCS 长度表
    const dp: number[][] = Array.from({length: n + 1}, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = oldLines[i] === newLines[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    // 回溯生成操作序列
    const ops: DiffOp[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (oldLines[i] === newLines[j]) {
            ops.push({type: "equal", text: oldLines[i]});
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            ops.push({type: "del", text: oldLines[i]});
            i++;
        } else {
            ops.push({type: "add", text: newLines[j]});
            j++;
        }
    }
    while (i < n) {
        ops.push({type: "del", text: oldLines[i]});
        i++;
    }
    while (j < m) {
        ops.push({type: "add", text: newLines[j]});
        j++;
    }
    return ops;
}

/**
 * 生成带上下文的展示序列：仅围绕差异片段保留少量相等行，
 * 长段无差异处折叠为占位（DIFF_SKIPPED，渲染时替换为省略提示）。
 * @param ops diffLines 的原始输出
 * @param context 差异前后保留的相等行数
 * @returns 展示用行序列
 */
export function diffWithContext(ops: DiffLine[], context = 3): DiffLine[] {
    const result: DiffLine[] = [];
    let i = 0;
    while (i < ops.length) {
        if (ops[i].type !== "equal") {
            result.push(ops[i]);
            i++;
            continue;
        }
        // 连续相等块
        let end = i;
        while (end < ops.length && ops[end].type === "equal") {
            end++;
        }
        const equalBlock = ops.slice(i, end);
        const hasChangeBefore = result.length > 0;
        const hasChangeAfter = end < ops.length;

        if (!hasChangeBefore && !hasChangeAfter) {
            // 整个文件无差异
            result.push(...equalBlock);
        } else if (equalBlock.length <= context * 2 + 1) {
            // 相等块较短：全部保留
            result.push(...equalBlock);
        } else {
            // 长相等块：保留开头 context 行与结尾 context 行，中间折叠
            result.push(...equalBlock.slice(0, context));
            result.push({type: "equal", text: DIFF_SKIPPED});
            result.push(...equalBlock.slice(equalBlock.length - context));
        }
        i = end;
    }
    return result;
}
