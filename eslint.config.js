// ESLint 10 扁平化配置（flat config）
// 迁移自原 .eslintrc.js，配置项语义保持一致
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const globals = require("globals");

module.exports = tseslint.config(
    {
        ignores: [
            "node_modules/**",
            "dist/**",
            "index.js",
            "index.css",
            "old-js.js",
            "package.zip",
            ".eslintcache",
            "i18n/**",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        // src 下的 TypeScript 源码（浏览器 + Node 双端全局）
        files: ["src/**/*.ts"],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            semi: ["error", "always"],
            quotes: ["error", "double", {"avoidEscape": true}],
            "no-async-promise-executor": "off",
            "no-prototype-builtins": "off",
            "no-useless-escape": "off",
            "no-irregular-whitespace": "off",
            // 以下规则为 eslint/ts-eslint 新大版本才启用，旧版并不强制，属既有惯用写法，予以关闭以维持原基线
            "no-useless-assignment": "off",
            "no-unused-expressions": "off",
            "@typescript-eslint/no-unused-expressions": "off",
            "preserve-caught-error": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    "caughtErrors": "none",
                    "argsIgnorePattern": "^_",
                    "varsIgnorePattern": "^_",
                },
            ],
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-var-requires": "off",
            "@typescript-eslint/no-require-imports": "off",
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
    {
        // 工程级 CommonJS 配置文件（webpack 等）
        files: ["*.config.js", "webpack.config.js", "eslint.config.js"],
        languageOptions: {
            sourceType: "commonjs",
            globals: globals.node,
        },
        rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-require-imports": "off",
        },
    }
);
