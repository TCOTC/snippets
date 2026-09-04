// 允许副作用导入 SCSS 样式文件（由 webpack/css-loader 处理）
// 注意：必须放在无顶层 import/export 的脚本声明文件中——TypeScript 6.0 起，
// 模块化 .d.ts 内的通配符 declare module 不再作为全局 ambient 声明生效（TS2882）
declare module "*.scss";
