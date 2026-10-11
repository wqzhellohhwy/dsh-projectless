# Changelog

## 1.8.0

### 修复：区分「销毁」与「保命」—— 删掉的图片不再自己冒出来

上一版把 `releaseDraftAttachment` 一律拦下，于是用户点 × 删掉的图，切走再切回会**复活**；
而一张永不过期的「会话 → ids」表还会把陈年图片补进**别的**会话（老会话也会突然刷出图）。
两个现象同一个病根：**把一个函数当成了只有一个含义**，而它其实从四个地方被调用：

| 来源 | 路径 | 应当 |
| --- | --- | --- |
| 用户点 × 删图 | `shell.removeAttachment` → release | **销毁** |
| 切会话导致 shell 销毁 | `shell.dispose()` → release | 保留 |
| 发送成功后 | `commandAttachments.release` → release | 销毁 |
| 切工作区移交 | 新 shell 接管后再 `removeAttachment` | 销毁 |

**关键判别信号**：只有「shell 销毁」这一条不经过 `shell.removeAttachment`。于是用保护集：

1. 包装 `shell.dispose` —— 销毁前把该 shell 的附件 id 放进**保护集**，并记下「会话 → ids」；
2. 包装 `shell.removeAttachment` —— 一旦调用即从保护集**移出**（这是"真的不要了"）；
3. 包装 `releaseDraftAttachment` —— **只拦保护集里的 id**，其余一律放行走原实现真正销毁。

隔离与过期：

4. **恢复只发生在一个 shell 对象第一次被见到时**（重建的 shell 是新对象），
   而不是"列表为空就补"——后者正是"删了又冒出来"的成因；
5. **记录用一次即弃**，并给表加上限（16 个会话）；LRU 上限（64）继续管内存。

实测（build 55，桌面版，合成真实粘贴 + 真实删除两步路径）：
```
after-paste                thumbs=1  live=1  shellIds=1
after-switch-back          thumbs=1  live=1  shellIds=1   ← 切换后保留 ✓
after-remove               thumbs=0  live=0  shellIds=0   ← 删除真的销毁 ✓
after-remove-switch-back   thumbs=0  live=0  shellIds=0   ← 删掉的不复活 ✓
```

回归测试扩到 6 组 21 项断言，其中第 2、3 组专门锁死这两个 bug；替身按 DSH 的真实调用
关系写成（`dispose` 会逐个 release、`removeAttachment` 成功后也会 release），并且强制
测试经过 `conversation.input.shell()` —— 绕过包装就等于没装插件，会给出假绿。
## 1.7.0

### 修复：图片跨会话丢失的第二层 —— shell 的附件 id 列表需要恢复

1.6.1 保住了字节，但实测仍然看不到图。写了**端到端探测**（合成真实粘贴 → 切走 → 切回，
每步采样）后，失败点自己报了出来：

```
after-paste        thumbs=1  live=1  shellIds=1  shellDraft=3
after-switch-away  thumbs=0  live=1  shellIds=0
after-switch-back  thumbs=0  live=1  shellIds=0  shellDraft=3   ← 字节在，画不出来
```

字节始终没丢（`live=1`），丢的是 `shell.snapshot.attachmentIds` —— 渲染走的是
`resolveDraftAttachments(input.attachmentIds)`，列表空了就什么都不画。文字草稿能回来，
是因为 DSH 把它镜像进 localStorage；附件的 id 列表没有对应机制。

修法：包装 `conversation.input.shell(id)` —— 挂 `shell.dispose` 记住 id 列表，之后拿到的
shell 若列表为空而表里有记录，用 `shell.addAttachments(ids)` 补回。幂等，且只在
「空列表 + 有记录」时动手，不覆盖正常状态。

实测（build 52）：`after-switch-back` 恢复为 `thumbs=1 chips=1 live=1 shellIds=1`，
计数 `restored=1`。

### 新增：可远程触发的端到端探测（`attachment-probe.ts`）

用 `ClipboardEvent` + `DataTransfer` 合成**真实粘贴**，走的是 DSH 的生产粘贴路径；
同时采样 DOM 缩略图数（用户看到的东西）与字节数（是否存在），两者分开报，
才能区分「数据丢了」和「画不出来」。命令：往 `%TEMP%\dsh-projectless-commands.json`
写 `{"commands":["attachment-roundtrip"]}`。

## 1.6.1

### 修复：附件保留从未生效 —— 服务晚注册，同步 get 必然拿不到

1.6.0 的包装装不上，功能**静默失效**。探针把真因钉死了：

```
attachments: {installed:false,
              lastError:'conversation service has no releaseDraftAttachment',
              probe:'typeof undefined'}
```

`probe` 是 `typeof undefined` —— `ctx.get('conversation')` 返回的就是 `undefined`，不是
「对象存在但没方法」；两种情况被我写进同一句话，掩盖了真相。原因是 `conversation` 服务由
DSH 自己的 conversation 插件（`ctx.plugin(ConversationController, …)`）注册，而它在本插件
**之后** apply，我在 apply 时同步 `get` 一次就再没试过。

改为 `ctx.inject(['conversation'], install)`。回归测试补上第 5 组用例专门覆盖晚注册场景，
mock 也补了 `inject`（否则测试会在错误假设下全绿）。

## 1.6.0

### 新增：粘贴的图片跨会话保留（所有会话，不限于未分组）

文字草稿会被 DSH 镜像进 localStorage，图片没有这个镜像：它只活在内存里，而
`releaseDraftAttachment(id)` 会同时做两件不可逆的事 —— 删表项、revoke 缩略图 URL。

新增 `attachments.ts`：包装该函数，把「销毁式释放」改成「延迟释放」，最近 64 个保留、
更旧的照常释放（内存有上限）。

## 1.5.0

### 修复：composer 插槽覆盖是死路，停用它并解除 ready 对它的依赖

修对 `children` 取值（1.4.2）后暴露出真正的终局，这条路两头都不通：

- **继承**内建 entry 的 `children` → 注册被拒：`slot "conversation.input.attachments" is
  already declared`（`children` 是「声明 + 授权 + 运行时 spec」三合一，重复声明即冲突）；
- **不继承** → 缺 `renderSlot` prop → 内建 InputBar 每次渲染抛 TypeError。

于是取消重试（注册错误含 `already declared` 即置 `givenUp` 并清掉 5 秒 interval ——
它此前每 5 秒必然失败一次，是长期异常与内存只增不减的来源之一）、`ready` 不再依赖
`gate.registered`（它恒 false 会让「新会话」整条流程退化）、`ENABLE_COMPOSER_GATE`
默认 false。**输入框可用一直靠 DSH 侧补丁，与 gate 无关。**

## 1.4.2

### 修复：从错位置读 children，导致 composer 插槽 entry 每次渲染都崩

`composer.ts` 从 `found.options?.children` 继承子插槽声明，但 DSH 的 `StoredEntry` 里
`children` 在**顶层**，`options` 下只有 `key/id/order/label/priority`。于是这里恒为
`undefined` —— 同一段代码紧挨着的 `found.locale` 却是对的，两种取法并存就是铁证。

后果链：覆盖 entry 没有 `children` → 渲染机制不派发 `renderSlot` → 原样转发的 InputBar
调 `renderSlot(...)` → TypeError → 每次渲染都崩。这也解释了长期异常的
`composerGate.opened` 恒为 0：gate 从未成功放行过。

## 1.4.1

### 修复：排序维护改回实时

1.4.0 为修「排序写入自激把侧边栏写空」加了「每个账户每页面只写一次」的限制，副作用是顺序
只在页面加载时校准一次，之后不再维护（实测 `b4054af3=2/2`、`db64ae36=6/87`，只有重启才恢复）。

改为**冷却 3 秒 + 写入有效性检测**（写后 400ms 回读；DSH 自己覆盖存储属正常，下次照写，
只有「永远不生效」才退役该账户）。实测所有分组 `outOfRecency` 归零。

## 1.4.0

### 新增：补丁工程化（面向任意用户，不再依赖本机路径）

之前两处 DSH 补丁是"手工算偏移 + 分步执行"，还硬编码了作者本机的 asar 路径，
别人拿去没法用。现在是一套脚本：

- `dsh-asar.mjs` —— 跨平台探测 `app.asar`（Windows / macOS / Linux 常见位置，
  也支持 `--asar` 与 `DSH_ASAR`），并提供等长字节替换原语。**不含任何本机路径。**
- `install-patches.mjs` —— 一个入口搞定两处补丁：
  - 找 asar → 备份 → 打补丁 → **逐处回读校验**；任一步对不上就停止，
    已写过则**从备份整体回滚**；
  - `--check` 只检查不改动；`--restore` 一键还原；
  - **幂等**：已打过的自动跳过。
- 补丁定义改为「**锚点 + 等长替换**」：锚点取在被替换文本**之前**且补丁前后不变，
  所以同一套判定既能识别「未打」也能识别「已打」—— 上一版把被替换文本放进了锚点里，
  打完补丁锚点自己就消失了，检查模式会误报「定位串未找到」。
- `splice` 改为按 **UTF-8 字节**比对与写入（补丁 2 含中文，逐字符比较会算错长度）。

### 新增：插件自带的补丁状态自检

Host 侧每次启动读一次应用归档，把结果写进诊断日志（`phase: "patch-check"`）。
从 UI 上「输入框还是灰的」和「补丁没打」是无法区分的，这条记录用来区分它们：

```json
{"phase":"patch-check","archive":"…\\app.asar","readable":true,
 "composerGate":true,"composerChip":true,"summary":"两处补丁均已生效"}
```

两个实现细节值得记下来：Electron 把 `app.asar` 当**目录**拦截，直接读会 ENOENT，
必须走 `original-fs`；归档按 latin1 读（一个字节一个字符），所以含中文的标记串
要先按 UTF-8 编码再转 latin1 才比得上。

### 文档

README 第二节重写：**明确写出「装完插件不等于装完」** —— 完整安装是
「装插件 + 打两处补丁 + 完全退出 DSH 重开」，并给出验证方法与升级后的注意事项
（npm 包不含 `tools/`，要打补丁必须克隆仓库）。

## 1.3.0

### 变更：每个对话恢复独立的工作目录

1.2.0 为了消灭「每点一次新会话就多一个目录」，把所有未分组会话改成**共享**一个
`ROOT/未分组` 目录。那解决了刷目录的问题，却把「每个对话独立」也一起丢掉了 ——
所有无工作区会话读写同一批文件，这不是「无工作区」应有的含义。

这一版把两件事拆开，让它们同时成立：

- **独立目录回来了**：没有可复用的空白会话时，照旧为这个对话建一个专属目录
  `ROOT/YYYY-MM-DD/session-HH-mm-ss-随机/`；
- **点新会话仍然不刷目录**：本页面刚开、还没发过消息的那个空白会话会被**直接复用**，
  既不建目录也不建会话，草稿留在原处；
- 首条消息被接受后，下次「新会话」才会开一个**新的目录 + 新的会话**。

复用集合刻意收窄为「**本页面**启动的空白会话」（不再按目录形状匹配）：
否则点「新会话」可能被送进几小时前遗留的旧空会话，拿到一个不属于本次对话的目录。

### 新增

- 第二处 DSH 侧补丁（`patch-composer-chip.mjs`）：把 hero 的工作区标签从
  「cwd 目录名」换成固定文案**「未分组」**。与前一处一样是**等长字节替换**
  （`workspaceLabel(cwd)` → `"未分组        "`，19 字节），改的是**使用点**而不是函数定义，
  可一键还原。不打这处补丁时独立目录与复用照常工作，只是标签显示 `session-…`。
- `tools/dsh-composer-gate/asar-patch.mjs` 的 `splice` 改为按 **UTF-8 字节**比对与写入
  （补丁内容含中文，逐字符比较会算错长度）。

### 实测（桌面版）

```
reuse.sameSession = true                ← 没发送就再点：同一会话，不建目录
reuse.cwd = …\session-18-06-30-81a367d1 ← 独立目录
draftKept.composerText = "Reply with…"  ← 草稿原样保留
afterSend.blank = false                 ← 发送成功
nextAfterSend = { isNewSession: true, hasOwnDirectory: true,
                  cwd: …\session-18-06-43-3963f608,
                  previousCwd: …\session-18-06-30-81a367d1 }
目录数 36 → 38                           ← 只有真正开始过的对话才占目录
```

## 1.2.0

### 变更：「新会话」复用同一个未分组会话

上一版虽然不再建临时工作区，但**每点一次「新会话」仍然会新建一个会话和一个专属目录**，
于是出现了三个问题（都是用户实测报出来的）：

1. 每点一次就多一个 `session-HH-mm-ss-xxxx` 目录（实测两分钟内攒了 13 个）；
2. 已经输入但没发送的文字，在下一次点「新会话」时丢失；
3. hero 的工作区标签显示的是那个专属目录名（形如 `session-08-54-15-xxxx`），
   看起来像「会话 ID 工作区」。

修法：工作目录改为**共享且稳定**的 `ROOT/<未分组>`（只建一次），目录名取 DSH 自己的
`group.ungrouped` 文案；点「新会话」时若已有「空白 + 无工作区 + `cwd` 等于该目录」的会话
就**直接复用**，否则才创建一个。会话仍不属于任何工作区，因此始终显示在未分组。

结果：不再产生新目录、草稿随会话保留、标签直接显示「未分组」。

- 新增 Host 端点 `ensure-group-directory`：`name` 只接受纯目录名（拒绝分隔符、盘符、`.`/`..`），
  确保不会在 root 之外创建任何东西。
- 实测（桌面版）：目录数 36 → 36（零新增）；`reuse.sameSession = true`；
  切走再点「新会话」后 `composerText` 仍是原文字；`cwd = …\未分组`；侧边栏分组数不变。

## 1.1.0

### 变更：新会话不再依赖任何工作区

「新会话」改为直接调用 `sessions.create({ cwd })` —— 会话**不属于任何工作区**，
一建立就在**未分组**里，侧边栏不会多出一个分组，也没有「建了再拆」的过程。

随之删掉的是整套临时工作区机制：注册与注销、`reclaim`（新建时回收上一个空白会话）、
启动清扫、注册表、认领集、临时分组标记与置顶样式。`reclaim` 会连带丢掉草稿，
现在这条路径不再存在。

### 新增

- **composer gate**：覆盖 `conversation.composer.bar` 插槽，让无工作区的空白会话
  输入框可用。gate 未就绪时「新会话」自动退回 DSH 原生行为，不会造出打不了字的会话。
- **DSH 侧补丁**（可选，5 个字符）：DSH 本体的 `chipTitle` 判定会把「无工作区的空白
  会话」的输入框强制置为 inert，这一处无法从插件侧旁路。补丁把该判定里的 `"ready"`
  换成 `"readx"`（等长替换），使 `cwd` 兜底生效。工具与说明见
  [`tools/dsh-composer-gate/`](tools/dsh-composer-gate/README.md)。
- 诊断新增 `composerChain` / `composerGate` / `boundSession` 等字段与一条渲染轨迹，
  用于判断「gate 是否真的接管了输入栏」。

### 修复

- **排序维护器会把侧边栏写空**（严重）：它把自己的写入重新触发成新的一轮写入，
  无限循环导致页面卡死、侧边栏一个分组都渲染不出来。现在每个分组每次页面加载最多写一次，
  且会话列表未就绪（`ids` 为空 / `phase` 非 ready）时绝不写入，也不用空顺序覆盖非空顺序。
- **composer gate 抹掉输入框**：DSH 的输入栏是 `React.memo(...)` 对象，
  `typeof !== 'function'` 的判定让它误以为没拿到组件而渲染 `null`。改为识别
  memo / forwardRef 的 `$$typeof`。
- gate 的注册改为订阅式（`slots.subscribe` + 重试阶梯），不再依赖一次性的
  `slots.inject` 回调，因此在页面已加载、插件热更新后才到达时也能生效。

## 1.0.0

合并版本：把 `dsh-projectless-session`（无工作区会话 provider）与 `dsh-ungrouped-top`
（侧边栏行为）合成一个包。

### 新增

- **未发送的草稿会被保留**：在没有工作区的空白会话里输入文字但不发送，点击别的
  会话后再回来，文字仍在。此前该会话会在「切走」的瞬间被注销工作区、归档并删除
  目录，而 DSH 的未发送文字正是按会话记账的
  （`localStorage["dsh.conversation.<会话 id>"].draft`），会话一消失，字也就没了。
- 新增**草稿演练**（`draft-selftest` 命令）：自动跑一次「新建 → 输入 → 切走 →
  切回」并回报 `restored` 结果，用于无人值守验证。
- 新增诊断上报的**命令通道**：Host 在每次自检的响应里带回命令文件中的指令，
  没有命令文件时不做任何事。

### 变更

- 空白会话的回收时机从「切走即回收」改为：
  - **又新建一个无工作区会话**时回收上一个空白会话；
  - **DSH 重启**时清扫上一次运行遗留的空白临时工作区。
- 回收范围加了双重护栏：新建时回收只针对本页面注册过的临时工作区；重启清扫
  还要求分组标题等于插件自己的名字。因此用户自建的、路径形状恰好相同的
  工作区不会被误回收。
- 插件卸载（fiber dispose）不再回收仍空白的会话 —— 草稿不会因为一次重载而丢失；
  它的残留交给下一次启动清扫。

### 保留自上游 / 前身的行为

- 选择器中的「无工作区会话」入口、临时工作区登记、首条消息后注销注册、
  会话进入未分组并保持可恢复（来自 `dsh-projectless-session` 0.6.1）。
- 未分组置顶、临时分组更靠上、「添加工作区…」沿用 DSH 组合的目录选择流程
  （来自 `dsh-ungrouped-top`）。
- 新会话默认走无工作区会话；分组标题栏的「+」不受影响。
- 手动排序模式下，每个已持有顺序的分组都会被拉回「最新在上」；「最近更新」
  模式下完全静默。
- 中英双语词典，跟随 DSH Language 设置。
