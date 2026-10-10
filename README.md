# dsh-projectless

**无工作区会话（Session without workspace）的完整实现** —— 一个 DeepSeek Harness 插件。
它把「无工作区会话」的目录供给、会话生命周期，和侧边栏排序行为放进同一个包，
不再需要「一个 provider + 一个补丁插件」两件套。

> English summary at the end.

---

## 一、这个插件做什么

DSH 原生只能在工作区里新建会话。本插件补上四件事：

### 1. 无工作区会话（选择器里的入口）

工作区选择器里多一项 **「无工作区会话」**。点它会：

1. 在 `~/Documents/DSH/YYYY-MM-DD/session-HH-mm-ss-随机串/` 建一个独立目录；
2. 把它登记成一个**临时工作区**；
3. 在临时工作区里创建并打开会话 —— 因此编辑器是**完整的原生界面**
   （Agent 预设、命令与附件、访问模式、模型选择、发送按钮全都在）；
4. DSH 接受第一条消息后，只注销那条**临时工作区注册**，会话与目录都留下，
   会话落到**未分组**区域，重启后可继续。

### 2. 新会话默认就是无工作区会话

侧边栏的「新会话」按钮原本会落到当前工作区（或最近使用的工作区）。装了本插件后，
**不带工作区的新会话**会直接开成无工作区会话；分组标题栏上的「+」仍然在该分组里建会话，
原生行为一点没变。

### 3. 侧边栏顺序

- **未分组永远在工作区分组之上**；
- 空白无工作区会话的临时分组，排在未分组**更上面**（新会话不会掉到列表底部）；
- 手动排序模式下，**每个分组都保持「最新在上」**。

### 4. 未发送的草稿会被保留 ← 本轮新增

在没有工作区的空白会话里打了字但没发送，然后点了别的会话：**文字还在**。
点回那个会话，输入框里的内容原样恢复，跟普通工作区新建会话一样。

---

## 二、安装

从 GitHub 源码装：

```bash
dsh plugin --profile <你的 profile> add github:<你的账号>/dsh-projectless
```

从本地目录装（开发时常用）：

```bash
dsh plugin --profile <你的 profile> add C:/path/to/dsh-projectless
```

装完重启正在跑的 `dsh`。卸载：

```bash
dsh plugin --profile <你的 profile> remove dsh-projectless
```

> 包内已声明 `dsh.bundle.patch`，所以重启后由 profile 的 bundles 自动装配；
> 运行时热注入（`loader.create`）与重启装配两条路径一致。

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

DSH `0.2.0-rc.2` 里，一个**没有已注册工作区**的空白会话会禁用原生编辑器。
所以插件的做法是「**先给一个临时工作区，用完再摘掉注册**」：

| 时刻 | 动作 |
| --- | --- |
| 新建 | 建目录 → 注册临时工作区 → 在其中建会话并打开 |
| 首条消息被接受（`blank === false`） | 只注销工作区注册；会话、cwd、日志、目录全部保留 |
| 用户**切走**但没发消息 | **什么都不做** —— 会话、注册、目录、草稿都留着 |
| 又新建了一个无工作区会话 | 回收**上一次**留下的那个空白会话（归档会话 + 注销注册 + 删空目录） |
| DSH 重启 | 清扫**上一次运行**遗留的空白临时工作区 |

「切走就回收」正是**草稿消失**的原因：DSH 把未发送的文字存在
`localStorage["dsh.conversation.<会话 id>"].draft` 里，按会话记账；
一旦会话被归档、从列表里消失，用户就再也点不回去，字自然「没了」。
现在切走不清、重启才清，草稿就有了存活空间。

### 安全边界（重要）

只有**本插件自己创建**的临时工作区会被回收：

- **新建时回收**只针对「本页面注册表里记过的」工作区；
- **重启清扫**额外要求分组标题等于插件自己的名字（「无工作区会话」）。

所以，即使你自己添加了一个路径恰好长成 `…/YYYY-MM-DD/session-…` 的工作区
（这在 DSH 里很常见），它也**不会**被插件当成临时目录回收。

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

## 八、已知取舍

1. **手动拖拽的顺序会被覆盖**。本插件的立场是各分组永远「最新在上」，
   下一次顺序刷新会写回时间序。
2. **同时只保留一个空白无工作区会话**：再新建一个时，上一个空白会话会被回收
   （连同它的草稿）。这与原生工作区略有不同，但能保证侧边栏不会堆出多个
   同名分组。
3. **重启会清扫上一次运行遗留的空白无工作区会话**，其草稿也就到此为止。
4. 「单一列表」视图不参与顺序维护。

---

## English summary

`dsh-projectless` is a DeepSeek Harness plugin that implements **Session without
workspace** end to end. It merges the former `dsh-projectless-session` provider
with the sidebar behaviour of `dsh-ungrouped-top` into one package:

- a **Session without workspace** entry in the Workspace picker, backed by a
  date-organised scratch directory (`~/Documents/DSH/YYYY-MM-DD/session-…`);
- the native blank-session composer while a projectless Session is open, and a
  clean hand-off to **Ungrouped** once the first prompt is accepted;
- an unqualified **new Session opens projectless**;
- **Ungrouped stays above every workspace group**, the temporary group above
  Ungrouped, and every group keeps newest-first order under manual sorting;
- an unsent draft survives clicking away: the blank Session is no longer
  reclaimed on navigation, only when a newer projectless Session is started or
  the next DSH run sweeps what a previous run left behind.

Install: `dsh plugin --profile <profile> add github:<you>/dsh-projectless`, then
restart DSH. Configuration, diagnostics and the scripted draft self-test are
described above. MIT licensed; upstream `dsh-projectless-session` copyright is
kept in [LICENSE](LICENSE).

---

## License

[MIT](LICENSE)
