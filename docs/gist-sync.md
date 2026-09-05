# Gist 导入 / 发布功能设计

> 状态：**已实施**（v1 范围落地：Token 加密存储 / 从 Gist 导入 / 发布到 Gist），对应 [TCOTC/snippets#36](https://github.com/TCOTC/snippets/issues/36)「支持从 gist 导入/同步到 gist」。
> 目标版本：snippets 2.x。Token 保存使用独立库 [siyuan-token-vault](https://github.com/TCOTC/siyuan-token-vault)（v0.1.1+）。

## 0. 实施记录

- M1（Token）：`siyuan-token-vault` 依赖 + `GistTokenService`（src/services/gist-token.ts）密文落盘；设置面板新增 GitHub Token 管理区域（保存/清除/状态，明文不回显）；Token 不经 configItems valueItems、绝不写入 plugin-config.json。
- M2（导入）：`src/services/gist.ts`（REST 客户端 + URL 解析 + 错误归一）、`src/services/gist-sync.ts`（文件 ↔ 片段映射、conf 单文件特例、raw 超限兜底）、`src/ui/gist-dialog.ts`（导入预览勾选对话框，merge / overwrite / fork 三模式，经 `ImportExportService.importSnippetsFromData` 复用落库管道）；文件名 ID 解析与三模式规划为纯逻辑（domain/gist-file.ts、domain/import-plan.ts）。
- M3（发布）：`buildPublishFiles`/`planUpdateFiles`/`validatePublishSnippets` 纯逻辑 + `publishToGist`（新建或更新镜像、PATCH 同 ID 重命名/未勾选删除）；发布对话框（筛选/勾选清单、secret/public/更新上次目标、public 与删除旧文件二次确认、成功链接）；发布目标记忆存独立状态文件。
- 交互与设计差异（与正文不一致处以本节为准）：发布更新目标不可改可见性（GitHub PATCH 不支持），新建时才选 secret/public；conf 特例保留原 id 与 enabled（本地 JSON 导入语义一致）；成功消息含新增/更新计数。

## 1. 背景与目标

issue #36 提议让用户通过 GitHub Gist 共享自己编写的代码片段：他人贴一个 gist 链接即可导入，自己也可以把片段发布为 gist 分享。本设计把「同步」落定为**手动方向性操作**（发布 push / 导入 pull），不做云端自动双向同步（理由见第 10 节）。

目标：

- 支持**从 Gist 导入**片段集合（公开 gist 匿名可读；secret gist 与更高限流需配置 Token）。
- 支持**发布片段集合到 Gist**（新建或更新已有 gist，secret 或 public）。
- Token 以密文形式保存在本插件数据目录（复用 siyuan-token-vault，与 install-package 同款机制），绝不写入随配置同步的明文配置文件。

## 2. 范围界定

### 2.1 范围内（v1）

- 设置面板中管理 GitHub Token（保存 / 清除 / 状态显示）。
- 从 Gist 导入：粘贴 gist 链接或 id → 解析文件（含从文件名提取片段 ID）→ **预览并勾选要导入的片段** → 合并更新 / 覆盖镜像 / 仅新增三种模式导入。
- 发布到 Gist：**勾选要发布的片段**并选择可见性 → 新建 gist；或更新「上次发布的 gist」/ 手动指定的 gist（同名文件覆盖更新）。
- 网络与限流错误的人性化提示；Token 引导。

### 2.2 明确不做（v1 之外，避免范围蔓延）

- 云端双向自动同步、变更监听、定时轮询（与插件「内核 conf.json 为权威、手动导入导出」的理念冲突，且需引入云端冲突仲裁）。
- Gist 评论、星标、fork、历史版本浏览。
- 二进制 / 图片资源上传（Gist 不适合承载片段之外的文件）。
- 移动端专用交互（沿用现有「设置面板按钮」形态，移动端可访问设置即可用，交互细节后续评估）。

## 3. 核心设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 一个 Gist = 一个片段集合（多文件），映射为 conf.json 同构的 `Snippet[]` | 与现有导入导出管道天然对齐；一个 gist 分享一组脚本更符合直觉 |
| D2 | 同步 = 手动「发布」与「导入」；无自动双向 | 见第 10 节 |
| D3 | Token 存 vault 密文，独立于 plugin-config.json | plugin-config.json 会随跨窗口/跨设备同步明文传播，Token 绝不能进 |
| D4 | Token 输入项为 `createActionElement` 自定义元素，**不是** valueItem | 不进 `saveFromDialog`/`persistConfig` 收集路径，天然不被同步、不被热应用覆盖 |
| D5 | 发布目标记忆（上次发布的 gist id）存独立状态文件，不混入 plugin-config.json | persistConfig 只落 valueItems，自定义字段会被覆盖丢弃 |
| D6 | 导入的片段身份判定优先按 ID（文件名携带或 conf JSON 内携带）；无 ID 文件一律视为新片段（重生成 ID） | ID 是强身份信号：同 ID 即同一片段，可安全覆盖更新；无 ID 时不做任何猜测性覆盖（见 D10） |
| D7 | 网络请求用浏览器 `fetch` 直连 GitHub API | 实测 CORS 全放行；桌面端 `webSecurity:false` 无 CSP 限制，无需内核代理接口 |
| D8 | 发布默认 secret，public 需显式二次确认 | secret ≠ 私有，公开前必须提醒内容可能含敏感信息 |
| D9 | 上传侧覆盖 = **清洗后文件名（含片段 ID 段）覆盖**；更新 gist 以勾选集为镜像（未勾选的旧文件删除） | 文件名携带 ID 后即为稳定身份标识；镜像语义最可预期 |
| D10 | 下载侧只有**带 ID 的文件**才参与「同 ID 覆盖更新」；无 ID 文件（旧 gist/手工 gist）一律按新片段导入，不按名称/内容猜测覆盖 | 本地同名 ≠ 同一片段（用户可能重构）；ID 缺失时做自动覆盖会误伤本地数据 |
| D11 | 发布侧文件名约定 `<清洗后名称> <片段ID>.<ext>`（思源生态同款命名，如 `我的样式 20250813161014-se1mend.css`） | 纯代码 gist 也能携带 ID：每个文件即一段代码（可读性不损），下载侧用尾部正则提取 ID；与思源 `.sy` 文档命名一致 |
| D12 | 发布**恒带 ID**，不提供「文件名不含 ID」的开关 | 去掉 ID 即失去合并更新识别能力、引入格式分叉；文件名略长是必要代价，用开关换分叉不值得 |

## 4. 现有架构集成点（代码事实）

| 模块 | 位置 | 与本功能的关系 |
|---|---|---|
| 片段模型 | `src/types.d.ts` `Snippet { id, name, content, type: "css"\|"js", enabled, disabledInPublish? }` | Gist 文件 ↔ Snippet 映射的目标模型 |
| 导入导出服务 | `src/services/import-export.ts` | 复用 `validateImportData`/`processImportedSnippets`/`createBackup`/`saveSnippetsList`/`applyImportedSnippets` 管道；现有入口为本地文件选择 |
| 设置项声明 | `src/config/config-service.ts` `createSnippetsConfigItems` + `createOutlineActionElement` | 新增动作按钮（导出/导入按钮同款模板） |
| 设置按钮分发 | `src/ui/setting-dialog.ts` `dialogClickHandler` 按 `data-action` 分发 | 新增 gist 动作的 action 分支 |
| 对话框基建 | `src/ui/snippets-dialog.ts` + `src/utils.ts`（`attachDialogObject`/`setDialogKeyHandler`/Dialog 协调） | 新对话框须走统一模态协调（data-key 以 `jcsm-` 开头，接入 `getAllModalElements`/`closeByElement`） |
| 反馈/错误 | `src/services/feedback.ts`（`showErrorMessage` 等） | 网络/API 错误提示 |
| 配置热应用 | `ConfigService.onDataChanged` → `applyConfig` | 约束：Token 相关不能出现在 `valueItems` 中 |
| i18n | `src/i18n/{en,ja,zh-CN,zh-TW}.json`（2 空格缩进） | 新增键四语言同步 |

## 5. 数据与映射设计

### 5.1 Gist 文件 → Snippet 映射（导入方向）

对 gist 的 `files` 对象（key 为文件名，value 含 `content`/`truncated`/`raw_url`）：

1. **文件名解析（身份提取）**：按 D11 约定，带 ID 的文件名形如 `<名称> <片段ID>.<ext>`。从文件名尾部用正则提取 ID：`/^(.*) (\d{14}-[0-9a-z]{7})\.(css|js|mjs|cjs)$/`（思源 `Lute.NewNodeID` 形态，见 `src/utils.ts genNewSnippetId`）。提取成功 → 该文件**带 ID**：`id = 捕获组 2`、`name = 捕获组 1`；失败 → 普通文件：`name = 文件名去扩展名`、无 ID。
2. 逐个文件推断类型：扩展名 `.css` → css；`.js/.mjs/.cjs` → js；其余（含无扩展名）默认 css（与 `config.defaultSnippetsType` 一致），可在预览对话框改为 js。
3. `enabled = false`：**新增**的片段默认不启用，避免「导入即执行」他人代码；同 ID **更新**本地既有片段时不改动本地 enabled（见 5.4）。
4. `content` 超 1MB 被 GitHub 截断（`truncated: true`）时：额外请求 `raw_url`（gist.githubusercontent.com，CORS 已放行）取全文；仍失败则跳过该文件并提示。
5. **单 JSON conf 特例**：若 gist 恰好只有 1 个文件且内容解析为 `Snippet[]`（含 `id/name/content/type/enabled` 结构），则视为「导出的 conf.json」，按 JSON 内片段逐条处理（每条 id 即身份，规则与 5.4 相同），与用户从本插件导出的 gist 完全兼容。
6. 预览对话框对每个文件给出：文件名、**识别出的 ID（带 ID 则显示，否则标记「无 ID」）**、推断类型（可改）、大小、是否包含（复选框，默认 css/js 勾选）、**导入动作**（新增 / 更新本地同 ID 片段 / 覆盖镜像中删除）。勾选结果决定导入集合（见 8.3）。

### 5.2 Snippet → Gist 文件映射（发布方向）

1. 文件名 = `<清洗后 name> <片段ID>.<ext>`（D11；name 为空时以 `snippet` 占位）。例：片段 `{ name: "我的样式", id: "20250813161014-se1mend", type: "css" }` → `我的样式 20250813161014-se1mend.css`。
2. name 清洗：替换文件系统/Gist 不允许的字符（`/ \ : * ? " < > |` 与首尾空白）为 `-`；清洗后名称末尾若恰与 ID 段形态相撞（极罕见），追加 `-` 避免解析歧义；名称截断需为 ID 段预留空间（`22 字符 ID + 空格 + 扩展名`，建议整名 ≤ 80 字符）。清洗有损，round-trip 不保证逐字一致，属可接受。
3. **ID 段不可清洗、不可截断**：它承载片段身份；名称部分用户可随意改动（改名后再发布 = gist 内该片段「重命名」而非「删除+新建」，见 8.2 第 4 点）。
4. 单片段内容 > 1MB：拒绝发布并提示拆分（Gist 超限会被截断，静默失败体验差）。
5. 片段数量 > 300：拒绝并提示精简（Gist 整体截断上限）。

### 5.3 状态文件（发布目标记忆）

- 存储键：`gist-publish-state.json`（经 `plugin.loadData/saveData` 独立读写，**不放入 plugin-config.json**）。
- 内容：上次发布的 `{ gistId, public, publishedAt, fileCount, snippetCount }`，用于发布对话框默认「更新该 gist」。不含任何片段内容与 Token。
- 跨设备语义：不随配置同步；另一台设备上该键为空时，用户粘贴 gist id 即可更新（见 8.2）。

### 5.4 覆盖语义与片段身份（要不要用 ID：用，编码进文件名）

**结论**：采纳「文件名带 ID」（D11），且**发布恒带 ID、不提供去 ID 开关**（D12）：去掉 ID 即失去合并更新识别能力并引入格式分叉，文件名略长的代价换取格式的唯一性，值得。这让「上传相同片段覆盖、下载相同片段覆盖」对**纯代码多文件 gist** 也成立，且不引入 manifest 附加文件、不损代码可读性。

ID 就是片段身份（思源 `Snippet.id`，由 `Lute.NewNodeID` 生成，稳定唯一）。它：

- **上传时随文件名写入**：`<名称> <id>.<ext>`，PATCH 以完整文件名（含 ID）为键覆盖更新；
- **下载时从文件名提取**：尾部正则识别，提取成功即获得该片段身份；
- **改名不丢身份**：片段重命名后重新发布，ID 段不变 → gist 侧表现为同一文件的「重命名」（GitHub PATCH 支持 `filename`），下载侧仍识别为同一片段。

**为什么无 ID 文件绝不猜测覆盖**：本地同名 ≠ 同一片段（用户可能重构）；无 ID 时按名称/内容做自动覆盖会静默覆盖本地新内容，违背「不主动破坏本地数据」原则。因此无 ID 文件（旧版发布的 gist、手工整理的 gist）一律作为**新片段**导入（重生成 ID）。

**下载的三种目标模式**（交互见 8.3；判定规则对所有来源一致）：

| 模式 | 语义 | 典型场景 |
|---|---|---|
| **合并更新（默认）** | 逐片段按 ID 判定：带 ID 且本地**同 ID** → 用 gist 内容更新该片段的 name/content/type，**保留本地 enabled 与排序**；本地无此 ID 或文件无 ID → 作为**新增**片段（enabled=false）；本地独有片段保留 | 设备间自同步、拉取作者最新版（同 ID 覆盖更新正是你的诉求） |
| **覆盖镜像** | 导入集合整体替换本地（先备份），以 gist 为唯一事实源 | 「恢复到 gist 状态」/ 迁移 |
| **仅新增（fork）** | 忽略文件名的 ID，全部作为新片段导入并重生成 ID | 想把别人的片段变成自己独立的一份、不再追更 |

**设备间自同步为何成立**：设备 A 发布片段（文件名带 A 机器上生成的 ID）→ 设备 B 合并更新导入（同 ID 识别为同一片段，即使 B 本地名字不同）→ B 修改后再发布更新同一 gist → A 合并更新拉回 → 同 ID 精确覆盖。**ID 全程稳定，唯一断点只可能是双向各自修改后的手动取舍**——这正是第 10 节所述不做自动双向同步的原因。

**保留的「本地 vs 远端」取舍规则**：同 ID 覆盖更新时，远端（gist）提供代码内容与名称，本地保留运行偏好（enabled/disabledInPublish）与排列位置；若用户希望连 enabled 一起对齐（例如恢复镜像），用「覆盖镜像」模式。

**向后兼容**：发布格式从 v1 起即带 ID；对已存在的、不带 ID 的 gist，导入时全部按「新增」处理，不误伤本地；用「覆盖镜像」可整体替换。

## 6. Token 管理设计

### 6.1 保存机制（复用 siyuan-token-vault）

```ts
import {createTokenVault, seedFromSiyuanSystem} from "siyuan-token-vault";

// onload 后首次需要时初始化一次并缓存 vault 实例（模块级单例，仿 install-package 迁移后的 setting.ts）
const seed = seedFromSiyuanSystem(window.siyuan.config.system);
const vault = createTokenVault({
    seed,
    // dir 省略即默认 "secret"，落盘 data/storage/petal/snippets/secret/token_<hash>.dat
    storage: {
        save: (name, content) => plugin.saveData(name, content),
        load: async (name) => {
            const data = await plugin.loadData(name);
            return typeof data === "string" && data.trim() ? data : null;
        },
        remove: (name) => plugin.removeData(name),
    },
});
```

- 生命周期：`onload` 中异步 `await vault.loadToken()` 预热缓存（失败静默：无文件视为未配置，密文损坏提示重配）；`onunload` 中 `vault.clear()` 只清内存，不删密文。
- 与 install-package 的关系：各自存在各自插件数据目录的 `secret/` 下，**互不共享**——用户需在两个插件分别配置一次 Token（隔离清晰、卸载干净；vault 库预留 `dir` 参数，将来如需共享可另做公共目录方案）。
- 多窗口同内核：每个前端窗口是独立插件实例、各自 `loadToken()` 解密出明文缓存，均为同一份密文，行为一致。
- Token 仅存内存用于构造 `Authorization` 请求头；日志、通知、i18n 文案一律不出现 Token 本体。

### 6.2 设置项形态

- 新增一个 `createActionElement` 配置项「GitHub Token」，**不含 key/value，不出现在 valueItems**：
  - 密码输入框（`type=password` + 眼睛切换，沿用 install-package 的 `#secretKey` 交互模式）+「打开 GitHub Token 创建页」链接按钮（classic PAT，指引勾选 `gist` scope）+「保存」/「清除」按钮 + 状态文案（未配置 / 已配置，不明文回显——输入框留空表示清除）。
  - 按钮事件直接绑定 vault 读写，**不经 `saveFromDialog`**；该元素上的数据属性用独立命名空间（如 `data-gist-token-action`），避免与现有 `data-action` 分发冲突。
- 引导文案明确：需 classic Token 且至少勾选 `gist` scope（fine-grained 的 Gists 账户权限受限，指引按 classic 写）。

## 7. GitHub API 客户端设计

新增 `src/services/gist.ts`，纯函数/薄类，全部请求经注入的 `fetch`（便于单测 mock），统一：

| 端点 | 用途 | 鉴权 |
|---|---|---|
| `GET /gists/{id}` | 拉取 gist 元数据与文件内容 | 公开匿名可读；secret 需 Token |
| `POST /gists` | 新建 | Token |
| `PATCH /gists/{id}` | 更新（全量替换 files） | Token |

- URL/id 解析：接受 `https://gist.github.com/<user>/<id>`、`https://gist.github.com/<id>`、裸 id；正则提取。
- 公共请求头：`Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28`、有 Token 时 `Authorization: Bearer <token>`。
- 错误归一（参考 `settleWriteResponse` 的归一风格，返回结构化结果）：
  - 401 → Token 无效/过期：提示「重新配置 Token」。
  - 403 + 未带 Token → 匿名限流（60/h/IP）：提示稍后重试。
  - 403 + 带 Token → 限流或权限不足：读取 `X-RateLimit-Reset` 换算剩余分钟提示。
  - 404 → gist 不存在或为私有（未授权）：提示检查链接或配置 Token。
  - 网络异常（`fetch` reject / 超时 AbortController 15s）→ 提示检查网络与代理（桌面端走系统代理，Web 端需网络本身可达）。
- 响应解析容错：GitHub 偶发 HTML/网关错误页，`response.json()` 失败时按网络错误处理而非抛出难懂异常。

## 8. 功能交互流程

### 8.1 Token 配置（设置面板）

入口：设置 - 插件设置（代码片段管理器）- GitHub Token 区域。
流程：粘贴 `ghp_` Token → 保存 → 落盘密文 + 状态变「已配置」；输入框清空 → 清除 → 删除密文 + 状态变「未配置」。配置成功/失败用现有 `showErrorMessage`/成功消息体系反馈。

### 8.2 发布到 Gist

入口：设置面板按钮「发布到 Gist」（与导出/导入按钮并列；图标建议用思源内置 `#iconGithub`，若不可用则从内置图标集选云上传语义图标，不手写 SVG）。

流程：

1. 未配置 Token → 提示并引导到 8.1（含「打开设置」跳转）。
2. 打开发布对话框（`Dialog`，data-key `jcsm-gist-publish`）：
   - 片段勾选清单：列出全部片段（名称/类型/启用状态），默认勾选已启用项；提供「全部 / CSS / JS / 仅启用」快捷筛选与反选，底部显示勾选计数。清单为滚动容器，不随片段数量撑高对话框（大数据量交互见未决问题 2）。
   - 目标：单选项——新建（secret/public 单选）或更新（默认「上次发布的 gist」，另可手动粘贴 gist id/URL）。
   - 预览：只读列表显示勾选片段将生成的 gist 文件名（`<名称> <id>.<ext>`，含清洗结果），与目标 gist 现有文件对比标出「将新增 / 将覆盖更新 / 将重命名 / 将删除（未勾选的旧文件）」。
   - 「发布」执行：校验（见 5.2）→ 有 Token 且 `public` → 二次确认对话框（SnippetsDialog.openConfirm 复用）提示「公开后任何人均可查看代码内容」。
3. 成功：成功消息 + gist 链接（复制按钮 / `window.open`）；写入状态文件。
4. 更新已有 gist 的语义：PATCH 全量替换——把**勾选集**全部写入 files（文件名含 ID，与旧文件**同 ID 者覆盖更新**；勾选片段改名后 ID 段不变，用 PATCH `filename` 重命名）；未勾选的旧文件置 null（删除），保证 gist 与勾选集一致（镜像，幂等，可反复发布，见 5.4）。

### 8.3 从 Gist 导入

入口：设置面板按钮「从 Gist 导入」。

流程：

1. 打开导入对话框（data-key `jcsm-gist-import`）：
   - 输入 gist 链接或 id；未配置 Token 时提示「secret gist 与更高限流需要 Token，可稍后配置」，但**仍允许匿名拉取公开 gist**。
   - 点击「获取」→ 展示加载态 → 解析结果（见 5.1）为预览表格：勾选列（默认）、文件名、推断类型（可改）、大小、截断提示。
   - 目标模式单选（与 5.4 三种模式对应）：
     - **合并更新（默认）**：逐片段按 ID 判定——带 ID 且本地同 ID → 更新该片段 name/content/type（保留本地 enabled 与排序）；本地无此 ID 或文件无 ID → 新增（enabled=false）。勾选列表中每个文件的「导入动作」列即为该判定的实时预览。
     - **覆盖镜像**：以勾选集合整体替换本地（覆盖前自动备份，语义与现有 `importSnippets(true)` 一致）。
     - **仅新增（fork）**：忽略文件名 ID，全部重生成 ID 作为新片段导入。
2. 确认导入 → 组装 `Snippet[]`（仅勾选文件）→ 按所选模式复用落库管道（8.4）→ 成功消息（含新增 N / 更新 M 计数）。

### 8.4 复用现有导入管道

`ImportExportService.importSnippets` 当前把「读取本地文件 → 文本 → 校验 → 列表」揉在一个流程里。本功能需要把数据源抽象出来，建议重构（小步、不改行为）：

```ts
// 现有私有方法保持私有，抽出公共入口：数据已就绪的数组 → 与现有完全相同的后续步骤
// mode：merge（合并更新默认：同 ID 更新 name/content/type、保留本地 enabled/排序，其余新增）
//      | overwrite（全表替换前备份）| fork（忽略文件名 ID，全部重生成）
public async importSnippetsFromData(importData: Snippet[], mode: "merge" | "overwrite" | "fork"): Promise<boolean>
```

- 内部仍走：`validateImportData`（含 CSS 内核安全校验 `findInvalidCssSnippets`）→ 覆盖前 `createBackup` → ID 处理（merge：同 ID 片段合并字段、冲突集合避免两两重复、无 ID/新 ID 走 `processImportedSnippets`；overwrite 采用导入 ID；fork 全部 `genNewSnippetId` 重生成）→ `snippetManager.saveSnippetsList` → `applyImportedSnippets`（落库 + 注入元素对齐 + 跨窗口广播）。
- 本地文件导入（`importSnippets` 现有「追加/覆盖」语义）**保持原流程不动**，仅 gist 导入走本公共入口——两套语义**刻意不统一**：本地 JSON 导入是纯数据文件（追加仅防 ID 冲突、无合并概念），gist 来源携带文件名 ID 身份信息（合并更新才有意义），各自内聚。以现有单测回归为安全网，避免双份逻辑漂移。

## 9. 代码结构规划

| 新增/改动 | 文件 | 职责 |
|---|---|---|
| 新增 | `src/services/gist.ts` | GitHub REST 客户端：URL/id 解析、请求、错误归一（第 7 节） |
| 新增 | `src/services/gist-sync.ts` | 编排：Gist 文件 ↔ Snippet[] 映射（5.1/5.2）、发布/导入主流程、状态文件读写 |
| 新增 | `src/services/gist-token.ts` | vault 单例 + token 状态读写（6.1），模块内私有缓存（明文本体不进任何导出状态的全局） |
| 新增 | `src/ui/gist-dialog.ts` | 发布对话框与导入对话框的 DOM/事件/键盘接入（挂到 `SnippetsDialog` 同层的协调集合） |
| 改动 | `src/config/config-service.ts` | 新增 3 个 `createActionElement` 条目（GitHub Token 区、发布、导入）；Token 条目不进 valueItems |
| 改动 | `src/ui/setting-dialog.ts` | `dialogClickHandler` 增加 gist action 分支；Token 元素事件独立绑定 |
| 改动 | `src/index.ts` | 装配 `GistSyncService`；onload 预热 Token、onunload clear |
| 改动 | `src/ui/snippets-dialog.ts` / `src/utils.ts`（如需要） | 新对话框纳入模态协调（data-key `jcsm-gist-*`、`getAllModalElements`） |
| 改动 | `src/services/import-export.ts` | 抽出 `importSnippetsFromData`（8.4） |
| 改动 | `package.json` | 新增 dependencies：`siyuan-token-vault`（GitHub tag/commit 形式，注意 lockfile 手工注入或一次干净 `pnpm add`） |
| 改动 | `src/i18n/*.json` × 4 | 新键四语言 |
| 改动 | `README*.md` × 多语言 | 功能说明 |

## 10. 状态与同步语义（为什么不做自动双向）

- 片段唯一事实源仍是内核 `data/snippets/conf.json`；Gist 只是「分享介质」，不是同步后端。
- 自动双向需要解决：Gist 与本地都变化时的冲突仲裁、轮询/监听开销、secret 网络轮询、跨设备同 gist 多写。收益与复杂度不成比例。
- 因此 v1 语义：**发布**是本地 → Gist 的勾选集快照（更新 = 同 ID 文件名覆盖的幂等镜像）；**导入**是 Gist → 本地的合并更新 / 覆盖镜像 / 仅新增（合并与覆盖前自动备份）。用户自行决定方向、勾选范围与时机，交互上明确文案区分（发布按钮与导入按钮分离，不叫「同步」）。ID 随文件名跨端传播，但**不做自动双向**——同一片段在两端各自修改时，由用户以手动方向操作取舍，插件不仲裁冲突。

## 11. 错误处理与提示汇总

| 场景 | 提示 |
|---|---|
| 未配置 Token（发布 / 拉 secret gist） | 引导打开设置配置 Token，附创建页链接 |
| Token 401 | 「Token 过期或无效，请重新配置」（复用 install-package 同款措辞风格） |
| 匿名限流 60/h | 提示稍后重试；引导配置 Token 提升至 5000/h |
| Token 限流 | 显示按 `X-RateLimit-Reset` 换算的等待时间 |
| 404 | 「Gist 不存在或为私有」 |
| 网络不可达/超时 | 检查网络连接；桌面端走系统代理 |
| 单片段 > 1MB / 总数 > 300 | 发布前校验拦截并说明 |
| 导入片段命中 CSS 安全校验 | 复用现有 `findInvalidCssSnippets` 定位提示 |

错误一律经 `plugin.console` 记录 + `showErrorMessage` 呈现；不把 GitHub 原始响应体直接抛给用户。

## 12. 安全与隐私

- Token 密文落盘（设备特征 + PBKDF2 + AES-GCM，vault 默认参数），换设备/换工作空间需重配；明文仅存在于单次会话内存。
- Token 配置项不进 `plugin-config.json` → 不随跨窗口/跨设备同步传播（与 install-package 的每设备配置语义一致）。
- 片段内容可能含敏感信息：发布默认 secret；public 必须二次确认；对话框与 i18n 明确提示「secret 不等于私有，拥有链接者可见」。
- 本插件已有「广播禁原文」先例——Gist 发布是把内容送上公网的更强暴露面，发布前列表必须完整可审。

## 13. 网络与代理

- 全部请求走浏览器 `fetch`，不经思源内核 HTTP 通道，因此**不继承内核代理配置**。
- 桌面端 Electron 默认走系统代理（HTTP(S)_PROXY 等）；Web 端由浏览器网络决定。大陆网络下 github 系域名可能不稳，错误提示中把「网络/代理」列为第一排查项即可，不做内置代理能力。

## 14. i18n 与图标

- 新增键命名建议分组前缀 `gist*` / `githubToken*`，四语言（en/ja/zh-CN/zh-TW）同步新增，键序与现有文件风格一致（2 空格缩进）。
- 图标：按钮模板沿用 `createOutlineActionElement`；优先使用思源内置 `#iconGithub`；导入/发布与现有「导出/导入」的 `iconUpload`/`iconDownload` 语义要能区分（发布≠本地导出），若内置图标集无更贴切图标再评估注册新 symbol（遵循不手写 SVG 约束）。
- 设置按钮与对话框文案中的 UI 路径描述统一用「设置 - 插件 - 代码片段管理器」这类空格连字符格式。

## 15. 测试策略

- 纯逻辑单测（node 环境，沿用 vitest + 现有 mock 基建）：
  - URL/id 解析、错误归一（401/403/404/限流/网络）、请求头装配（含 Token 注入与不带 Token）。
  - 映射规则：扩展名推断、文件名清洗与重名、conf.json 特例识别、截断 raw_url 兜底。
  - 覆盖语义与文件名解析：发布命名 `<name> <id>.<ext>` 与清洗（ID 段保留、清洗不破坏 ID）；下载侧尾部正则提取 ID（含负例：无 ID/畸形 ID）；改名后 ID 不变；解析-重发布 round-trip 幂等。
  - `importSnippetsFromData`：merge（同 ID 更新、保留本地 enabled）/overwrite/fork 三模式、ID 处理、备份、落库调用链（对齐现有 import-export 测试写法）。
  - `gist-token.ts`：storage 桩下 save/load/clear 语义（复用库侧已覆盖的 vault 行为，仅验证封装层）。
- DOM 测试（jsdom）：发布/导入对话框装配与按钮分发（对齐现有 setting-dialog/menu 测试写法）。
- 手工验证清单（扩展 `docs/manual-testing.md` 时补 MT 用例）：真实 gist 往返、secret gist、限流提示、Token 换设备失效、public 二次确认、更新 gist 幂等。

## 16. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | Token 设置项 + siyuan-token-vault 集成（含依赖引入与 lockfile 落地） | 设置面板可保存/清除/恢复 Token；密文文件出现在插件数据目录；plugin-config.json 无 Token |
| M2 | 从 Gist 导入（公开 gist）+ 文件名 ID 解析 + 预览勾选对话框 + `importSnippetsFromData`（merge/overwrite/fork）重构 | 粘贴公开 gist 可预览（含「新增/更新」动作列）、合并/覆盖/fork 导入；带 ID 与无 ID 文件行为正确；现有文件导入回归全绿 |
| M3 | 发布到 Gist（勾选清单、`<名称> <id>.<ext>` 命名、新建/更新镜像、secret/public、状态记忆、成功链接） | 发布后可他人匿名导入；更新 gist 同 ID 覆盖、改名重命名、未勾选旧文件被清理；public 二次确认生效 |
| M4 | 打磨：secret gist 拉取、限流/网络文案、多语言校对、README | 手工用例覆盖；lint/typecheck/全量单测通过 |

## 17. 未决问题（评审点）

1. 发布入口是否也在顶栏菜单提供一项（现有顶栏菜单偏片段操作与工具，放设置按钮之外是否值得）？
2. 勾选清单在片段数量大时的交互（复用顶栏菜单的搜索/类型页过滤形态，还是独立筛选条）？v1 先以「快捷筛选 + 滚动清单」落地，是否够用？
3. Gist description 是否写入结构化元数据（如插件版本/片段计数），为将来做格式演进留钩子？
4. 是否需要在 `README` 公开约定一种「Snippets Gist 格式」（文件命名/conf 单文件约定），方便社区形成统一分享规范？

> 已定事项：发布恒带 ID、不提供去 ID 开关（D12）；本地 JSON 文件导入保持既有语义、不与 gist 合并模式统一（8.4）。
