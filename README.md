# dsh-projectless

**无工作区会话（Session without workspace）的完整实现** —— 一个 DeepSeek Harness 插件。
它把「无工作区会话」的目录供给、会话生命周期，和侧边栏排序行为放进同一个包，
不再需要「一个 provider + 一个补丁插件」两件套。

> English summary at the end.

---

## 一、这个插件做什么

DSH 原生只能在工作区里新建会话：没有归属的会话在界面上是残缺的（编辑器被禁用），
而「新建」这个动作又总是落到某个工作区上。本插件补上这些：

### 1. 无工作区会话（选择器里的入口）

工作区选择器里多一项 **「无工作区会话」**。点它会：

1. 在 `~/Documents/DSH/YYYY-MM-DD/session-HH-mm-ss-随机串/` 建一个**该对话专属**的目录；
2. 用 `sessions.create({ cwd })` 建会话 —— **不登记任何工作区**，因此它天然属于**未分组**，
   侧边栏不会多出分组，也不存在「建了再拆」或事后回收；
3. 会话界面上是完整的原生编辑器（Agent 预设、命令与附件、访问模式、模型选择、发送按钮都在）。

> **每个对话一个独立目录**，不是一个共用目录 —— 无工作区会话之间互不干扰彼此的文件。

### 2. 「新会话」默认就是无工作区会话

侧边栏的「新会话」按钮原本落到当前工作区（或最近使用的工作区）。装了本插件后，
**不带工作区的新会话**直接开成无工作区会话；分组标题栏上的「+」仍在**该分组内**建会话，
原生行为一点没变。

### 3. 复用而不是重建（所以连点不会刷目录、也不会吃掉草稿）

点「新会话」时，如果**本页面刚开的那个空白会话**还在（没发过消息、不属于任何工作区），
就**直接复用它**：不建目录、不建会话，草稿留在原处。

- 连续点「新会话」→ 始终是同一个会话，**目录数量不变**；
- 输入了文字或贴了图但没发送，切走再点回来 → **内容还在**；
- 一旦**发过消息**，下次「新会话」才开**新的目录 + 新的会话**。

复用只认「本页面启动的空白会话」，不会去翻历史遗留的空会话，避免被塞进几小时前的旧目录。

### 4. 侧边栏顺序

- **未分组永远在工作区分组之上**；
- **手动排序模式下，每个分组都保持「最新在上」**，并且是**实时**的 —— 每 3 秒一次节流写入，
  写后回读校验；只有「怎么写都写不进去」的账户才会停手，不会自激刷屏；
- 「最近更新」排序模式下**静默**，尊重 DSH 自己的顺序。

### 5. 未发送的草稿会保留（文字）

在无工作区的空白会话里打了字但没发送，然后点了别的会话：**文字还在**。点回来，输入框里的
内容原样恢复，跟普通工作区新建会话一样。

### 6. 粘贴的图片跨会话保留

贴进输入框的图片，切到别的会话再切回来**仍然在**。这条**对所有会话生效**（未分组与各个
工作区一视同仁），实现上分两层：

- **字节层**：拦截 DSH 的 `releaseDraftAttachment` —— 但**只拦「因 shell 销毁而释放」的那一批**，
  条目留在 DSH 自己的表里、缩略图 URL 不被 revoke；只保留最近 64 个，更旧的照常释放，
  内存有上限。
- **渲染层**：记住会话输入壳的附件 id 列表，某个 shell **第一次**被见到且列表为空时补回去。
  （只保住字节不够 —— 渲染读的是那份 id 列表，列表空了就什么都不画，不论字节在不在。）

**删掉的图不会自己回来**。DSH 的 `releaseDraftAttachment` 从四个地方被调用，只有「切会话导致
shell 销毁」这一条不该真删，而它恰好是唯一**不**经过 `shell.removeAttachment` 的那条 ——
插件就用这个信号区分：

| 来源 | 判据 | 结果 |
| --- | --- | --- |
| 用户点 × 删图 | 经过 `removeAttachment` | **真的销毁**，切走切回也不会复活 |
| 切会话 shell 销毁 | **不**经过 `removeAttachment` | 保留 |
| 发送成功后 | 不经过 | 真的销毁 |
| 切工作区移交 | 经过（附件已归新 shell） | 真的销毁 |

恢复是**用一次即弃**的，并只针对「刚重建的 shell」，因此不会把陈年图片补进别的会话。

> 仍然不做：**跨页面刷新**。blob URL 无法跨刷新存活，要保住必须把字节存进 IndexedDB 并在
> 恢复时重新上传，属于另一量级的改动。

### 7. 未分组标签显示「未分组」

无工作区会话在 hero 上的工作区标签固定显示 **「未分组」**，而不是它那份 `session-…` 目录名。
这一条需要[第二处 DSH 侧补丁](#八为什么需要给-dsh-本体打补丁)。

### 8. 诊断与自检

- 页面每次装载与运行期**定期上报**一张 JSONL 快照（侧边栏分组数、排序偏离度、补丁状态、
  会话与目录情况）；
- **补丁状态自检**：Host 每次启动读一次应用归档，明确告诉你两处补丁在不在 ——
  因为「输入框还是灰的」和「补丁没打」在界面上长得一模一样；
- **可远程触发的命令通道**：往 `%TEMP%\dsh-projectless-commands.json` 写命令即可让下一次
  页面加载执行一次自检（新会话往返、草稿往返、图片往返），结果写回诊断文件。

---

## 二、安装

> ### ⚠️ 装完插件不等于装完
>
> **装插件只是第一步。** 本插件有两个效果必须由**DSH 本体**配合才能生效：
> 「空白新会话能直接打字」和「hero 标签显示未分组」。这两处都在 DSH 的
> `app.asar` 里，任何插件都无法在运行时改它们（原因见
> [第八节](#八为什么需要给-dsh-本体打补丁)）。
>
> 所以完整安装 = **装插件 + 打两处补丁 + 重启**。只装插件也不会坏 ——
> 插件会自动退回 DSH 原生行为（新会话落在当前/最近的工作区），只是少了这两个效果。

### 第 1 步：装插件

从 GitHub 源码装（注意：**补丁脚本不在 npm 包里**，需要克隆整个仓库才有）：

```bash
git clone https://github.com/wqzhellohhwy/dsh-projectless
dsh plugin --profile <你的 profile> add /path/to/dsh-projectless
```

或者直接从仓库安装：

```bash
dsh plugin --profile <你的 profile> add github:wqzhellohhwy/dsh-projectless
# ⚠️ 这条装不到补丁脚本，补丁需要另外克隆仓库（见第 2 步）
```

卸载：

```bash
dsh plugin --profile <你的 profile> remove dsh-projectless
```

> 包内已声明 `dsh.bundle.patch`，所以重启后由 profile 的 bundles 自动装配；
> 运行时热注入（`loader.create`）与重启装配两条路径一致。

### 第 2 步：给 DSH 本体打两处补丁

在**克隆下来的仓库**里执行（脚本会自动探测 DSH 安装位置，Windows / macOS / Linux 都适用）：

```bash
node tools/dsh-composer-gate/install-patches.mjs
```

它会：找 `app.asar` → 备份成 `app.asar.bak-projectless` → 打两处**等长字节替换** → 逐处回读校验。
任何一步对不上（找不到锚点、出现多次、字节不符）都会**停止并在必要时整体回滚**，不会留下半截状态。

找不到安装位置时显式指定：

```bash
node tools/dsh-composer-gate/install-patches.mjs --asar "/path/to/resources/app.asar"
```

**只检查不改动**：

```bash
node tools/dsh-composer-gate/install-patches.mjs --check
```

**一键还原**（升级 DSH 后如果不想再打，或想彻底恢复原样）：

```bash
node tools/dsh-composer-gate/install-patches.mjs --restore
```

### 第 3 步：完全退出 DSH 再打开

补丁在**启动时**读入内存，**刷新页面不够**，必须退出进程重开。

### 第 4 步：确认

```bash
node tools/dsh-composer-gate/install-patches.mjs --check
# [✓] composer-gate: 已打
# [✓] composer-chip: 已打
# 结论：两处补丁都已生效。
```

插件自己也会检查：每次 DSH 启动时把结果写进诊断日志（`%TEMP%/dsh-projectless-diagnostics.json`，
见[第七节](#七诊断与自检)），字段是 `phase: "patch-check"`：

```json
{"phase":"patch-check","readable":true,"composerGate":true,"composerChip":true,
 "summary":"两处补丁均已生效"}
```

### ⚠️ 升级 DSH 之后

DSH 升级会**覆盖 `app.asar`，补丁随之丢失**。升级后重新执行第 2 步即可（脚本是幂等的，
已打过的会跳过）。补丁丢失期间插件照常工作，只是那两个效果消失。

---

## 三、配置

在 profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: dsh-projectless
  name: dsh-projectless
  config:
    # 临时目录的父目录，默认 ~/Documents/DSH
    root: /absolute/path/to/DSH
    # 客户端自检上报（默认开）；写 JSONL，用来判断「插件装了但没生效」
    diagnostics: true
    diagnosticsFile: /absolute/path/dsh-projectless-diagnostics.json
    # 命令文件：写 {"commands":["draft-selftest"]} 后下次页面加载会跑一次草稿演练
    commandsFile: /absolute/path/dsh-projectless-commands.json
```

---

## 四、生命周期（为什么会这样设计）

DSH 里「不属于任何工作区的空白会话」有两个硬约束：**输入框默认被禁用**（解开的办法见
第八节），以及**会话必须先存在**才渲染得出输入框。所以「新会话」不可能凭空出现 ——
它一定对应一个真实的会话实例。

本插件的原则是：**每个对话有自己的工作目录，而"新会话"只在真的需要时才动手。**

| 时刻 | 动作 |
| --- | --- |
| 点「新会话」（没有可复用的空白会话） | 建**该对话专属的目录** `ROOT/YYYY-MM-DD/session-HH-mm-ss-随机/` → 用它建一个**不属于任何工作区**的会话 |
| 点「新会话」（本页面刚开的那个还空着） | **直接复用它** —— 不建目录、不建会话，草稿留在原处 |
| 用户切走 | 什么都不做 —— 会话留在原处，草稿也跟着会话 |
| 首条消息被接受后 | 它成为一个正式对话（仍在未分组）；下次「新会话」会开一个**新的目录 + 新的会话** |

于是三件事同时成立：

- **每个对话一个独立目录**（互不干扰），
- **连点「新会话」不会刷出目录、也不会吃掉草稿** —— 只有真正开始过的对话才占目录，
- hero 的工作区标签显示 **「未分组」/「Ungrouped」**，而不是那个 `session-…` 目录名。

复用只认**本页面刚开的那个**空白会话（`isReusable`），不会去翻历史遗留的空会话 ——
否则你点「新会话」时可能被塞进一个几小时前的旧目录里。

### 为什么不「发送时才建」

理想形态确实是「点新会话什么都不建，发送那一刻才建会话和目录」，但 DSH 当前架构下做不到：
输入框必须挂在已存在的会话上才渲染（`sessionId === void 0` 时显示的是「选择一个工作区开始」），
而草稿也按会话记账（`localStorage["dsh.conversation.<会话 id>"]`）—— 没有会话，既没有可输入的
界面，也没有地方存字。所以本插件取的是等价效果：**点新会话不产生任何新东西**
（不建目录、不建会话），只是回到那个还空着的会话。

### 标签为什么需要一处 DSH 补丁

DSH 用「cwd 的目录名」当 hero 的工作区标签，所以独立目录必然显示成 `session-08-54-15-xxxx`。
本仓库附带的第二处 asar 补丁把这处调用换成固定文案「未分组」（等长替换，可一键还原），
见 [`tools/dsh-composer-gate/`](tools/dsh-composer-gate/README.md)。不打这处补丁时，
独立目录与复用都照常工作，只是标签显示目录名。

---

## 五、合并说明

本包是两个插件的合并产物：

| 来源 | 提供的能力 |
| --- | --- |
| [`dsh-projectless-session`](https://github.com/jarvisluk/dsh-projectless-session) 0.6.1（MIT，作者 Jarvis Luk） | 目录供给、临时工作区、空白会话生命周期、选择器 UI、双语词典 |
| `dsh-ungrouped-top` 1.3.0（本项目前身） | 未分组置顶、临时分组置顶、各分组「最新在上」、新会话默认无工作区 |

合并的动机：`dsh-ungrouped-top` 早就不是「补丁」了 —— 它要负责新会话默认行为、
排序维护和置顶，而另一半（provider）负责目录与会话供给，两者必须一起改才能修复
「切走丢草稿」这类问题。合成一个包后，生命周期只剩一处真相。

上游版权声明保留在 [LICENSE](LICENSE) 中。

---

## 六、开发

```bash
npm ci
npm run verify   # tsc --noEmit + esbuild 构建 host 与 client
npm pack
```

产物：

- `lib/index.js` —— Host 面（ESM，DSH 按 `main` 加载）
- `lib/client.js` —— Client 面（CJS，页面通过 `window.__ModuleLoader__.load` 注入）

源码布局：

```text
src/
  index.ts              Host 面：/api 上的目录端点 + 诊断端点
  host/directories.ts   目录创建/删除的安全约束
  shared/               Host 与 Client 共用的路径规则、RPC 地址
  client/index.tsx      选择器组件 + apply（装配）
  client/session.ts     会话/工作区生命周期（含回收策略）
  client/sidebar.ts     侧边栏顺序、置顶、新会话默认行为
  client/selftest.ts    草稿演练（由命令触发）
  client/diagnostics.ts 自检上报
```

---

## 七、诊断与自检

插件装了但「看起来没反应」时，先看诊断文件（默认 `%TEMP%/dsh-projectless-diagnostics.json`，
macOS/Linux 为系统临时目录）：

```jsonc
{"payload":{"phase":"applied","plugin":"dsh-projectless@1.0.0","build":3,
 "wrapperInstalled":true,"label":"无工作区会话","orderBy":"manual",
 "storedAccounts":{"<工作区 id 前 8 位>":{"members":87,"outOfRecency":0}},
 "sidebarSections":5,"taggedTemporarySections":0}}
```

- `wrapperInstalled: false` → 新会话默认行为没装上（页面过期，刷新一次）；
- `storedAccounts[*].outOfRecency > 0` → 那个分组的顺序还没被拉回「最新在上」；
- 文件里没有 `applied` 行 → 客户端压根没跑（页面未加载 / 插件未装配）。

### 草稿演练（可选）

往命令文件写 `{"commands":["draft-selftest"]}`，然后重新加载页面，插件会跑一次
完整的「新建 → 输入 → 切走 → 切回」并上报结果：

```jsonc
{"phase":"draft-selftest","createdSession":"session-…","typed":"execCommand",
 "afterLeaving":{"blank":true,"workspaceKept":true,"draft":"DSH-…-PROBE-…"},
 "afterReturning":{"composerText":"DSH-…-PROBE-…"},"restored":true}
```

`restored: true` 就是「切走再回来，字还在」的机器可读结论。

---

## 八、为什么需要给 DSH 本体打补丁

**「点新会话 → 直接落在未分组」这半边插件自己就能做到**：会话经
`sessions.create({ cwd })` 建立，**不注册任何工作区**，因此它天然属于未分组，
侧边栏也不会多出一个分组，更不存在「建了再拆」和回收。

需要补丁的是另外两件事，它们都在 DSH 本体里：

### 1. 空白新会话的输入框被禁用

```js
const inert = sessionId === void 0 || (hero && chipTitle === void 0);
// chipTitle 只认「会话属于哪个工作区」，从 cwd 兜底的那条路被
// `workspaces.phase === "ready"` 短路掉了
```

无工作区的空白会话因此**必然**被禁用输入框（只显示「选择一个工作区开始」）。
**这一处插件无法旁路** —— 插槽链、`hero`、草稿、虚拟归属、外壳状态都逐一验证过，改不动它，
证据与失败路径见 [`tools/dsh-composer-gate/README.md`](tools/dsh-composer-gate/README.md)。

### 2. hero 的工作区标签显示目录名

`dsh-client-ui-conversation` 用 `workspaceLabel(cwd)`（即目录的 basename）当标签，
而本插件给每个对话一个独立目录，标签就会显示成 `session-08-54-15-xxxx`。
（有意思的是 DSH 自己的另一个包里，同名函数**有**「未分组」分支，注释称之
`empty ungrouped marker` —— 这条路径漏了。）

### 补丁做了什么

两处都是**等长字节替换**，不改变文件长度、不重打包：

| 补丁 | 替换 | 效果 |
| --- | --- | --- |
| `composer-gate` | `workspaces.phase === "ready"` → `"readx"` | 该比较恒假、短路失效，判定回落到 `cwd`，输入框可用 |
| `composer-chip` | `workspaceLabel(cwd)` → `"未分组        "` | hero 标签固定显示「未分组」 |

安装与还原见[第二节第 2 步](#第-2-步给-dsh-本体打两处补丁)：

```bash
node tools/dsh-composer-gate/install-patches.mjs            # 打补丁
node tools/dsh-composer-gate/install-patches.mjs --check    # 只检查
node tools/dsh-composer-gate/install-patches.mjs --restore  # 还原
```

脚本按**锚点**定位（不依赖版本相关的偏移），锚点取得比被替换的文本更靠前，
所以同一套判定既能识别「未打」也能识别「已打」；任一处对不上就整体不写、必要时回滚。

**不打补丁也完全能用**：插件会自动退回 DSH 原生行为（新会话落在当前/最近的工作区），
不会造出「落了未分组却打不了字」的空会话。**升级 DSH 会覆盖补丁**，重跑一次第 2 步即可。

---

## 九、已知取舍

1. **手动拖拽的顺序会被覆盖**。本插件的立场是各分组永远「最新在上」，
   下一次顺序刷新会写回时间序（有 3 秒节流，并且写后校验，不会自激）。
2. **空白无工作区会话立刻能打字，依赖上面那两处 DSH 侧补丁**；没打补丁时
   「新会话」走 DSH 原生路径，标签显示目录名。
3. **无工作区会话没有「载体工作区」**：插件不创建临时工作区，也没有回收逻辑 ——
   会话一直留在未分组里，草稿与图片都跟着会话走。
4. **粘贴的图片只在「切会话」范围内保留**，跨页面刷新仍会丢（blob URL 无法跨刷新存活，
   要保住必须把字节存进 IndexedDB 并在恢复时重新上传）。保留上限 64 个，更旧的照常释放；
   主动删除（点 ×）与发送成功会**真的销毁**，不占用这份额度。
5. 「单一列表」视图不参与顺序维护。
6. `conversation.composer.bar` 的插槽覆盖是**已知死路**（继承 `children` 会与内建 entry
   的子插槽声明冲突，不继承则缺 `renderSlot` 而每次渲染抛错），因此该功能默认关闭，
   代码留档说明；输入框的可用性由 DSH 侧补丁保证。

---

## English summary

`dsh-projectless` is a DeepSeek Harness plugin that implements **Session without
workspace** end to end. It merges the former `dsh-projectless-session` provider
with the sidebar behaviour of `dsh-ungrouped-top` into one package:

- a **Session without workspace** entry in the Workspace picker, backed by a
  per-conversation directory (`~/Documents/DSH/YYYY-MM-DD/session-…`) — sessions
  never share a working directory;
- the Session belongs to **no Workspace at all**, so it lands under **Ungrouped**
  with no grouping to create or reclaim;
- an unqualified **new Session opens projectless**, and **reuses** the page's own
  blank projectless Session instead of creating another one — clicking twice does
  not churn directories and does not discard a draft;
- **Ungrouped stays above every workspace group**, and every group keeps
  newest-first order under manual sorting, refreshed live;
- an unsent **text draft** survives navigating away, and so do **pasted images**:
  the attachments are kept alive past DSH's destructive release, and the shell's
  attachment-id list is restored when it comes back empty;
- a diagnostics channel plus patch self-check, since "the composer is still inert"
  and "the patch was never applied" look identical in the UI.

Note: usable paste-in-a-blank-projectless-Session still requires two small patches
to DSH's own `app.asar` (shipped under `tools/dsh-composer-gate/`, applied with one
command, reversible), and image retention does not survive a page reload.

Install: `dsh plugin --profile <profile> add github:<you>/dsh-projectless`, then
restart DSH. Configuration, diagnostics and the scripted draft self-test are
described above. MIT licensed; upstream `dsh-projectless-session` copyright is
kept in [LICENSE](LICENSE).

---

## License

[MIT](LICENSE)
