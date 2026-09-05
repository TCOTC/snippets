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

##### v2.0

- 支持使用 Prettier 格式化 CSS 和 JS 代码片段 [#3](https://github.com/TCOTC/snippets/issues/3)
- 重构插件代码 [#28](https://github.com/TCOTC/snippets/issues/28)
- 导入代码片段后立即应用并广播到其他窗口 [#31](https://github.com/TCOTC/snippets/issues/31)
- 改进代码片段数据状态同步 [#32](https://github.com/TCOTC/snippets/issues/32)
- 支持从 GitHub Gist 导入、发布到 Gist [#36](https://github.com/TCOTC/snippets/issues/36)
- 取消关闭代码编辑器时补触发待定的 JS 代码片段自动重载 [#40](https://github.com/TCOTC/snippets/issues/40)
- 适配思源 v3.7.0 CSS 片段异常检查 [#43](https://github.com/TCOTC/snippets/issues/43)
