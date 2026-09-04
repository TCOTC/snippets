// Vitest 配置：单测统一 Node 环境
// - siyuan 包仅为纯类型包（见 node_modules/siyuan/package.json，无运行时 JS 入口），
//   源码在 webpack 构建时经 externals 由思源宿主提供；测试环境经 alias 指向 mock
//   （tests/mocks/siyuan.ts），使 import "siyuan" 的模块可被加载并注入可控桩。
// - alias 目标为相对路径（相对 Vite root，即本配置所在目录）。
// - 测试文件与被测源码同目录放置（*.test.ts），tsconfig/eslint 已覆盖 src 全量。
import {defineConfig} from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            siyuan: "./tests/mocks/siyuan.ts",
        },
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        restoreMocks: true,
    },
});
