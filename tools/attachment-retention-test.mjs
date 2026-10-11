// 保留式附件释放的验证脚本 —— 不需要启动 DSH，也不需要粘贴图片。
//
// 它加载真实的 src/client/attachments.ts（Node 的类型剥离），喂给它一个模拟的
// conversation 服务，然后断言四件事：
//   1. 包装后调用 releaseDraftAttachment，条目必须仍在（这正是 DSH 拆 composer 时走的路径）
//   2. 超过 RETAINED_LIMIT 时，最旧的条目要被真正释放（内存有上限，不是无限堆积）
//   3. 重复安装是幂等的（bundle 重载会再调一次）
//   4. 表里本来就没有的 id 仍然走原实现（不改变 DSH 对未知 id 的行为）
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

/** 一个最小可用的 conversation 服务替身，行为与 DSH 的 releaseDraftAttachment 对齐。 */
function makeConversation() {
  const draftAttachments = new Map()
  let realReleases = 0
  return {
    draftAttachments,
    get realReleases() { return realReleases },
    releaseDraftAttachment(id) {
      const attachment = draftAttachments.get(id)
      if (attachment === undefined) return
      // DSH 的两步：删条目 + revoke blob URL。这里只记录，不作弊。
      draftAttachments.delete(id)
      realReleases += 1
    },
  }
}

/** 一个最小 ctx：只提供 get('conversation') 与 effect()。 */
function makeContext(conversation) {
  return {
    get(name) {
      if (name === 'conversation') return conversation
      return undefined
    },
    effect(fn) {
      fn()
      return () => {}
    },
  }
}

let failures = 0
const check = (label, ok, detail) => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${detail === undefined ? '' : `  ${detail}`}`)
  if (!ok) failures += 1
}

console.log('=== 1. 释放是否被拦下（核心行为）===')
{
  const conversation = makeConversation()
  const ctx = makeContext(conversation)
  conversation.draftAttachments.set('img-1', { id: 'img-1', kind: 'image', previewUrl: 'blob:fake-1' })
  const stats = keepDraftAttachments(ctx, 'test')
  check('包装安装成功', stats.installed, `lastError=${stats.lastError ?? '(无)'}`)
  conversation.releaseDraftAttachment('img-1')
  check('调用释放后条目仍在（图片可继续渲染）', conversation.draftAttachments.has('img-1'))
  check('原实现没有被调用（blob URL 未被 revoke）', conversation.realReleases === 0, `realReleases=${conversation.realReleases}`)
  check('deferred 计数 +1', stats.deferred === 1, `deferred=${stats.deferred}`)
}

console.log('\n=== 2. 超过上限时最旧的被真正释放（内存有上限）===')
{
  const conversation = makeConversation()
  const ctx = makeContext(conversation)
  keepDraftAttachments(ctx, 'test')
  const total = 70
  for (let i = 0; i < total; i += 1) {
    const id = `img-${i}`
    conversation.draftAttachments.set(id, { id, kind: 'image', previewUrl: `blob:fake-${i}` })
    conversation.releaseDraftAttachment(id)
  }
  const stillHeld = conversation.draftAttachments.size
  check('持有量被限制在上限 64 以内', stillHeld <= 64, `实际 ${stillHeld}`)
  check('最旧的已被真正释放', !conversation.draftAttachments.has('img-0'))
  check('最新的仍然保留', conversation.draftAttachments.has(`img-${total - 1}`))
}

console.log('\n=== 3. 重复安装是幂等的 ===')
{
  const conversation = makeConversation()
  const ctx = makeContext(conversation)
  keepDraftAttachments(ctx, 'test')
  const wrapper = conversation.releaseDraftAttachment
  const second = keepDraftAttachments(ctx, 'test')
  check('第二次安装被识别', second.lastError === 'already installed', `lastError=${second.lastError}`)
  check('包装函数没有被替换第二次', conversation.releaseDraftAttachment === wrapper)
}

console.log('\n=== 4. 未知 id 仍走原实现 ===')
{
  const conversation = makeConversation()
  const ctx = makeContext(conversation)
  keepDraftAttachments(ctx, 'test')
  conversation.releaseDraftAttachment('never-seen')
  check('不抛异常', true)
  check('未凭空创建条目', conversation.draftAttachments.size === 0)
}

console.log(`\n结果：${failures === 0 ? '全部通过 ✓' : `${failures} 项失败 ❌`}`)
process.exit(failures === 0 ? 0 : 1)
