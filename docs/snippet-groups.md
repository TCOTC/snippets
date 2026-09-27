# 代码片段分组与折叠功能设计

> 状态：**已实施**（2026-09-27），对应 [TCOTC/snippets#20](https://github.com/TCOTC/snippets/issues/20)「代码片段支持分组」。
> 功能已落地（数据层 `517eaa0`、UI `c5f86ce`），本文与当前代码一致。

## 1. 背景与目标

issue #20 提议为代码片段增加分组能力。核心痛点是片段数量多后菜单列表过长、查找困难（用户自述不习惯搜索，现用「注释分隔」手工分段，见 issue 附图）。诉求拆成五点：

1. 支持分组。
2. 分组支持展开 / 折叠。
3. 支持多层分组。
4. 设置可配：默认全部折叠或全部展开。
5. 拖动调整位置依然生效。

讨论过程中作者（TCOTC）反复强调一个硬约束：**片段数据是思源内核原生配置，每条记录只有 `id/name/content/type/enabled` 五个字段（外加 `disabledInPublish`），没有「分组」维度**，且要提防其他插件改写片段 ID 导致分组信息失配（内容指纹 md5 方案已被否决，见第 10 节）。

结论：**插件自持「分组映射文件」保存归属与组序（不动内核记录结构），菜单渲染为一级可折叠分组树；组内顺序以映射中的成员数组为权威，未分组顺序沿用现有单一有序片段数组，从而让第 5 点「拖拽排序依然生效」成立**。多级分组与「常用视图」等形态不在范围内（见第 2.2 节）。

## 2. 范围界定

### 2.1 范围内

- 分组映射：新建 / 重命名 / 删除组；组归属片段；删除组时组内片段并入「未分组」，不删除片段。
- 菜单渲染：分组折叠树（组头 + 组内片段），内置「未分组」兜底；CSS / JS 两个分区各自独立渲染组。
- **按类型独立启用**：某类型存在至少一个用户分组时才按分组渲染并显示该类型的「未分组」；该类型没有用户分组时片段直接平铺（不显示「未分组」标题）。
- 折叠交互：逐组折叠 / 展开；折叠状态与「上次代码片段类型」经**思源内核 localStorage** 单键持久化（`jcsm-uiState`，详见第 5.2 节）。
- 拖拽：组内排序、跨组移动、拖到组头移入该组、拖到「未分组」移出组；**组头可拖拽以调整组间顺序，「未分组」作为占位分组一起参与**。
- 归属兜底：无归属的片段显示在「未分组」；映射引用但列表已不存在的 ID 在读取时**静默剔除**（不弹提示）。
- 键盘：方向键在可见片段间循环；定位到折叠组内片段时**自动展开该组**；左右键切换类型并持久化上次类型。

### 2.2 明确不做

- 多层分组（issue 第 3 点）：弹出菜单落点命中区窄，树形拖拽误判率高，收益低，不做。
- 「名称前缀自动分组」：不做隐式归属，仅可作为将来导出 / 分享的序列化格式，见第 3 节路线 C。
- 「自定义视图 / 常用集」（issue 讨论中作者引用的代码管理器形态）：按用途聚合而非层级收纳，不做。
- 内容指纹（md5）兜底：用户行为不可控、误判成本高、无必要，见第 10 节。
- 「默认折叠状态」设置项、搜索命中自动展开、拖拽悬停展开折叠组、组头可聚焦的键盘树导航、组内「在此组新建片段」入口：均不做。
- 分组信息写回内核原生结构 / 原生 UI 展示（依赖上游改源码，见第 3 节路线 A，作为远期观察项，设计上保证可无损迁移）。


## 3. 前置路线与交互形态对比

### 3.1 数据层路线

| 路线 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| A. 上游原生加字段 | 改思源 kernel，片段记录增加 group 字段 | 最干净，所有插件与原生 UI 可见 | 周期不可控；老数据要迁移；本仓库无法单方面推进 |
| **B. 插件自持分组映射文件（采用）** | 插件 storage 下存 JSON：组 + 组序 + 组内成员 ID | 立即可做；与「插件新增配置文件很正常」（issue 讨论）一致；结构可设计为日后无损迁移到路线 A | 仅本插件可见；ID 被其他插件改写会失配（用第 5.1 节对账规则吸收） |
| C. 名称前缀虚拟分组 | 片段名用「组名/标题」约定，渲染时按前缀聚合 | 零持久化、零冲突、任何 UI 天然兼容 | 只能单层；组序由名称决定不能拖；空组无法表达；改名牵一发动全身 |

### 3.2 交互形态选型

| 形态 | 说明 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| 折叠分组树 | 组头行（折叠箭头 + 组名 + 计数），组内片段缩进，可放置「未分组」 | 总览与收纳兼具；逐组折叠 | 需要扩展现有键盘导航与拖拽判定 | **采用** |
| 分组标签页 / 胶囊筛选 | 顶部一排 chips（全部 / 组一 / 组二…），点击只显示该组 | 单组聚焦清爽、切换成本低（issue 讨论中 su-dabiao 截图形态） | 与「总览 + 折叠」诉求不符；组多时 chips 横向溢出；日常逐项开关被「先选组」打断 | 不做主形态 |
| 自定义视图（白名单） | 新建视图、勾选片段，顶部 tab 切换 | 适合「每天只动其中几个」 | 相当于在分组上再加配置层，成本高；不能替代折叠诉求 | 不做 |
| 名称前缀 | 同路线 C 的视觉化 | 零实现 | 见路线 C | 不做 |

### 3.3 选定方案

采用**折叠分组树**（菜单渲染）；编辑对话框未复用分组渲染，多级分组不做（见第 2.2 节）。

## 4. 核心设计决策

| # | 决策 | 理由 / 说明 |
|---|---|---|
| D1 | 分组信息存插件自有映射文件（组 + 组序 + 组内成员 ID），不改内核 conf.json 片段记录结构 | 原生记录无分组字段；插件新增配置文件是正常行为 |
| D2 | 映射文件放插件 storage（`loadData` / `saveData`），不放 `data/snippets` | 避开本地文件监听（监听目录下 `.css` / `.js` 会被当片段导入）；storage 写入触发内核跨实例推送，天然获得同步通道（文件 `plugin-groups.json`） |
| D3 | **组内顺序以映射文件的成员数组为权威**；未分组顺序沿用全局片段数组序 | 成员数组即组内拖拽结果，拖拽直接重排 `snippetIds`；未分组内排序走 `SnippetStore.move`（全局数组序） |
| D4 | 无归属片段 →「未分组」；映射引用但列表不存在的 ID → **静默剔除** | 防御其他插件改写 / 删除片段；只保证「不丢、不误伤」，不做内容指纹 |
| D5 | 数据分两层：**归属结构**（组 + 成员 + 组序，随插件 storage 跨窗口 / 跨设备同步）与**视图偏好**（逐组折叠状态 + 上次类型） | 视图偏好经**思源内核 localStorage 单键 `jcsm-uiState`** 持久化（写后内核广播，跨窗口一致，见第 5.2 节） |
| D6 | 组绑定片段类型（组带 `type: "css" \| "js"`），CSS / JS 分区各自独立组空间 | 菜单现有 radio 分区按类型过滤，组随分区渲染（并细化为「按类型独立启用」，见 2.1） |
| D7 | 搜索命中时忽略折叠状态，自动展开命中组 | 搜索沿用「给未命中片段加 `fn__none`」的过滤方式，不感知分组折叠 |
| D8 | 组头不放启用开关，只放折叠箭头、计数与组操作 | 避免与片段项 switch 语义混淆；发布逻辑与分组正交（操作按钮桌面端悬浮显示，触摸端常显） |
| D9 | 分组功能与排序配置的关系：**组内顺序恒为用户自定义序**；自动排序不重排组内成员 | 全局自动排序若作用到组内，会每次打开菜单打乱拖拽结果。`sortSnippets` 仅用于平铺渲染，分组渲染按 `snippetIds` 顺序输出 |
| D10 | **未分组以占位分组的形态表达**（id 固定为 `default`，不记录成员），使其可参与组间拖拽排序 | 把「未分组」作为可移动的占位分组（见第 5.1 节） |


## 5. 数据与映射设计

### 5.1 归属结构文件（随插件 storage 同步）

分组经 `saveData("plugin-groups.json", ...)` 落盘，与 `plugin-config.json`（配置）并列。**实际结构是一个纯数组**（无 `schemaVersion` / `order` 包装）：

```json
[
    {
        "id": "20260905120000-abcdefg",
        "type": "css",
        "name": "样式美化",
        "snippetIds": ["20250813161014-se1mend", "20250815083012-x2y3z4"]
    },
    {
        "id": "default",
        "type": "css",
        "name": "",
        "snippetIds": []
    }
]
```

约定（与代码一致）：

- **`snippetIds` 为组内有权威顺序的成员列表**（`domain/snippet-groups.ts` 头注释与 `moveSnippetWithinGroup` 实现）；拖拽组内排序即重排该数组。
- **数组顺序即组头显示顺序**；不再单独存 `order`。
- **未分组用占位分组表达**：`id` 固定为 `default`（常量 `UNGROUPED_GROUP_ID`），`name` 与 `snippetIds` 恒为空；每种类型最多一个。`withUngroupedAnchors` 负责：某类型有真实分组但缺占位时追加到该类型末尾；真实分组被删光时移除占位（菜单据此回退平铺）；已被用户拖到中间的占位保持原位。
- 读取时经 `reconcileGroups` 对账：剔除形状非法的分组、剔除 `snippetIds` 中不存在的片段 id、组内去重；保留空组与未命名组（`name` 允许空串，显示层回退为「未命名分组」）。
- 文件损坏 / 解析失败时回退为空并继续（不阻断菜单打开）；**不做一次性提示**。
- **没有任何真实分组时不保留该文件**：`SnippetGroupStore.save()` 在该情形下经 `removeData` 删除 `plugin-groups.json`（文件本就不存在时内核返回 404，无副作用），菜单回退平铺。该删除同样触发内核 storage 推送，其他实例同步回退。
- 结构文件不含折叠状态（见 5.2）；不含片段代码原文。

### 5.2 视图偏好（思源内核 localStorage）

折叠状态与「上次代码片段类型」合并为**单个键** `jcsm-uiState`，经思源内核本地存储 API 读写（`src/services/ui-storage.ts`）：

```json
{
    "groupCollapsed": { "css.20260905120000-abcdefg": true },
    "snippetsType": "js"
}
```

- 端点：读 `/api/storage/getLocalStorageVal`、写 `/api/storage/setLocalStorageVal`、卸载清理 `/api/storage/removeLocalStorageVal`（均为**单数**端点，单键操作）。
- 折叠映射只记录**折叠为 true** 的项（缺省视为展开）；键为 `"<css|js>.<分组 id|default>"`。
- 写入时机：点击组头折叠、方向键自动展开、切换类型。读取时机：**打开菜单时与片段列表并发拉取**（`Promise.all`）。
- 存储位置不在插件数据目录，因此**卸载时必须显式 `removeLocalStorageVal`**（`index.ts` 的 `uninstall` 已处理）；删除分组时同步移除该组的折叠键，避免残留。

### 5.3 与现有排序方式的兼容

`sortSnippets`（`src/domain/snippet.ts`）的自动排序**仅作用于平铺渲染**（无用户分组的类型，或整个菜单无分组时）；分组渲染按其 `snippetIds` / 未分组的全局数组序输出，不受 `snippetSortType` 影响（D9）。


## 6. 交互规格

### 6.1 菜单渲染层级

沿用现有 `SnippetsMenu` 结构（`.jcsm-top-container` 顶部区 + `.jcsm-snippets-container` 列表容器）。**是否分组由数据决定，无独立开关**：`isGroupedView()` = 分组缓存中存在至少一个真实分组（排除 `default` 占位）。`genGroupedMenuHtml` **按类型逐个判断**：

- 该类型**无**用户分组 → `genTypePlainItems` 平铺输出该类型片段，不显示「未分组」标题。
- 该类型**有**用户分组 → 按 `groups` 顺序输出各区段；`default` 占位在其中的位置即「未分组」区段的位置（若缓存未补占位则兜底渲染在末尾）。

区段与组头：

- 组头：折叠箭头（思源 `#iconRight`，展开旋 90°、折叠 0°）+ 组名（空名回退「未命名分组」）+ 计数徽标 + 操作区（重命名 / 删除）。操作区默认隐藏（`.jcsm-group-action`），**桌面端悬浮组头时显示**，触摸设备组头带 `jcsm-touch` 常显；按钮位于计数左侧、计数贴右。
- 组头**不使用 `b3-menu__item` 类**（避免被菜单选中高亮 `b3-menu__item--current` 命中与菜单项样式干扰）；片段行仍为 `jcsm-snippet-item b3-menu__item`。
- 组内片段行：与现状一致的 `jcsm-snippet-item`（名称、编辑 / 复制 / 删除按钮、发布开关、启用开关），缩进一级。
- 「未分组」区段：结构同组头但不提供重命名 / 删除。
- 新建分组入口在**菜单顶栏的「分组」按钮**（`data-type="group"`，图标 `#iconGroups`，位于重载与新建按钮之间），点击即为当前分区类型新建分组；无分组时创建首个分组即进入分组视图。

### 6.2 折叠与持久化

- 点击组头整行切换折叠（组头操作按钮单独处理，不触发折叠）。
- 折叠仅隐藏组内片段（`.jcsm-group-items { display: none }`），不销毁 DOM。
- 折叠状态与上次类型存于思源内核 localStorage 单键 `jcsm-uiState`（见 5.2），**跨窗口一致**；无「默认折叠状态」设置项，缺省视为展开。

### 6.3 拖拽语义（`MenuDragSort` 扩展）

- 片段项：拖到组内片段间隙 → 组内排序（重排该组 `snippetIds`）；拖到其它组内片段 → 跨组移入后按目标位置排序；拖到组头 → 移入该组（追加组尾）；拖到「未分组」头 → 移出所在组；拖到未分组成员 → 移出并按目标位置调整**全局数组序**（未分组排序源）。
- 组头：可拖拽调整**组间顺序**（`domain` 的 `moveGroup`），「未分组」占位与真实分组一样参与排序（可拖到任意组之间）。
- 分组视图与平铺视图共用 `MenuDragSort`：仅当 `isGroupedView()` 且拖拽源/目标位于 `.jcsm-group-section` 内才走分组逻辑，否则走原有平铺数组排序。
- 组归属变更只改 `plugin-groups.json`（不动内核片段记录结构）；**未分组内的数组序变动**才经 `SnippetStore.move` 落库并广播 `snippets_sort`。

### 6.4 键盘导航

- `↑` / `↓`：在当前类型的**可见**片段项间循环；`selectMenuItem` 在选中前若该项位于折叠分组内会**自动展开该组**（并持久化展开态），保证被选中项可见。
- `←` / `→`：切换 CSS / JS 类型，并把上次类型写入 `jcsm-uiState`。
- 键盘导航不涉及组头：组头不可聚焦，无 `→` 展开 / `←` 折叠树操作。

### 6.5 搜索协同

搜索沿用「计算命中 id 集合 → 给未命中片段项加 `.fn__none`」的过滤方式，分组结构不参与；搜索不感知分组折叠状态（亦不自动展开命中组）。

### 6.6 新建与空态

- 顶部「+」新建：类型取菜单当前分区；新片段默认不在任何分组（落入未分组）。
- 某类型无任何片段时显示「添加第一个 CSS / JS 代码片段」空态入口：平铺模式沿用旧逻辑（恒生成、由 CSS 按兄弟关系隐藏）；分组模式下仅在该类型确实无片段时才生成。
- 文件监听（`data/snippets`）与导入产生的片段一律进「未分组」，不从文件名推断（D4）。
- 组头不提供「在此组新建片段」入口，新建统一落入未分组。


## 7. 关键问题与结论

| # | 问题 | 最终结论 |
|---|---|---|
| O1 | 自动排序（enabled / fileName 类）与「组内自定义序」如何共存 | 自动排序只作用于**平铺渲染**；分组渲染按 `snippetIds` / 未分组全局序输出，不重排组内 |
| O2 | 空组是否默认保留 | 保留（删除组是显式动作，空组可存在） |
| O3 | 折叠状态跨窗口是否一致 | **跨窗口一致**（思源内核 localStorage，写后内核广播；见 5.2） |
| O4 | 组操作广播：走插件 storage 跨实例推送（`onDataChanged`）还是扩展 `sync.ts` 广播协议 | 复用 storage 通道（`onDataChanged`），不扩展 `sync.ts` 协议（见第 8 节） |
| O5 | 分组功能的启用开关 | **无开关**：存在真实分组即启用，删光即回退平铺 |


## 8. 跨窗口与跨设备同步

- **归属结构**（`plugin-groups.json`）：经 `saveData` 写插件 storage，内核 `PushPluginStorageDataChanged` 推送给其余实例（排除发起者自身，`SIYUAN_APPID` 每实例随机）。本插件在 `index.ts` 的 `onDataChanged` 中重新 `loadData` → 对账 → `SnippetsMenu.refreshSnippetsContainerAfterExternalChange()` 重建已打开菜单。
  - **重要**：重建判定**不得以 `isGroupedView()` 为门槛**。删除最后一个真实分组后 `isGroupedView()` 变为 false，若据此跳过重建，其他实例会残留已分组的旧界面——这是曾出现的「删除分组未同步」缺陷的根因，现由 `refreshSnippetsContainerAfterExternalChange` 统一处理（只要 `menuItems` 存在就重建，由 `initSnippetsContainer` 自行选择分组/平铺）。
- **视图偏好**（折叠状态、上次类型）：经内核 localStorage 单键 `jcsm-uiState` 持久化；`setLocalStorageVal` / `removeLocalStorageVal` 由内核向其余会话广播，跨窗口一致。
- 本窗口：组操作后 `saveData` 写回 → 就地重建菜单；折叠/类型切换就地更新缓存并异步落库。
- 不扩展 `sync.ts` 广播协议：归属结构变更频率远低于片段增删，storage 推送已够。注意沿用既有约束：任何跨实例通道不得携带片段代码原文（分组文件/视图偏好均只含 ID 与元数据，天然合规）。

## 9. 现有架构集成点（代码事实）

| 模块 | 位置 | 与本功能的关系 |
|---|---|---|
| 片段模型 | `src/types.d.ts` `Snippet { id, name, content, type, enabled, disabledInPublish? }` | **不改**；分组是映射层叠加 |
| 分组纯逻辑 | `src/domain/snippet-groups.ts` | `SnippetGroup`、`UNGROUPED_GROUP_ID`、`withUngroupedAnchors`、`moveGroup`、`reconcileGroups`、`ungroupedSnippetIds`、`assign/unassign/moveWithinGroup`、`add/rename/removeGroup` 等 |
| 分组持久化 | `src/services/snippet-groups.ts` `SnippetGroupStore` | `load(snippets)`（对账 + 补齐占位）/ `save()`（有真实分组时 `saveData` 写入，否则 `removeData` 删除文件），落 `plugin-groups.json` |
| 视图偏好持久化 | `src/services/ui-storage.ts` `SnippetUiStorage` | 单键 `jcsm-uiState`：`load` / `saveGroupCollapsed` / `saveSnippetsType` / `clear` |
| 列表缓存与单一写路径 | `src/domain/snippet-store.ts` `SnippetStore` | 未分组内排序 / 增删继续走它；分组归属只改分组文件 |
| 排序纯函数 | `src/domain/snippet.ts` `sortSnippets` / `filterSnippetsByKeyword` / `snippetTitle` | 仅平铺渲染用；搜索过滤沿用 |
| 菜单渲染 | `src/ui/menu.ts` | `isGroupedView` / `genGroupedMenuHtml` / `genTypePlainItems` / `genGroupSectionHtml` / `genUngroupedSectionHtml`（组头用 `#iconRight` 箭头与 `.jcsm-group-action` 操作区、不带 `b3-menu__item`）；顶栏 `data-type="group"` 分组按钮；`addGroup` / `renameGroup` / `deleteGroup` / `commitGroups`；`refreshSnippetsContainerAfterExternalChange` |
| 拖拽 | `src/ui/menu-drag-sort.ts` `MenuDragSort` | 片段项：组内 / 跨组 / 移入组头 / 移出未分组；组头：组间排序（`moveGroup`，占位 `default` 参与） |
| 对话框 | `src/ui/snippets-dialog.ts` | 新增通用输入框对话框 `openPrompt`（分组新建 / 重命名，`data-key="jcsm-group-input"`）；删除确认走既有 `openConfirm`（`jcsm-group-delete`） |
| 配置 | `src/config/config.ts` / `config-service.ts` | 分组功能**无配置项**；分组文件独立于 `plugin-config.json` |
| 生命周期 | `src/index.ts` | `onload` 实例化 `snippetGroupStore` / `uiStorage` 并预载分组；`onDataChanged` 重载分组并重建菜单；`uninstall` 删除插件数据目录 + `uiStorage.clear()` 移除本地存储键 |
| 文件监听 | `src/services/file-watch.ts` | 分组文件不落 `data/snippets`（D2） |
| i18n | `src/i18n/{en,ja,zh-CN,zh-TW}.json` | 分组键：`groupNew` / `groupRename` / `groupDelete` / `groupUngrouped` / `groupEmptyName` / `groupNamePlaceholder` / `groupNewTitle` / `groupRenameTitle` / `groupDeleteDescription` / `groupNameRequired` |

## 10. 风险与已否决方案备忘


- **内容指纹（md5）兜底（已否决）**：issue 讨论中曾提出「id + 根据类型 / 描述 / 代码计算的 md5」判定同片段，避免其他插件改 ID 后失配。否决理由与讨论一致：用户行为不可控、同名片段误判、防御成本高于实际收益；按 D4 的「归未分组 + 静默剔除」已覆盖核心诉求（不丢片段）。
- **名称前缀自动分组（否决为主方案）**：见路线 C 缺点；若用户习惯已用「注释分隔」，可提供一次性「按注释 / 前缀导入为分组」的迁移助手作为可选增强，不做常驻逻辑。
- **多级分组（延期）**：菜单垂直空间与拖拽落点命中率不支持可靠树拖拽；一级分组 + 未分组已覆盖 issue 截图所示实际用法。
- **其他插件直接改片段归属**：`plugin-groups.json` 被外部改写时，读取时经 `reconcileGroups` 剔除非法项与孤儿 id；其他插件直接改 `conf.json` 顺序时，未分组顺序随之变化，但分组按 `snippetIds` 匹配仍能正确聚组且组内顺序稳定。
- **菜单性能**：折叠用 `fn__none` 隐藏而非移除 DOM，片段极多（数百）时组头行轻量、单次渲染可控；若实测卡顿再改懒渲染。

## 11. 附录：issue 讨论要点回顾

| 参与者 | 观点 | 本文对应 |
|---|---|---|
| Hug-Zephyr（提出者） | 代码多列表长；分组 + 折叠 + 默认态 + 拖拽不丢；可用注释分隔 | 第 1 节五点诉求 → 第 6 节交互规格 |
| TCOTC（作者） | 原生记录无分组字段难实现；插件自持文件可行但防其他插件搞坏；引「代码管理器」过滤视图思路 | 第 3 节路线对比；第 5.1 节对账 |
| su-dabiao | 参考某插件做「顶部按钮按组过滤隐藏」 | 第 3.2 节「分组标签页」备选（非主方案） |
| Hug-Zephyr | 新 ID 归未分组、孤儿提示即可；md5 方案容易有 bug | 第 5.1 节、第 10 节 |
