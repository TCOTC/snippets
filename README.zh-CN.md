[繁體中文](https://github.com/TCOTC/snippets/blob/main/README.zh-TW.md) | [English](https://github.com/TCOTC/snippets/blob/main/README.md) | [日本語](https://github.com/TCOTC/snippets/blob/main/README.ja.md)

#### 代码片段管理菜单

如何打开：

- 桌面端：点击顶栏插件按钮，打开管理菜单
- 移动端：点击右侧栏中的插件选项，打开管理菜单

功能：

- 添加、编辑、删除、启用、禁用、搜索代码片段
- 重新加载界面
- 打开插件设置

#### 代码片段编辑器

如何打开：

- 点击管理菜单中的代码片段选项的编辑按钮

功能：

- 编辑代码片段标题、内容
- 实时预览 CSS 代码片段
- 添加、删除代码片段
- 集成 CodeMirror 6 代码编辑器
  - 行号显示
  - 语法高亮
  - 括号匹配
  - 搜索替换

#### 本地文件监听

如何打开：

- 在管理菜单的顶部点击插件设置按钮，打开设置，在设置中开启本地文件监听

功能：

- 持续监听指定文件夹下的代码片段文件，当文件发生变化时，自动加载到界面
- 不持续监听，仅在启动时加载一次所有代码片段文件

---

#### 插件更新日志

##### v1.4

- 支持跨窗口应用样式 [#23](https://github.com/TCOTC/snippets/issues/23)
- 代码片段编辑器添加右键菜单 [#22](https://github.com/TCOTC/snippets/issues/22)
- 增加代码片段的发布服务开关（思源 v3.3.2 之后可用）[#30](https://github.com/TCOTC/snippets/issues/30)
- 支持配置管理菜单默认显示标签页类型 [#34](https://github.com/TCOTC/snippets/issues/34)

##### v1.3

- 管理菜单支持调整代码片段排序 [#17](https://github.com/TCOTC/snippets/issues/17)
- 在代码编辑器中使用任何快捷键都不再触发思源原生操作 [#19](https://github.com/TCOTC/snippets/issues/19)
- 保存无效的 JS 时弹出提示、避免代码中的 HTML 标签破坏 DOM 结构 [#21](https://github.com/TCOTC/snippets/issues/21)
- 顶栏按钮支持配置在左侧或者右侧（需要思源版本 >= 3.3.0） [#11](https://github.com/TCOTC/snippets/issues/11)

##### v1.2

- 支持禁用“同时打开多个代码片段编辑器” [#15](https://github.com/TCOTC/snippets/issues/15)
- 支持配置“点击代码片段选项的行为” [#16](https://github.com/TCOTC/snippets/issues/16)

##### v1.1

- 支持导出导入所有代码片段 [#7](https://github.com/TCOTC/snippets/issues/7)
- 代码片段未命名时，菜单项标题显示代码片段的前 200 个字符 [#8](https://github.com/TCOTC/snippets/issues/8)
- 支持自动重新加载界面 [#12](https://github.com/TCOTC/snippets/issues/12)