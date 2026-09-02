import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { askAgent } from '../lib/bus'
import { useStore } from '../lib/store'
import { ROLE_META } from '../lib/rbac'
import type { Role } from '../lib/types'

/**
 * 处理 `?role=supply_chain&ask=...` 这种带问题的入口地址。
 *
 * 存在的理由是飞书那条链路：在群里 @星轨 能拿到只读结论，但凡涉及写操作（改交期、锁库存、
 * 开加急采购单），卡片上给的是一个跳回这里的链接，而不是一个「确认执行」按钮。
 * 人点进来，落在同一个角色、同一个问题上，在能看见完整上下文和审计留痕的地方按确认。
 *
 * role 必须跟着一起传。少了它，从飞书点进来的人会落在默认的供应链主管身份上，
 * 看到一份和飞书里那条结论范围不一样的数据——这种不一致比报错更伤信任。
 */
export function DeepLink() {
  const [params, setParams] = useSearchParams()
  // 只认第一次。清参数会触发一次 params 变化，没有这个闸门就是一个自激的循环。
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    const role = params.get('role')
    const q = params.get('ask')?.trim()
    if (!role && !q) return
    fired.current = true

    // 先切角色再提问：Zustand 的 set 是同步的，所以下一行 askAgent 触发的这次运行
    // 读到的已经是切换后的身份。顺序反了就会以旧角色的权限跑完整轮。
    if (role && role in ROLE_META) useStore.getState().setRole(role as Role)
    if (q) askAgent(q)

    // 用完就从地址栏抹掉。留着的话，刷新页面会再跑一次 Agent（一次真实的模型调用），
    // 而用户完全不知道自己按 F5 花掉了一次问询。
    const next = new URLSearchParams(params)
    next.delete('role')
    next.delete('ask')
    setParams(next, { replace: true })
  }, [params, setParams])

  return null
}
