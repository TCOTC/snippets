// 代码片段管理（原 index.ts「代码片段管理」分节外迁，行为等价）
// 职责：代码片段的创建/保存/删除/自拉/落库/注入元素更新与移除（含跨窗口 origin 分支）。
// 简洁化：不设 Host 读取器接口——直接持有 PluginSnippets 实例（import type 避免运行时循环依赖），
// 仅访问插件侧已 public 化的运行态；纯工具逻辑（ID 生成/预览判断）在 ../utils，纯领域判断在 ../domain。
import {fetchPost, fetchSyncPost} from "siyuan";
import type PluginSnippets from "../index";
import {isSnippetsTypeEnabled, isValidJavaScriptCode} from "../domain/snippet";
import {genNewSnippetId, isPreviewingSnippet} from "../utils";
import type {Snippet, SnippetType} from "../types";

/**
 * 代码片段管理器（原 index.ts createSnippet/saveSnippet/deleteSnippet/applySnippetUIChange/getSnippetById/
 * getSnippetsList/saveSnippetsList/updateSnippetElement/removeSnippetElement 外迁，行为等价）
 */
export class SnippetManager {
    private readonly plugin: PluginSnippets;

    constructor(plugin: PluginSnippets) {
        this.plugin = plugin;
    }

    /**
     * 创建代码片段
     */
    createSnippet() {
        const snippet: Snippet = {
            id: genNewSnippetId(this.plugin.snippetsList),
            name: "",
            type: this.plugin.snippetsType as "css" | "js",
            enabled: this.plugin.newSnippetEnabled,
            content: "",
        };
        // 不直接添加代码片段
        // this.saveSnippet(snippet);
        void this.plugin.openSnippetEditDialog(snippet, true);
    }

    /**
     * 保存代码片段（添加/更新/复制；本窗口操作与同内核其他前端实例广播共用同一路径，阶段 3：消灭 saveSnippetSync 镜像）
     * - 本窗口操作（origin 缺省为 local）：snippet 为编辑结果对象（对话框保存）或复制源对象（复制按钮，
     *   副本在方法内派生）；先自拉服务端旧态做 diff，有变更才经 Store 落库、更新元素/UI 并广播；
     * - 同内核其他前端实例广播（origin 为 remote）：广播窗口已落库，本窗口不落库、不广播，仅同步自身状态。
     *   广播消息不含片段原文（禁原文约束），片段对象由注册表 snippet_save 键自拉权威数据后传入：
     *   复制场景 snippet 为被复制原片段（菜单项插入锚点）、remoteCopySnippet 为自拉的权威副本；
     *   非复制场景 snippet 为自拉的权威新态、remoteOldSnippet 为自拉前捕获的本窗口旧片段
     *   （仅改名时不必重刷注入元素，避免 JS 重复弹出重载提示）。
     * @param snippet 代码片段（语义随 origin，见上）
     * @param isCopy 是否为复制操作
     * @param origin 变更来源：local（本窗口操作）| remote（其他窗口广播）
     * @param remoteCopySnippet 仅 origin 为 remote 且 isCopy 时使用：自拉的权威副本对象
     * @param remoteOldSnippet 仅 origin 为 remote 且非复制时使用：自拉前捕获的本窗口旧片段
     */
    async saveSnippet(snippet: Snippet, isCopy = false, origin: "local" | "remote" = "local", remoteCopySnippet?: Snippet, remoteOldSnippet?: Snippet) {
        this.plugin.console.log("saveSnippet:", {snippetId: snippet.id, isCopy, origin});

        if (origin === "remote") {
            if (isCopy) {
                if (!remoteCopySnippet) {
                    this.plugin.console.error("saveSnippet: remote copySnippet is missing:", snippet.id);
                    return;
                }
                // 从 Store 统一 upsert（幂等：副本已随自拉就位，此处仅统一触发计数刷新事件）
                this.plugin.snippetStore.upsert(remoteCopySnippet);
                // 代码片段有可能未启用，所以不传入 enabled === true 的参数
                await this.updateSnippetElement(remoteCopySnippet);
                // 镜像菜单项插入与原始片段对话框按钮更新
                this.applySnippetUIChange(snippet, true, remoteCopySnippet);
                this.plugin.console.log("saveSnippet: remote copySnippet", remoteCopySnippet);
                return;
            }
            // 从 Store 统一 upsert（列表已随自拉刷新为权威态，计数由事件统一刷新）
            this.plugin.snippetStore.upsert(snippet);
            if (remoteOldSnippet) {
                // 本窗口原本有该片段：更新。比较对象属性值而不是对象引用
                const contentOrEnabledChanged = remoteOldSnippet.content !== snippet.content || remoteOldSnippet.enabled !== snippet.enabled;
                if (contentOrEnabledChanged) {
                    // 只有代码片段名称改变的时候不需要更新元素
                    // 代码片段有可能未启用，所以不传入 enabled === true 的参数
                    // 问题案例: 先禁用整体状态，再在对话框中启用，然后预览，然后保存。会在整体禁用的情况下启用代码片段，或者说没有移除预览时添加的元素
                    //  应该始终执行 updateSnippetElement
                    await this.updateSnippetElement(snippet);

                    // TODO功能: 跨窗口同步时，如果有打开对应的代码片段编辑器，需要更新编辑器的内容
                }
            } else {
                // 本窗口原本没有该片段：新增（列表已按权威顺序就位）
                // 代码片段有可能未启用，所以不传入 enabled === true 的参数
                await this.updateSnippetElement(snippet);
            }
            this.applySnippetUIChange(snippet, true);
            return;
        }

        let hasChanges = false;
        let copySnippet: Snippet | undefined = undefined;
        if (isCopy) {
            // 使用结构化克隆深拷贝 snippet 对象，避免副本和原对象引用同一内存
            if (typeof structuredClone === "function") {
                copySnippet = structuredClone(snippet);
            } else {
                // 不支持 structuredClone 则回退到 JSON 方法
                copySnippet = JSON.parse(JSON.stringify(snippet)) as Snippet;
            }
            // 生成新的代码片段
            copySnippet.id = genNewSnippetId(this.plugin.snippetsList);
            copySnippet.name = snippet.name + ` (${this.plugin.i18n.duplicate} ${new Date().toLocaleString()})`;

            // 把副本创建在当前代码片段的上面（菜单计数由 SNIPPETS_CHANGED 事件统一刷新）
            this.plugin.snippetStore.insertBefore(copySnippet, snippet.id);
            hasChanges = true;

            // 代码片段有可能未启用，所以不传入 enabled === true 的参数
            await this.updateSnippetElement(copySnippet);

            this.plugin.console.log("saveSnippet: copySnippet", copySnippet);
        } else {
            // 在 snippetsList 中查找是否存在该代码片段
            const oldSnippet = await this.getSnippetById(snippet.id!);
            if (oldSnippet) {
                // 如果存在，则更新该代码片段
                // 比较对象属性值而不是对象引用
                const nameChanged = oldSnippet.name !== snippet.name;
                const contentOrEnabledChanged = oldSnippet.content !== snippet.content || oldSnippet.enabled !== snippet.enabled || oldSnippet.disabledInPublish !== snippet.disabledInPublish;
                hasChanges = nameChanged || contentOrEnabledChanged;
                if (hasChanges) {
                    // 从 Store 统一替换并触发计数刷新事件
                    this.plugin.snippetStore.upsert(snippet);
                }
                if (contentOrEnabledChanged) {
                    // 只有代码片段名称改变的时候不需要更新元素
                    // 代码片段有可能未启用，所以不传入 enabled === true 的参数
                    // 问题案例: 先禁用整体状态，再在对话框中启用，然后预览，然后保存。会在整体禁用的情况下启用代码片段，或者说没有移除预览时添加的元素
                    //  应该始终执行 updateSnippetElement
                    await this.updateSnippetElement(snippet);
                }
            } else {
                if (oldSnippet === false) {
                    this.plugin.showErrorMessage(this.plugin.i18n.getSnippetFailed);
                    return;
                }
                // 如果不存在（oldSnippet === undefined），则添加代码片段（store.upsert 按类型分区插入，计数由事件统一刷新）
                this.plugin.snippetStore.upsert(snippet);
                hasChanges = true;
                // 代码片段有可能未启用，所以不传入 enabled === true 的参数
                await this.updateSnippetElement(snippet);
            }
        }

        if (hasChanges) {
            // 代码片段发生变更才推送更新
            // 需要等 getSnippetsList() 调用的 API 执行完毕之后才推送更新，其他窗口需要用到代码片段的最新数据
            void await this.saveSnippetsList(this.plugin.snippetsList);
            this.applySnippetUIChange(snippet, true, copySnippet);

            // 广播代码片段数据更新到其他窗口
            // 注意：不得携带代码片段原文（content 可能含敏感信息），接收窗口按 ID 自拉权威数据
            this.plugin.syncService?.broadcast({
                type: "snippet_save",
                snippetId: snippet.id,
                isCopy: isCopy,
                copySnippetId: copySnippet?.id,
            });
        }
    }

    /**
     * 删除代码片段（本地操作与跨窗口同步共用同一路径，阶段 3：消灭 deleteSnippetSync 镜像）
     * - 本地（origin 缺省为 local）：自拉权威数据校验存在 → 从 Store 删除 → 落库 → 移除注入元素
     *   /更新 UI → 广播（附本窗口是否正在预览该片段）；
     * - 远程（origin 为 remote）：广播窗口已落库并校验过，本窗口仅按自身状态同步——广播窗口未预览
     *   该片段时才移除注入元素；片段在本窗口列表中存在时更新 UI 并同步从 Store 删除。
     * @param id 代码片段 ID
     * @param snippetType 代码片段类型
     * @param origin 变更来源：local（本窗口操作）| remote（其他窗口广播）
     * @param remotePreviewState 广播窗口是否正在实时预览该片段（仅远程使用，用于跳过注入元素移除）
     */
    async deleteSnippet(id: string, snippetType: SnippetType, origin: "local" | "remote" = "local", remotePreviewState = false) {
        // TODO: 有个 "/api/snippet/removeSnippet" 看看能不能用上
        this.plugin.console.log("deleteSnippet", {id, snippetType, origin});

        if (!id || !snippetType) {
            if (origin === "local") {
                this.plugin.showErrorMessage(this.plugin.i18n.deleteSnippetFailed);
            } else {
                this.plugin.console.error("deleteSnippet: Snippet is missing:", {id, snippetType});
            }
            return;
        }

        if (origin === "local") {
            const snippet = await this.getSnippetById(id);
            if (snippet === undefined) {
                this.plugin.showErrorMessage(this.plugin.i18n.getSnippetFailed);
                return;
            } else if (snippet === false) {
                return;
            }
            // 从 Store 中删除：统一更新列表并广播变更事件，菜单在打开时会自行刷新计数
            this.plugin.snippetStore.remove(id);
            // 需要等 getSnippetsList() 调用的 API 执行完毕之后才推送更新，其他窗口需要用到代码片段的最新数据
            void await this.saveSnippetsList(this.plugin.snippetsList);

            void this.removeSnippetElement(id, snippetType);
            this.applySnippetUIChange(snippet, false);

            // 广播代码片段数据更新到其他窗口
            this.plugin.syncService?.broadcast({
                type: "snippet_delete",
                snippetId: id,
                snippetType: snippetType,
                previewState: isPreviewingSnippet(id, snippetType, this.plugin.realTimePreview),
            });
            return;
        }

        // 远程：广播窗口没有预览该代码片段的情况下，才移除元素
        if (!remotePreviewState) {
            void this.removeSnippetElement(id, snippetType);
        }
        const snippet = this.plugin.snippetsList.find((s: Snippet) => s.id === id);
        if (snippet) {
            this.applySnippetUIChange(snippet, false);
            // 从 Store 中删除：统一在列表更新之后触发计数刷新事件（否则计数仍是删除前的值）
            this.plugin.snippetStore.remove(id);
        }
    }

    /**
     * 应用代码片段 UI 变更
     * @param snippet 代码片段
     * @param isAddOrUpdate 是否为添加或更新
     * @param copySnippet 副本代码片段
     */
    applySnippetUIChange(snippet: Snippet, isAddOrUpdate: boolean, copySnippet?: Snippet) {
        const snippetMenuItem = this.plugin.menuItems?.querySelector(`.jcsm-snippet-item[data-id="${snippet.id}"]`) as HTMLElement;
        const dialog = document.querySelector(`.b3-dialog--open[data-key="jcsm-snippet-dialog"][data-snippet-id="${snippet.id}"]`) as HTMLDivElement;
        let deleteButton, confirmButton;
        if (dialog && !copySnippet) {
            // 创建代码片段副本时不需要更新原始代码片段的 Dialog 的按钮
            deleteButton = dialog.querySelector(".jcsm-dialog .jcsm-dialog-container button[data-action=\"delete\"]") as HTMLButtonElement;
            confirmButton = dialog.querySelector(".jcsm-dialog .b3-dialog__action button[data-action=\"confirm\"]") as HTMLButtonElement;
        }
        // 应用代码片段变更，修改相关的元素
        if (isAddOrUpdate) {
            // 打开菜单时才需要修改菜单项
            if (this.plugin.menu) {
                if (snippetMenuItem) {
                    // 有菜单项
                    if (copySnippet) {
                        // 在指定菜单项的上方插入新的副本菜单项
                        const snippetsHtml = this.plugin.genMenuSnippetsItems([copySnippet]);
                        snippetMenuItem.insertAdjacentHTML("beforebegin", snippetsHtml);
                    } else {
                        // 更新菜单项
                        const nameElement = snippetMenuItem.querySelector(".jcsm-snippet-name") as HTMLElement;
                        if (nameElement) nameElement.textContent = snippet.name || snippet.content.slice(0, 200);
                        const publishSwitchElement = snippetMenuItem.querySelector("input[data-type='publishSwitch']") as HTMLInputElement;
                        if (publishSwitchElement) publishSwitchElement.checked = !snippet.disabledInPublish;
                        const snippetSwitchElement = snippetMenuItem.querySelector("input[data-type='snippetSwitch']") as HTMLInputElement;
                        if (snippetSwitchElement) snippetSwitchElement.checked = snippet.enabled;
                    }
                } else {
                    // 没有菜单项，在菜单项列表的顶部插入新的菜单项
                    const snippetsHtml = this.plugin.genMenuSnippetsItems([snippet]);
                    this.plugin.menuItems.querySelector(".jcsm-snippets-container")?.insertAdjacentHTML("afterbegin", snippetsHtml);
                }
            }

            // 修改对应的 Dialog
            deleteButton?.classList.remove("fn__none"); // 显示删除按钮
            if (confirmButton) confirmButton.textContent = this.plugin.i18n.save; // 将“新建”按钮的文案改为“保存”
        } else {
            // 移除菜单项
            snippetMenuItem?.remove();

            // 修改对应的 Dialog
            deleteButton?.classList.add("fn__none"); // 隐藏删除按钮
            if (confirmButton) confirmButton.textContent = this.plugin.i18n.new; // 将“保存”按钮的文案改为“新建”
        }
    }

    /**
     * 根据 ID 获取代码片段（副作用是更新插件 snippetsList）
     * @param id 代码片段 ID
     * @returns 代码片段 | false
     */
    async getSnippetById(id: string): Promise<Snippet | false | undefined> {
        const snippetsList = await this.getSnippetsList();
        if (snippetsList) {
            this.plugin.snippetsList = snippetsList;
            return this.plugin.snippetsList.find((snippet: Snippet) => snippet.id === id);
        } else {
            return false;
        }
    }

    /**
     * 获取代码片段列表
     * @returns 代码片段列表 | false
     */
    async getSnippetsList(): Promise<Snippet[] | false> {
        const response = await fetchSyncPost("/api/snippet/getSnippet", { type: "all", enabled: 2 });
        if (response.code !== 0) {
            this.plugin.showErrorMessage(this.plugin.i18n.getSnippetsListFailed + " [" + response.msg + "]");
            return false;
        }
        const snippetsList = response.data.snippets as Snippet[];
        this.plugin.console.log("getSnippetsList", snippetsList);
        return response.data.snippets as Snippet[];
    }

    /**
     * 保存代码片段列表（参考思源本体 app/src/config/util/snippets.ts）
     * @param snippetsList 代码片段列表
     * @returns Promise<void>
     */
    saveSnippetsList(snippetsList: Snippet[]): Promise<void> {
        this.plugin.console.log("saveSnippetsList", snippetsList);
        // 将回调形式的 fetchPost 包装为 Promise，以便可以 await
        return new Promise((resolve, reject) => {
            fetchPost("/api/snippet/setSnippet", { snippets: snippetsList }, (response) => {
                // 增加错误处理
                if (response.code !== 0) {
                    this.plugin.showErrorMessage(this.plugin.i18n.saveSnippetsListFailed + " [" + response.msg + "]");
                    reject(new Error(this.plugin.i18n.saveSnippetsListFailed + " [" + response.msg + "]"));
                    return;
                }
                resolve();
            });
        });
    }

    /**
     * 更新代码片段元素（添加、更新、删除、启用、禁用、全局启用、全局禁用）
     * @param snippet 代码片段
     * @param enabled 是否启用
     * @param previewState 为 true 时是预览操作；为 false 时是退出预览操作，需要恢复原始元素
     */
    async updateSnippetElement(snippet: Snippet | false | undefined, enabled?: boolean, previewState?: boolean) {
        if (!snippet) {
            this.plugin.showErrorMessage(this.plugin.i18n.updateSnippetElementParamError);
            return;
        }
        if (previewState === undefined && isPreviewingSnippet(snippet.id, snippet.type, this.plugin.realTimePreview)) {
            // 如果开启了实时预览，并且打开了对应的 CSS 代码片段对话框，则在菜单项上开关代码片段的操作需要忽略
            // 问题案例：全局禁用 CSS，预览一个 CSS 片段，启用片段，在菜单禁用片段会导致预览元素被移除
            //  这是因为从菜单关闭时没有 previewState 参数，此时需要通过是否有实时预览中的代码片段对话框来判断
            return;
        }

        const elementId = `snippet${snippet.type.toUpperCase()}${snippet.id}`;
        const element = document.getElementById(elementId);

        // ?? 空值合并运算符，当左侧值为 null 或 undefined 时返回右侧值，此处优先使用 enabled 的值
        const isEnabled = enabled ?? snippet.enabled;
        const isSnippetsTypeEnabledFlag = isSnippetsTypeEnabled(snippet.type);

        if (isEnabled && (isSnippetsTypeEnabledFlag || previewState)) {
            // 代码片段需要启用 && （该代码片段对应的类型是启用状态 || 正在预览该代码片段）→ 则添加新元素
            if (element && element.innerHTML === snippet.content) {
                // 如果要添加的代码片段与原来的一样，就忽略
            } else {
                this.plugin.console.log("updateSnippetElement: remove old element:", element);
                element?.remove();
                let newElement;
                if (snippet.type === "css") {
                    newElement = document.createElement("style");
                    newElement.id = elementId;
                    newElement.textContent = snippet.content;
                    document.head.appendChild(newElement);
                } else if (snippet.type === "js") {
                    if (!isValidJavaScriptCode(snippet.content)) {
                        this.plugin.showErrorMessage(this.plugin.i18n.invalidJavaScriptCode);
                    }
                    newElement = document.createElement("script");
                    newElement.id = elementId;
                    newElement.type = "text/javascript";
                    // 思源的代码使用 .text ，这与 .textContent 是等效的，参考：https://developer.mozilla.org/en-US/docs/Web/API/HTMLScriptElement/text https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent
                    newElement.textContent = snippet.content;
                    document.head.appendChild(newElement);
                }
                this.plugin.console.log("updateSnippetElement: add new element:", newElement);
            }
        } else {
            // else 分支等效于 !isEnabled || (!isSnippetsTypeEnabled && !previewState)
            // 禁用 || (全局禁用 && 不是正在预览) → 则移除旧元素
            this.plugin.console.log("updateSnippetElement: remove disabled element:", element);
            element?.remove();
        }

        if (previewState === undefined && isEnabled && this.plugin.menu && snippet.type === this.plugin.snippetsType && !isSnippetsTypeEnabled) {
            // 如果当前的操作是在非预览状态下、开启代码片段、开启了菜单、菜单上显示的是这个类型的代码片段、这个类型的代码片段是关闭状态 → 全局开关闪烁一下
            this.plugin.setSnippetsTypeSwitchBreathing();
        }

        // 需要弹出消息提示的情况：
        // 1. 修改：有旧代码 && 旧代码有效 && （新代码有效 || 新代码无效）等效于有新代码
        // 2. 删除：有旧代码 && 旧代码有效 && 没有新代码
        // 3. 禁用：有旧代码 && 旧代码有效 && 没有新代码
        // 以上合并为：有旧代码 && 旧代码有效 → 本质上是旧 JS 被修改/删除/禁用时无法立即生效
        if (snippet.type === "js" && element && element.innerHTML && isValidJavaScriptCode(element.innerHTML)) {
            // JS 代码片段元素更新需要弹出消息提示
            this.plugin.showNotification("reloadUIAfterModifyJS", 4000);
            // 高亮菜单上的重新加载界面按钮
            await this.plugin.setReloadUIButtonBreathing();
        }
    }

    /**
     * 移除代码片段元素
     * @param snippetId 代码片段 ID
     * @param snippetType 代码片段类型
     */
    async removeSnippetElement(snippetId: string, snippetType: string) {
        if (!snippetId || !snippetType) return;
        // 如果当前窗口正在预览代码片段，则不移除元素
        if (isPreviewingSnippet(snippetId, snippetType, this.plugin.realTimePreview)) return;

        const elementId = `snippet${snippetType.toUpperCase()}${snippetId}`;
        const element = document.getElementById(elementId);
        // 删除 JS 代码片段需要弹出消息提示：有旧代码 && 旧代码有效
        if (snippetType === "js" && element && element.innerHTML && isValidJavaScriptCode(element.innerHTML)) {
            this.plugin.showNotification("reloadUIAfterModifyJS", 4000);
            await this.plugin.setReloadUIButtonBreathing();
        }
        element?.remove();
    }
}
