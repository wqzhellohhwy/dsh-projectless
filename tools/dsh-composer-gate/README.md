# DSH composer gate 补丁

让 **「无工作区会话」的空白会话可以直接打字** —— 这是插件无法单独完成的一步，
需要给 DeepSeek Harness 本体的一个判定打 5 个字符的补丁。

## 一、为什么插件做不到

`dsh-client-ui-conversation` 决定输入框能不能用的那段代码（0.2.0-rc.2 与 0.2.1-alpha.1 相同）：

```js
const sessionWorkspace = sessionId === void 0 ? void 0
  : workspaces.items.find((w) => w.sessionIds.includes(sessionId));
const storedChipTitle = pendingWorkspace?.title
  ?? (sessionId === void 0 ? void 0
      : sessionWorkspace?.title
        ?? (workspaces.phase === "ready" || cwd === void 0 || cwd === "" ? void 0 : workspaceLabel(cwd)));
const inert = sessionId === void 0 || (hero && chipTitle === void 0);
// inert 为真时：
renderSlot("conversation.composer.bar", { disabled: true, placeholder: t("placeholder.workspace"), … })
```

- 空白会话 `hero = true`；
- `chipTitle` 只认 **「这个会话属于哪个工作区」**；
- 从 **`cwd` 兜底**的那条路被 `workspaces.phase === "ready"` **短路掉了**（列表就绪时永远走不到）。

于是：**不属于任何工作区的空白会话，输入框必然被禁用**（只显示「选择一个工作区开始」）。
而 `chipTitle` 与「侧边栏把它显示在未分组」用的是同一份数据，插件无法既让它显示在未分组、
又让它有归属标签。

插件侧的所有旁路都已验证走不通：

- `conversation.composer.bar` 插槽改 `disabled` —— 该 slot 在有会话时**不渲染**，
  实际渲染的是 `renderSlotChain("conversation.composer", …)` 上的
  `SubagentReadOnlyComposer` / `QuestionComposer` / `ApprovalPanel`；
- 让 `hero` 变 false —— 它只由「会话非空白 / 尝试发送过」决定，改不动；
- 给会话注入草稿、虚拟工作区、伪造 cwd —— 分别受 `shellPhase`、侧边栏同源数据、`phase` 短路限制。

## 二、补丁做了什么

**只改 5 个字符**：把那一处的 `"ready"` 换成 `"readx"`（等长，不动文件长度）。

```js
// 补丁前
?? (workspaces.phase === "ready" || cwd === void 0 || cwd === "" ? void 0 : workspaceLabel(cwd))
// 补丁后
?? (workspaces.phase === "readx" || cwd === void 0 || cwd === "" ? void 0 : workspaceLabel(cwd))
```

该比较于是**恒为 false**，短路失效，判定回落到 `cwd`：

| 会话 | 补丁前 | 补丁后 |
| --- | --- | --- |
| 属于某工作区（含"功能性会话"这类自建工作区） | `sessionWorkspace?.title` 生效 | **不变**（走同一分支） |
| 无工作区、有 cwd（插件建的无工作区会话） | 走 `?"ready"` → `void 0` → **输入框禁用** | 走 `workspaceLabel(cwd)` → 有标签 → **输入框可用** |
| 无工作区、无 cwd | `void 0` | **不变** |
| 没有会话（`sessionId === void 0`） | 外层已短路 | **不变** |

副作用仅限「工作区列表已就绪时、无 cwd 的会话」，实际不存在这种会话。

## 三、怎么打

```bash
ASAR="<DSH 安装目录>/resources/app.asar"

# 1) 备份（只备份一次；已存在则不覆盖）
node asar-patch.mjs backup "$ASAR"

# 2) 定位：记下输出的「数据区 偏移」
node asar-patch.mjs find "$ASAR" "dsh-client-ui-conversation\lib\client.js" 'workspaces.phase === "ready"'
#   会命中两处；要改的是**同一行里带 cwd 兜底**的那一处（输出会带上下文，形如
#   `sessionWorkspace?.title ?? (workspaces.phase === "ready" || cwd === void 0 …`）

# 3) 替换：偏移 +22 是 `"ready"` 的位置（`workspaces.phase === "` 共 22 字符）
node asar-patch.mjs peek   "$ASAR" $((偏移 + 22)) 5      # 应先看到 ready
node asar-patch.mjs splice "$ASAR" $((偏移 + 22)) "ready" "readx"

# 4) 验证
node asar-patch.mjs peek "$ASAR" $((偏移 + 22)) 5        # 应看到 readx
```

`peek` / `splice` 的偏移都是**文件数据区偏移**（`find` 第二列），不是文件内偏移。

## 四、怎么回滚

```bash
node asar-patch.mjs restore "<DSH 安装目录>/resources/app.asar"
```

## 五、注意

- **升级 DSH 会覆盖补丁**，升级后需要按上面步骤重打（偏移会变，用 `find` 重新定位）。
- 补丁改的是 DSH 本体、不是插件；仓库里的插件在**没有补丁**时也能工作，只是
  「新会话」会退回 DSH 原生行为（落在工作区里），不会造出打不了字的空会话。
- 工具只做**等长**替换，写入前逐字节校验，不匹配就拒绝；asar 结构（header/offset）完全不变。
