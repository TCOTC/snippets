// 代码片段管理
// 职责：代码片段的创建/保存/删除/自拉/落库/注入元素更新与移除（含跨窗口 origin 分支）。
// 运行态经插件实例访问；纯工具逻辑（ID 生成/预览判断）在 ../utils，纯领域判断在 ../domain。
import {fetchPost, fetchSyncPost} from "siyuan";
import type PluginSnippets from "../index";
import {deepClone, isSnippetsTypeEnabled, isValidJavaScriptCode, snippetTitle} from "../domain/snippet";
import {genNewSnippetId, isPreviewingSnippet, SNIPPET_DIALOG_SELECTOR} from "../utils";
import type {Snippet, SnippetType} from "../types";
import type {BroadcastHandlers} from "./sync";

/**
 * 注入元素 id 拼接（<style>/<script> 元素的定位键）
 */
const snippetElementId = (snippetType: string, snippetId: string): string => `snippet${snippetType.toUpperCase()}${snippetId}`;

/**
 * 代码片段管理器
 * 承接代码片段的创建/保存/删除/自拉/落库/注入元素更新与移除（含跨窗口 origin 分支），
 * 以及跨窗口广播业务消息分发注册表的构建（buildSyncHandlers）。
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
            type: this.plugin.snippetsType,
            enabled: this.plugin.config.newSnippetEnabled,
            content: "",
        };
        void this.plugin.snippetsDialog.openEditDialog(snippet, true);
    }

    /**
     * 保存代码片段（添加/更新/复制；本窗口操作与同内核其他前端实例广播共用同一路径）
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
                // 判等口径与本地分支保持一致：content/enabled 变化才需要刷新注入元素
                // （元素注入与 disabledInPublish 无关）；disabledInPublish 不参与本处判等——
                // 对话框保存的变更随本消息落库后由接收窗口自拉得到，菜单拨动走独立的 snippet_toggle_publish 广播
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
            // 深拷贝 snippet 对象，避免副本和原对象引用同一内存
            copySnippet = deepClone(snippet);
            // 生成新的代码片段
            copySnippet.id = genNewSnippetId(this.plugin.snippetsList);
            copySnippet.name = snippet.name + ` (${this.plugin.i18n.duplicate} ${new Date().toLocaleString()})`;

            // 把副本创建在当前代码片段的上面（菜单计数由 Store 变更回调统一刷新）
            this.plugin.snippetStore.insertBefore(copySnippet, snippet.id);
            hasChanges = true;

            // 代码片段有可能未启用，所以不传入 enabled === true 的参数
            await this.updateSnippetElement(copySnippet);

            this.plugin.console.log("saveSnippet: copySnippet", copySnippet);
        } else {
            // 在 snippetsList 中查找是否存在该代码片段
            const oldSnippet = await this.getSnippetById(snippet.id);
            if (oldSnippet === false) {
                // false 是自拉列表失败（getSnippetsList 已弹错误提示）
                this.plugin.showErrorMessage(this.plugin.i18n.getSnippetFailed);
                return;
            }
            if (oldSnippet) {
                // 如果存在，则更新该代码片段
                // 比较对象属性值而不是对象引用
                const nameChanged = oldSnippet.name !== snippet.name;
                // 判等口径与远程分支保持一致：content/enabled 变化才刷新注入元素
                // （元素注入与 disabledInPublish 无关）；disabledInPublish 仅参与落库/广播判定（hasChanges），
                // 菜单发布开关 UI 由 applySnippetUIChange 同步
                const contentOrEnabledChanged = oldSnippet.content !== snippet.content || oldSnippet.enabled !== snippet.enabled;
                const publishChanged = oldSnippet.disabledInPublish !== snippet.disabledInPublish;
                hasChanges = nameChanged || contentOrEnabledChanged || publishChanged;
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
            await this.saveSnippetsList(this.plugin.snippetsList);
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
     * 删除代码片段（本窗口操作与同内核其他前端实例广播共用同一路径）
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
            await this.saveSnippetsList(this.plugin.snippetsList);

            void this.removeSnippetElement(id, snippetType);
            this.applySnippetUIChange(snippet, false);

            // 广播代码片段数据更新到其他窗口
            this.plugin.syncService?.broadcast({
                type: "snippet_delete",
                snippetId: id,
                snippetType: snippetType,
                previewState: isPreviewingSnippet(id, snippetType, this.plugin.config.realTimePreview),
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
     * 应用代码片段 UI 变更（仅本类内部：菜单项/对话框按钮的添加更新与移除）
     * @param snippet 代码片段
     * @param isAddOrUpdate 是否为添加或更新
     * @param copySnippet 副本代码片段
     */
    private applySnippetUIChange(snippet: Snippet, isAddOrUpdate: boolean, copySnippet?: Snippet) {
        const snippetMenuItem = this.plugin.menuView.menuItems?.querySelector(`.jcsm-snippet-item[data-id="${snippet.id}"]`) as HTMLElement;
        const dialog = document.querySelector(`${SNIPPET_DIALOG_SELECTOR}[data-snippet-id="${snippet.id}"]`) as HTMLDivElement;
        let deleteButton, confirmButton;
        if (dialog && !copySnippet) {
            // 创建代码片段副本时不需要更新原始代码片段的 Dialog 的按钮
            deleteButton = dialog.querySelector(".jcsm-dialog .jcsm-dialog-container button[data-action=\"delete\"]") as HTMLButtonElement;
            confirmButton = dialog.querySelector(".jcsm-dialog .b3-dialog__action button[data-action=\"confirm\"]") as HTMLButtonElement;
        }
        // 应用代码片段变更，修改相关的元素
        if (isAddOrUpdate) {
            // 打开菜单时才需要修改菜单项
            if (this.plugin.menuView.menu) {
                if (snippetMenuItem) {
                    // 有菜单项
                    if (copySnippet) {
                        // 在指定菜单项的上方插入新的副本菜单项
                        const snippetsHtml = this.plugin.menuView.genMenuSnippetsItems([copySnippet]);
                        snippetMenuItem.insertAdjacentHTML("beforebegin", snippetsHtml);
                    } else {
                        // 更新菜单项
                        const nameElement = snippetMenuItem.querySelector(".jcsm-snippet-name") as HTMLElement;
                        if (nameElement) nameElement.textContent = snippetTitle(snippet);
                        const publishSwitchElement = snippetMenuItem.querySelector("input[data-type='publishSwitch']") as HTMLInputElement;
                        if (publishSwitchElement) publishSwitchElement.checked = !snippet.disabledInPublish;
                        const snippetSwitchElement = snippetMenuItem.querySelector("input[data-type='snippetSwitch']") as HTMLInputElement;
                        if (snippetSwitchElement) snippetSwitchElement.checked = snippet.enabled;
                    }
                } else {
                    // 没有菜单项，在菜单项列表的顶部插入新的菜单项
                    const snippetsHtml = this.plugin.menuView.genMenuSnippetsItems([snippet]);
                    this.plugin.menuView.menuItems.querySelector(".jcsm-snippets-container")?.insertAdjacentHTML("afterbegin", snippetsHtml);
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
     * 刷新代码片段列表缓存（自拉权威列表并写入 plugin.snippetsList）
     * 拉取失败时返回 false（getSnippetsList 已弹错误提示），缓存保持原值。
     * @returns 是否刷新成功
     */
    async refreshSnippetsList(): Promise<boolean> {
        const snippetsList = await this.getSnippetsList();
        if (!snippetsList) return false;
        this.plugin.snippetsList = snippetsList;
        return true;
    }

    /**
     * 根据 ID 获取代码片段（副作用是更新插件 snippetsList）
     * @param id 代码片段 ID
     * @returns 代码片段 | false
     */
    async getSnippetById(id: string): Promise<Snippet | false | undefined> {
        if (!(await this.refreshSnippetsList())) {
            return false;
        }
        return this.plugin.snippetsList.find((snippet: Snippet) => snippet.id === id);
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
        return snippetsList;
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
     * 构建注入元素（CSS 为 <style>，JS 为 <script>）并追加到 document.head
     */
    private injectElement(snippet: Snippet, elementId: string): HTMLElement {
        if (snippet.type === "css") {
            const styleElement = document.createElement("style");
            styleElement.id = elementId;
            styleElement.textContent = snippet.content;
            document.head.appendChild(styleElement);
            return styleElement;
        }
        // JS
        if (!isValidJavaScriptCode(snippet.content)) {
            this.plugin.showErrorMessage(this.plugin.i18n.invalidJavaScriptCode);
        }
        const scriptElement = document.createElement("script");
        scriptElement.id = elementId;
        scriptElement.type = "text/javascript";
        // 思源的代码使用 .text ，这与 .textContent 是等效的，参考：https://developer.mozilla.org/en-US/docs/Web/API/HTMLScriptElement/text https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent
        scriptElement.textContent = snippet.content;
        document.head.appendChild(scriptElement);
        return scriptElement;
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
        if (previewState === undefined && isPreviewingSnippet(snippet.id, snippet.type, this.plugin.config.realTimePreview)) {
            // 如果开启了实时预览，并且打开了对应的 CSS 代码片段对话框，则在菜单项上开关代码片段的操作需要忽略
            // 问题案例：全局禁用 CSS，预览一个 CSS 片段，启用片段，在菜单禁用片段会导致预览元素被移除
            //  这是因为从菜单关闭时没有 previewState 参数，此时需要通过是否有实时预览中的代码片段对话框来判断
            return;
        }

        const elementId = snippetElementId(snippet.type, snippet.id);
        const element = document.getElementById(elementId);

        // ?? 空值合并运算符，当左侧值为 null 或 undefined 时返回右侧值，此处优先使用 enabled 的值
        const isEnabled = enabled ?? snippet.enabled;
        const isSnippetsTypeEnabledFlag = isSnippetsTypeEnabled(snippet.type);

        if (isEnabled && (isSnippetsTypeEnabledFlag || previewState)) {
            // 代码片段需要启用 && （该代码片段对应的类型是启用状态 || 正在预览该代码片段）→ 添加新元素
            if (!element || element.innerHTML !== snippet.content) {
                this.plugin.console.log("updateSnippetElement: remove old element:", element);
                element?.remove();
                const newElement = this.injectElement(snippet, elementId);
                this.plugin.console.log("updateSnippetElement: add new element:", newElement);
            }
        } else {
            // else 分支等效于 !isEnabled || (!isSnippetsTypeEnabled && !previewState)
            // 禁用 || (全局禁用 && 不是正在预览) → 则移除旧元素
            this.plugin.console.log("updateSnippetElement: remove disabled element:", element);
            element?.remove();
        }

        if (previewState === undefined && isEnabled && this.plugin.menuView.menu && snippet.type === this.plugin.snippetsType && !isSnippetsTypeEnabledFlag) {
            // 如果当前的操作是在非预览状态下、开启代码片段、开启了菜单、菜单上显示的是这个类型的代码片段、这个类型的代码片段是关闭状态 → 全局开关闪烁一下
            this.plugin.menuView.setSnippetsTypeSwitchBreathing();
        }

        // 需要弹出消息提示的情况：
        // 1. 修改：有旧代码 && 旧代码有效 && （新代码有效 || 新代码无效）等效于有新代码
        // 2. 删除：有旧代码 && 旧代码有效 && 没有新代码
        // 3. 禁用：有旧代码 && 旧代码有效 && 没有新代码
        // 以上合并为：有旧代码 && 旧代码有效 → 本质上是旧 JS 被修改/删除/禁用时无法立即生效
        if (snippet.type === "js" && element && element.innerHTML && isValidJavaScriptCode(element.innerHTML)) {
            // JS 代码片段元素更新需要弹出消息提示（通知 + 呼吸，见 SnippetsMenu.promptJSReloadRequired）
            await this.plugin.menuView.promptJSReloadRequired(4000);
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
        if (isPreviewingSnippet(snippetId, snippetType, this.plugin.config.realTimePreview)) return;

        const elementId = snippetElementId(snippetType, snippetId);
        const element = document.getElementById(elementId);
        // 删除 JS 代码片段需要弹出消息提示：有旧代码 && 旧代码有效（通知 + 呼吸，见 SnippetsMenu.promptJSReloadRequired）
        if (snippetType === "js" && element && element.innerHTML && isValidJavaScriptCode(element.innerHTML)) {
            await this.plugin.menuView.promptJSReloadRequired(4000);
        }
        element?.remove();
    }

    /**
     * 切换代码片段的开关状态（本窗口操作与同内核其他前端实例广播共用同一路径）
     * - 本地（origin 缺省为 local）：改内存 → 落库 → 更新元素 → 广播；若已打开该片段的 CSS 实时预览
     *   对话框，则跳过广播（开关状态由预览中的对话框接管，广播方窗口不推送）；
     * - 远程（origin 为 remote）：广播窗口已落库，本窗口仅同步元素与菜单开关 UI，不落库、不广播。
     * @param snippet 代码片段（本地取自列表/自拉；远程为按 snippetId 自拉的权威对象）
     * @param enabled 是否启用
     * @param origin 变更来源：local（本窗口操作）| remote（其他窗口广播）
     */
    async toggleSnippet(snippet: Snippet, enabled: boolean, origin: "local" | "remote" = "local") {
        // 在菜单上切换代码片段的开关状态要实时保存
        snippet.enabled = enabled;

        if (origin === "remote") {
            this.plugin.console.log("Handling switch state synchronization:", {snippetId: snippet.id, enabled});
            // 更新代码片段元素
            await this.updateSnippetElement(snippet);

            // 更新菜单中的开关状态（如果菜单已打开）
            if (this.plugin.menuView.menuItems) {
                const checkbox = this.plugin.menuView.menuItems.querySelector(`.jcsm-snippet-item[data-id="${snippet.id}"] input[data-type='snippetSwitch']`) as HTMLInputElement;
                checkbox && (checkbox.checked = enabled);
                this.plugin.console.log("toggleSnippetSync: checkbox", checkbox, "enabled", enabled);
            }
            return;
        }

        void this.saveSnippetsList(this.plugin.snippetsList);
        void this.updateSnippetElement(snippet);

        if (isPreviewingSnippet(snippet.id, snippet.type, this.plugin.config.realTimePreview)) {
            // 如果开启了实时预览，并且打开了对应的 CSS 代码片段对话框，则在菜单项上开关代码片段的操作需要忽略，不广播开关状态变更到其他窗口
            return;
        }

        // 广播开关状态变更到其他窗口
        this.plugin.syncService?.broadcast({
            type: "snippet_toggle",
            snippetId: snippet.id,
            enabled: snippet.enabled,
        });
    }

    /**
     * 切换代码片段的发布服务开关状态（本窗口操作与同内核其他前端实例广播共用同一路径）
     * 说明：这里所说的“跨窗口同步”指同一内核的不同前端实例（多 Electron 窗口 / 浏览器标签页 /
     * 移动端均连同一内核 WebSocket）；广播消息即“来自其他前端实例”，非跨设备同步。
     * disabledInPublish 是“将来发布到发布服务时该片段是否显示”的元数据：不更新注入元素，
     * 仅需保持各窗口菜单/编辑对话框的勾选一致。
     * 载荷 enabled 字段语义即 disabledInPublish：为 true 表示“不在发布服务中显示”，为 false 表示“允许发布”。
     * - 本窗口操作（origin 缺省为 local）：就地改 disabledInPublish → 落库 → 广播；
     * - 同内核其他前端实例广播（origin 为 remote）：广播实例已落库，本实例不落库、不广播，
     *   仅就地改列表副本并同步已打开菜单的 publishSwitch 勾选。
     * 发布服务会话（plugin.isPublish）不在广播网络内（收不到任何跨窗口消息，见 services/sync.ts），
     * 因此无需为其保留 remote 分支。
     * @param snippetId 代码片段 ID
     * @param enabled 是否禁用发布（即 disabledInPublish）
     * @param origin 变更来源：local（本窗口操作）| remote（同内核其他前端实例广播）
     */
    async toggleSnippetPublish(snippetId: string, enabled: boolean, origin: "local" | "remote" = "local") {
        this.plugin.console.log("toggleSnippetPublish:", { snippetId, enabled, origin });

        if (origin === "remote") {
            // 本窗口列表无该片段（从未自拉或已过期）时无需即时 UI 更新：下次自拉即得最新值
            const snippet = this.plugin.snippetsList.find((s: Snippet) => s.id === snippetId);
            if (!snippet) return;
            snippet.disabledInPublish = enabled;

            // 更新菜单中的开关状态（如果菜单已打开）
            // 注意：菜单 publishSwitch 的勾选语义为“允许发布”（checked = !disabledInPublish），
            // 而广播载荷 enabled 的语义为 disabledInPublish，故此处必须取反
            if (!this.plugin.menuView.menuItems) return;
            const checkbox = this.plugin.menuView.menuItems.querySelector(`.jcsm-snippet-item[data-id="${snippetId}"] input[data-type='publishSwitch']`) as HTMLInputElement;
            checkbox && (checkbox.checked = !enabled);
            return;
        }

        // 本窗口操作：菜单发布开关（本窗口调用点总是先 getSnippetById 自拉成功，片段必在列表中）
        const snippet = this.plugin.snippetsList.find((s: Snippet) => s.id === snippetId);
        if (!snippet) {
            this.plugin.console.error("toggleSnippetPublish: Snippet not found:", snippetId);
            return;
        }
        snippet.disabledInPublish = enabled;
        void this.saveSnippetsList(this.plugin.snippetsList);
        // 发布服务开关状态变更不需要更新注入元素（元素注入与 disabledInPublish 无关）

        // 广播发布开关状态变更到其他窗口（发布会话收不到广播，此处仅覆盖普通编辑前端）
        this.plugin.syncService?.broadcast({
            type: "snippet_toggle_publish",
            snippetId: snippet.id,
            enabled: snippet.disabledInPublish,
        });
    }

    /**
     * 切换某类型代码片段的全局开关状态（本窗口操作与同内核其他前端实例广播共用同一路径）
     * - 本地（origin 缺省为 local）：本窗口菜单开关。更新 config 镜像并调 /api/setting/setSnippet
     *   （内核即时广播，其他实例原生重渲染注入元素），收集本窗口实时预览中的片段 ID 随消息广播；
     * - 远程（origin 为 remote）：广播窗口已调 API，本窗口不重复调用，仅同步自身状态——更新 config
     *   镜像、刷新注入元素（跳过广播窗口正在实时预览的片段）与菜单全局开关 UI。
     * @param snippetType 代码片段类型
     * @param enabled 是否启用
     * @param origin 变更来源：local（本窗口操作）| remote（其他窗口广播）
     * @param remotePreviewingSnippetIds 广播窗口正在实时预览的片段 ID（仅远程使用，供本窗口跳过元素更新）
     */
    async globalToggleSnippet(snippetType: SnippetType, enabled: boolean, origin: "local" | "remote" = "local", remotePreviewingSnippetIds: string[] = []) {
        this.plugin.console.log("globalToggleSnippet:", { snippetType, enabled, origin });

        // 更新全局变量和配置
        const syConfig = window.siyuan.config!;
        if (snippetType === "css") {
            syConfig.snippet.enabledCSS = enabled;
        } else if (snippetType === "js") {
            syConfig.snippet.enabledJS = enabled;
        }

        if (origin === "remote") {
            // 如果接受广播的窗口没有打开过菜单，可能不存在 snippetsList，需要获取
            if (!this.plugin.snippetsList || this.plugin.snippetsList.length === 0) {
                if (!(await this.refreshSnippetsList())) {
                    this.plugin.console.error("globalToggleSnippet: Can not get snippetsList");
                    return;
                }
            }

            // 更新代码片段元素
            // 切换全局开关只会影响已启用的代码片段，所以过滤出来
            let filteredSnippets = this.plugin.snippetsList.filter((snippet: Snippet) => snippet.type === snippetType && snippet.enabled === true);
            if (this.plugin.config.realTimePreview) {
                // 忽略在广播的窗口中正在实时预览的 CSS 代码片段元素更新
                filteredSnippets = filteredSnippets.filter(snippet => !remotePreviewingSnippetIds.includes(snippet.id));
            }
            filteredSnippets.forEach((snippet: Snippet) => {
                // enabled 为 true 时，snippet.enabled 也一定为 true
                this.updateSnippetElement(snippet, enabled);
            });

            // 更新菜单中的全局开关状态（如果菜单已打开，并且显示的是这个类型的代码片段）
            if (this.plugin.menuView.menuItems) {
                const globalSwitch = this.plugin.menuView.menuItems.querySelector(`.jcsm-top-container[data-type="${snippetType}"] .jcsm-all-snippets-switch`) as HTMLInputElement;
                globalSwitch && (globalSwitch.checked = enabled);
            }
            return;
        }

        // 本地：调用内核 API（触发内核即时广播，其他实例原生全量重渲染注入元素）
        fetchPost("/api/setting/setSnippet", syConfig.snippet);

        // 更新代码片段元素（本地正在预览的片段由 updateSnippetElement 内部按 isPreviewingSnippet 跳过）
        // 切换全局开关只会影响已启用的代码片段，所以过滤出来
        const filteredSnippets = this.plugin.snippetsList.filter((snippet: Snippet) => snippet.type === snippetType && snippet.enabled === true);
        filteredSnippets.forEach((snippet: Snippet) => {
            // enabled 为 true 时，snippet.enabled 也一定为 true
            // updateSnippetElement 几乎不会抛出错误，但我们仍需要处理返回的 Promise 以满足 ESLint 要求
            this.updateSnippetElement(snippet, enabled).then();
        });

        let previewingSnippetIds: string[] = [];
        if (this.plugin.config.realTimePreview) {
            // 收集正在实时预览的代码片段 ID
            previewingSnippetIds = Array.from(document.querySelectorAll(`${SNIPPET_DIALOG_SELECTOR}[data-snippet-id]`)).map(item => item.getAttribute("data-snippet-id") as string);
        }

        // 广播全局开关状态变更到其他窗口
        this.plugin.syncService?.broadcast({
            type: "snippet_toggle_global",
            snippetType,
            enabled,
            previewingSnippetIds,
        });
    }

    /**
     * 构建跨窗口广播业务消息分发注册表
     * 供 BroadcastService 按 type 查表分发（services/sync.ts）；注册键内联“来源解析”后调本类
     * 对应方法并传 origin 为 "remote"（广播窗口已落库，本窗口不落库、不广播，仅同步自身状态）。
     * 协议不含片段原文（禁原文约束）：接收窗口一律按 snippetId 自拉权威数据后再走本地相同路径。
     */
    buildSyncHandlers(): Partial<BroadcastHandlers> {
        return {
            snippet_toggle: async ({snippetId, enabled}) => {
                // 远程开关：先自拉权威数据（协议不含片段原文），再走与本地相同的 toggleSnippet 路径
                const snippet = await this.getSnippetById(snippetId);
                if (!snippet) {
                    this.plugin.console.error("snippet_toggle: Snippet not found:", snippetId);
                    return;
                }
                await this.toggleSnippet(snippet, enabled, "remote");
            },
            snippet_toggle_publish: ({snippetId, enabled}) => this.toggleSnippetPublish(snippetId, enabled, "remote"),
            snippet_toggle_global: ({snippetType, enabled, previewingSnippetIds}) =>
                this.globalToggleSnippet(snippetType, enabled, "remote", previewingSnippetIds),
            snippet_save: async (payload) => {
                // 协议不含片段原文：接收窗口一律按 ID 自拉权威数据后，再与本地保存走同一路径（origin 为 remote）
                const {snippetId, isCopy, copySnippetId} = payload;
                if (!snippetId || isCopy === undefined || (isCopy && !copySnippetId)) {
                    this.plugin.console.error("snippet_save: Snippet or isCopy is missing:", payload);
                    return;
                }
                this.plugin.console.log("snippet_save", {snippetId, isCopy, copySnippetId});
                if (isCopy) {
                    // 复制：先按副本 ID 自拉服务端权威数据（getSnippetById 副作用刷新列表为权威顺序），
                    // 被复制原片段作为菜单项插入锚点，从刷新后的列表取
                    const copySnippet = await this.getSnippetById(copySnippetId!);
                    if (!copySnippet) {
                        this.plugin.console.error("snippet_save: copySnippet not found:", copySnippetId);
                        return;
                    }
                    const originalSnippet = this.plugin.snippetsList.find((s: Snippet) => s.id === snippetId);
                    if (!originalSnippet) {
                        this.plugin.console.error("snippet_save: original snippet not found:", snippetId);
                        return;
                    }
                    await this.saveSnippet(originalSnippet, true, "remote", copySnippet);
                    return;
                }
                // 更新/新增：先在自拉前捕获本窗口旧片段（自拉会刷新列表为权威态，旧片段将不可再取），再自拉权威新态
                const oldSnippet = this.plugin.snippetsList.find((s: Snippet) => s.id === snippetId);
                const snippet = await this.getSnippetById(snippetId);
                if (snippet === false || snippet === undefined) {
                    this.plugin.console.error("snippet_save: Snippet not found:", snippetId);
                    return;
                }
                await this.saveSnippet(snippet, false, "remote", undefined, oldSnippet);
            },
            snippet_delete: ({snippetId, snippetType, previewState}) =>
                this.deleteSnippet(snippetId, snippetType, "remote", previewState),
            snippet_element_update: async ({snippet, snippetId, previewState}) => {
                // 预览放行原文（豁免）：snippet 来自消息体（编辑中内容未保存、无法自拉）；
                // 未携带原文（退出预览）时按 ID 自拉已保存片段恢复
                let realSnippet = snippet;
                if (!realSnippet) {
                    const fetchedSnippet = await this.getSnippetById(snippetId!);
                    if (fetchedSnippet === false || fetchedSnippet === undefined) {
                        this.plugin.console.error("snippet_element_update: Snippet not found:", snippetId);
                        return;
                    }
                    realSnippet = fetchedSnippet;
                }
                await this.updateSnippetElement(realSnippet, undefined, previewState);
                this.plugin.console.log("snippet_element_update: updated snippet element for", realSnippet.id);
            },
            snippet_element_remove: ({snippetId, snippetType}) => this.removeSnippetElement(snippetId, snippetType),
            snippets_sort: async () => {
                this.plugin.console.log("snippetsSortSync");
                // 重新加载代码片段列表（读取权威态语义）并刷新菜单；失败时保持现状（getSnippetsList 已弹错误提示）
                if (!(await this.refreshSnippetsList())) return;
                this.plugin.menuView.menuItems && this.plugin.menuView.initSnippetsContainer();
            },
        };
    }
}
