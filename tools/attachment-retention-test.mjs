// 附件保留逻辑的验证脚本 —— 不需要启动 DSH，也不需要粘贴图片。
//
// 加载真实的 src/client/attachments.ts（Node 的类型剥离），喂一个**模拟 DSH 行为**的
// conversation + input shell 替身，然后断言六组行为：
//   1. 会话切换（shell 销毁）引起的释放必须被拦下 —— 字节与缩略图都留下
//   2. 用户点 × 删图（shell.removeAttachment）引起的释放必须**真的销毁** —— 这是
//      「删了又自己冒出来」那个 bug 的回归测试
//   3. 恢复只发生在一个 shell 第一次被见到时，且记录用一次即弃 —— 同一个 shell
//      反复取用不会再被填充
//   4. LRU 上限仍然把最旧的真正释放掉（内存有上限）
//   5. 重复安装幂等（bundle 重载会再调一次）
//   6. 服务晚注册时必须靠 inject 才装上（线上静默失效过的真因）
//
// 替身按 DSH 的调用关系写成：shell.dispose() 会逐个调用 releaseDraftAttachment
// （lib/client.js:14273），shell.removeAttachment() 成功时也会调用一次
// （lib/client.js:18401）。只有把这两条路径都照实模拟，测试才有意义。
//
// 用法：node tools/attachment-retention-test.mjs
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// import() on Windows rejects a bare drive-letter path; it wants a file:// URL.
const source = pathToFileURL(join(here, '..', 'src', 'client', 'attachments.ts')).href

const module = await import(source).catch((reason) => {
  console.error('无法加载 attachments.ts（需要 Node 22+ 的类型剥离）：')
  console.error(String(reason).split('\n')[0])
  process.exit(1)
})
const { keepDraftAttachments } = module

let failures = 0
const check = (label, ok, detail) => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${detail === undefined ? '' : `  ${detail}`}`)
  if (!ok) failures += 1
}

/** conversation 服务替身，releaseDraftAttachment 与 DSH 的两步销毁对齐。 */
function makeConversation() {
  const draftAttachments = new Map()
  let realReleases = 0
  /** sessionId → shell。DSH 的 shellFor 语义：有则复用，无则新建。 */
  const shells = new Map()
  const conversation = {
    draftAttachments,
    input: {
      shell: (id) => {
        if (!shells.has(id)) shells.set(id, makeShell())
        return shells.get(id)
      },
    },
    get realReleases() { return realReleases },
    releaseDraftAttachment(id) {
      if (draftAttachments.get(id) === undefined) return
      draftAttachments.delete(id)
      realReleases += 1
    },
  }

  /** 一个 input shell 替身，dispose / removeAttachment 都会回调 conversation。 */
  const makeShell = () => {
    const state = { attachmentIds: [], draft: '' }
    return {
      snapshot: state,
      addAttachments(ids) {
        state.attachmentIds = [...state.attachmentIds, ...ids]
        return true
      },
      removeAttachment(attachmentId) {
        const next = state.attachmentIds.filter(id => id !== attachmentId)
        if (next.length === state.attachmentIds.length) return false
        state.attachmentIds = next
        conversation.releaseDraftAttachment(attachmentId)
        return true
      },
      dispose() {
        const ids = [...state.attachmentIds]
        state.attachmentIds = []
        for (const id of ids) conversation.releaseDraftAttachment(id)
        return ids
      },
    }
  }

  return {
    conversation,
    shells,
    /**
     * 装一个附件，模拟「粘贴」：进 DSH 的表，也进 shell 的 id 列表。
     * 必须经由 conversation.input.shell() —— 包装就挂在那条路径上，
     * 绕过它就等于没装插件，测试会给出假结论。
     */
    paste(sessionId, attachmentId) {
      const shell = conversation.input.shell(sessionId)
      conversation.draftAttachments.set(attachmentId, { id: attachmentId, kind: 'image', previewUrl: `blob:${attachmentId}` })
      shell.snapshot.attachmentIds = [...shell.snapshot.attachmentIds, attachmentId]
      return shell
    },
    /**
     * 模拟「切走」：销毁 shell 后丢弃它，再取一次（DSH 会重建一个空的）。
     * 同样必须走 conversation.input.shell()。
     */
    switchAway(sessionId) {
      conversation.input.shell(sessionId).dispose()
      shells.delete(sessionId)
      return conversation.input.shell(sessionId)
    },
  }
}

/**
 * 一个最小 ctx：模仿 cordis 的 get / effect / inject。
 *
 * `inject` 是关键 —— DSH 的 conversation 服务由另一个插件晚注册，apply 时
 * `get` 必然返回 undefined，所以真实实现必须靠 inject 等它就绪。
 */
function makeContext(conversation, { visible = true } = {}) {
  const ctx = {
    get(name) {
      if (name === 'conversation' && visible) return conversation
      return undefined
    },
    effect(fn) {
      fn()
      return () => {}
    },
    inject(_names, callback) {
      visible = true
      callback(ctx)
      return () => {}
    },
  }
  return ctx
}

console.log('=== 1. 会话切换（shell 销毁）引起的释放必须被拦下 ===')
{
  const world = makeConversation()
  const ctx = makeContext(world.conversation)
  const stats = keepDraftAttachments(ctx, 'test')
  check('包装安装成功', stats.installed, `lastError=${stats.lastError ?? '(无)'}`)
  world.paste('s1', 'img-1')
  world.switchAway('s1')
  check('销毁后字节仍在（缩略图可继续渲染）', world.conversation.draftAttachments.has('img-1'))
  check('原实现未被调用（blob URL 未被 revoke）', world.conversation.realReleases === 0, `realReleases=${world.conversation.realReleases}`)
  check('deferred 计数 +1', stats.deferred === 1, `deferred=${stats.deferred}`)
}

console.log('\n=== 2. 用户点 × 删图，必须真的销毁（回归：删了不能自己冒出来）===')
{
  const world = makeConversation()
  const ctx = makeContext(world.conversation)
  const stats = keepDraftAttachments(ctx, 'test')
  world.paste('s1', 'img-2')
  const shell = world.conversation.input.shell('s1')
  const removed = shell.removeAttachment('img-2')
  check('移除调用成功', removed === true)
  check('字节被真正销毁（不再被拦）', !world.conversation.draftAttachments.has('img-2'))
  check('原实现确实被调用', world.conversation.realReleases === 1, `realReleases=${world.conversation.realReleases}`)
  check('forgotten 计数 +1（记录了这是一次主动删除）', stats.forgotten === 1, `forgotten=${stats.forgotten}`)
  // 再切走一次：删除过的图不能借「记住的 id」复活
  world.switchAway('s1')
  check('切走后仍然没有复活', !world.conversation.draftAttachments.has('img-2'))
}

console.log('\n=== 3. 恢复只发生在一个 shell 第一次被见到时（用一次即弃）===')
{
  const world = makeConversation()
  const ctx = makeContext(world.conversation)
  const stats = keepDraftAttachments(ctx, 'test')
  world.paste('s1', 'img-3')
  world.switchAway('s1')
  world.conversation.input.shell('s1')          // 新 shell 第一次被见到 → 恢复
  check('恢复被触发一次', stats.restored === 1, `restored=${stats.restored}`)
  check('id 已回到 shell', world.conversation.input.shell('s1').snapshot.attachmentIds.includes('img-3'))
  // 用户删掉它
  world.conversation.input.shell('s1').removeAttachment('img-3')
  // 同一个 shell 再取用多次，不得再填充
  world.conversation.input.shell('s1')
  world.conversation.input.shell('s1')
  check('同一 shell 反复取用不会再被填充', !world.conversation.input.shell('s1').snapshot.attachmentIds.includes('img-3'))
  check('恢复次数没有增长', stats.restored === 1, `restored=${stats.restored}`)
}

console.log('\n=== 4. LRU 上限仍然生效（内存有上限）===')
{
  const world = makeConversation()
  const ctx = makeContext(world.conversation)
  keepDraftAttachments(ctx, 'test')
  const total = 70
  for (let i = 0; i < total; i += 1) {
    world.paste('s1', `img-${i}`)
    world.switchAway('s1')                      // 每次切走：保护 + 记住 + 重建
  }
  const held = world.conversation.draftAttachments.size
  check('持有量被限制在上限 64 以内', held <= 64, `实际 ${held}`)
  check('最旧的已被真正释放', !world.conversation.draftAttachments.has('img-0'))
  check('最新的仍然保留', world.conversation.draftAttachments.has(`img-${total - 1}`))
}

console.log('\n=== 5. 重复安装是幂等的 ===')
{
  const world = makeConversation()
  const ctx = makeContext(world.conversation)
  keepDraftAttachments(ctx, 'test')
  const wrapper = world.conversation.releaseDraftAttachment
  const second = keepDraftAttachments(ctx, 'test')
  check('第二次安装被识别为已装', second.installed === true)
  check('包装函数没有被替换第二次', world.conversation.releaseDraftAttachment === wrapper)
}

console.log('\n=== 6. 服务晚注册时必须靠 inject 才装上（线上失效的真因）===')
{
  const world = makeConversation()
  const ctx = makeContext(world.conversation, { visible: false })
  check('apply 时同步 get 拿不到服务（复现线上情形）', ctx.get('conversation') === undefined)
  const stats = keepDraftAttachments(ctx, 'test')
  check('最终仍安装成功（inject 等到了服务）', stats.installed, `lastError=${stats.lastError ?? '(无)'}`)
  world.paste('s1', 'img-late')
  world.switchAway('s1')
  check('晚注册场景下销毁引起的释放同样被拦下', world.conversation.draftAttachments.has('img-late'))
}

console.log(`\n结果：${failures === 0 ? '全部通过 ✓' : `${failures} 项失败 ❌`}`)
process.exit(failures === 0 ? 0 : 1)
