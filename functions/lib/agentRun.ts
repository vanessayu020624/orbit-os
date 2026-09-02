/**
 * 在 Cloudflare Worker 里跑一遍和浏览器完全同一份执行器。
 *
 * 这不是把 Agent「移植」到服务端——loop.ts 一行没改。它本来就把所有和环境相关的东西
 * 都收在 RunAgentOptions 里（getDb / mutate / emit / requestConfirm / pushAudit），
 * 这里只是换了一组实现注进去。能这么干，是当初把执行器和 React 状态解耦的回报。
 *
 * 两个必须讲清楚的边界：
 *
 * 1) 服务端没有那份浏览器里的 Zustand db。这里 generateSeed(42) 现造一份只读快照，
 *    和网页上「刚批准完一张采购单」的会话是两个世界。所以飞书侧只做只读问答——
 *    见下面 requestConfirm 的说明。
 *
 * 2) 审计日志在这里是丢弃的。可以接受，且只在只读前提下可以接受：没有写操作发生，
 *    就没有需要留痕的动作。一旦哪天允许飞书直接落库，pushAudit 必须先有去处。
 */
import { runAgent } from '../../src/agent/loop'
import type { RunAgentOptions } from '../../src/agent/loop'
import { setChatEndpoint } from '../../src/agent/llm'
import { generateSeed } from '../../src/lib/seed'
import { ROLE_META } from '../../src/lib/rbac'
import type { AgentEvent, Role, User } from '../../src/lib/types'

export interface ServerRunResult {
  /** 执行器是否产出了结论。false 时看 error。 */
  ok: boolean
  answer: string
  refs: string[]
  /** 实际落地的工具调用次数。0 次却有结论，说明模型在编，调用方应当拒发。 */
  toolCalls: number
  /**
   * 模型试图执行的写操作。非 null 时调用方要改发「回 OrbitOS 确认」卡片，
   * 而不是把 answer 当成已执行的结果播出去。
   */
  blockedWrite: { toolName: string; summary: string } | null
  error: string | null
  /**
   * 这轮结论是以谁的权限算出来的。卡片必须把它印在群里：同一个问题，销售代表和 CEO
   * 拿到的数字本来就不一样，不标身份的话群里两个人对着不同的答案吵，还以为是系统在乱报。
   */
  actor: { name: string; role: Role; roleLabel: string } | null
}

export interface ServerRunOptions {
  question: string
  /** OrbitOS 的用户 id（U-001 等）。权限完全由它决定，飞书那边的身份不参与判定。 */
  orbitUserId: string
  /**
   * `/api/chat` 的绝对地址。Worker 的 fetch 没有「当前页面」这个基准，
   * 相对路径会直接抛 Invalid URL，所以必须由调用方从 request.url 拼好传进来。
   */
  chatEndpoint: string
  /**
   * 仅供测试替换。这一层要验的是「结论怎么被把关、写操作怎么被拦」，
   * 真跑一遍执行器既依赖模型、也验不出这几个分支；而这个仓库到处都是这种注入
   * （buildFeishuCard 的 pushedAt、getTenantAccessToken 的 now），照着来即可。
   */
  runner?: (o: RunAgentOptions) => Promise<void>
}

/** 找不到人时的说明要能直接发给用户看，别只回一个 id。 */
export function resolveUser(users: User[], orbitUserId: string): User | null {
  return users.find(u => u.id === orbitUserId) ?? null
}

export async function runAgentServerSide(o: ServerRunOptions): Promise<ServerRunResult> {
  // 模块级变量，同一个 isolate 内所有请求共用。这里每次都写是幂等的——
  // 同一部署下所有请求算出来的都是同一个同源地址，并发覆盖不会串。
  setChatEndpoint(o.chatEndpoint)

  const db = generateSeed(42)
  const user = resolveUser(db.users, o.orbitUserId)
  if (!user) {
    return { ok: false, answer: '', refs: [], toolCalls: 0, blockedWrite: null, actor: null,
      error: `找不到用户 ${o.orbitUserId}，请检查 FEISHU_USER_MAP 里配的 OrbitOS 用户 id` }
  }

  let answer = ''
  let refs: string[] = []
  let toolCalls = 0
  let blockedWrite: ServerRunResult['blockedWrite'] = null
  let emittedError: string | null = null
  const actor = { name: user.name, role: user.role, roleLabel: ROLE_META[user.role].label }

  const emit = (e: AgentEvent) => {
    if (e.type === 'final') { answer = e.text; refs = e.refs }
    else if (e.type === 'tool_result') toolCalls++
    else if (e.type === 'error') emittedError = e.message
  }

  try {
    await (o.runner ?? runAgent)({
      question: o.question,
      user,
      getDb: () => db,
      // 走不到。loop.ts 里每个 isWrite 工具都先过 requestConfirm，而下面那个恒返回 false，
      // 拒绝分支直接 continue，executeTool 不会被调用。留一个抛错的实现是为了：
      // 万一将来有人给写工具漏配 isWrite，这里会当场炸，而不是静默地改一份没人看的快照。
      mutate: () => { throw new Error('服务端不允许写操作') },
      emit,
      pushAudit: () => {},
      /**
       * 恒拒。这是飞书这条链路的核心约束，不是省事：
       * 权限判定可以搬到服务端（user 是查出来的，不是飞书传的），但「人确认」搬不了——
       * 飞书群里点一下按钮的那个人，和 OrbitOS 里那个有权批采购单的人，
       * 之间只有一张我们自己配的映射表在担保。写操作必须回到网页上，
       * 在能看到完整上下文和审计留痕的地方按下确认。
       *
       * 拒绝不是终点：loop.ts 收到 rejected 后会继续推理并给出建议，
       * 所以用户在飞书里仍然拿得到「该做什么」，只是拿不到「已经做了」。
       */
      requestConfirm: (_id, toolName, _args, summary) => {
        blockedWrite ??= { toolName, summary }
        return Promise.resolve(false)
      },
    })
  } catch (e) {
    return { ok: false, answer, refs, toolCalls, blockedWrite, actor,
      error: emittedError ?? String(e) }
  }

  // 有正文但一次工具都没调，说明结论是模型凭空写的。浏览器里有守卫 A 兜这件事，
  // 飞书这条链路照样要兜——发出去的消息比屏幕上的更难撤回。
  if (!answer) {
    return { ok: false, answer: '', refs, toolCalls, blockedWrite, actor,
      error: emittedError ?? '执行器没有产出结论' }
  }
  if (toolCalls === 0) {
    return { ok: false, answer, refs, toolCalls, blockedWrite, actor,
      error: '执行器没有调用任何工具，这条结论无法溯源，已拦截' }
  }
  return { ok: true, answer, refs, toolCalls, blockedWrite, actor, error: null }
}
