const TONE = {
  ok:     'bg-ok text-white',
  warn:   'bg-warn text-white',
  danger: 'bg-danger text-white',
  info:   'bg-brand text-white',
  idle:   'bg-idle text-slate-700',
} as const

export type Tone = keyof typeof TONE

export function StatusChip({ label, tone = 'idle' }: { label: string; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center justify-center px-3 py-1 rounded text-xs font-medium min-w-[76px] ${TONE[tone]}`}>
      {label}
    </span>
  )
}

export const ORDER_TONE: Record<string, Tone> = {
  待审核: 'warn', 待发货: 'info', 部分发货: 'warn',
  已发货: 'ok', 已完成: 'ok', 已取消: 'idle',
}
export const PO_TONE: Record<string, Tone> = {
  草稿: 'idle', 待审批: 'warn', 已下单: 'info', 在途: 'info', 已入库: 'ok',
}
export const STAGE_TONE: Record<string, Tone> = {
  线索确认: 'idle', 需求分析: 'info', 方案报价: 'info',
  商务谈判: 'warn', 赢单: 'ok', 输单: 'danger',
}
export const AR_TONE: Record<string, Tone> = {
  未到期: 'info', 已逾期: 'danger', 已回款: 'ok',
}
