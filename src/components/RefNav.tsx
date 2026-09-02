import { createContext, useContext, type ReactNode } from 'react'

/**
 * 结论里的 [[编号]] 点下去该干什么，由外壳决定。
 *
 * 桌面版：跳到对应列表页并定位那一行——用户接着要在旁边的数据区里横着核对，
 *         结论和记录必须同时留在屏幕上。
 * 移动版：从底部推一张详情卡上来，看完关掉，对话不动。手机上没有「并排」，
 *         真跳走了用户就得按返回键找回刚才读到哪，核对这个动作就断了。
 *
 * 用 context 而不是给 RefChip 加一个 prop：RefChip 被 Markdown 的行内切词函数
 * 深埋在几层渲染里，一路透传 prop 要改 Markdown 的每一层，
 * 而那个文件里唯一要紧的是「引用优先于加粗」的切词顺序，不该被这件事搅进去。
 */
const Ctx = createContext<((id: string) => void) | null>(null)

export function RefNavProvider({ onOpen, children }: { onOpen: (id: string) => void; children: ReactNode }) {
  return <Ctx.Provider value={onOpen}>{children}</Ctx.Provider>
}

/** 返回 null 表示外壳没有接管，RefChip 走默认的路由跳转。 */
export function useRefNav(): ((id: string) => void) | null {
  return useContext(Ctx)
}
