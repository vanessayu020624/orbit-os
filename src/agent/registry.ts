import type { ToolDef, Role, ToolContext, AuditEntry } from '../lib/types'
import { ROLE_META } from '../lib/rbac'
import { crmTools } from './tools/crm'
import { erpTools } from './tools/erp'
import { analyticsTools } from './tools/analytics'
import { writeTools } from './tools/write'

export const ALL_TOOLS: ToolDef[] = [...crmTools, ...erpTools, ...analyticsTools, ...writeTools]

/** 权限第一层：未授权工具根本不会进入发给 LLM 的 tools 数组。 */
export function toolsFor(role: Role): ToolDef[] {
  return ALL_TOOLS.filter(t => t.allowedRoles.includes(role))
}

export function toolSchemasFor(role: Role) {
  return toolsFor(role).map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

export function toolCatalogText(role: Role): string {
  return toolsFor(role).map(t => `- ${t.name}: ${t.description}`).join('\n')
}

/**
 * 本角色**没有**、但系统里确实存在的能力，附带谁有权限。
 *
 * 为什么必须给模型：只喂本角色工具目录时，模型分不清「系统没这个能力」和
 * 「你这个角色无权」，实测它会把销售代表问应收答成「当前系统不支持查询应收账款」——
 * 系统明明支持。口径错了，比拒绝本身更伤可信度。有了这张表它才能正确归因并指路。
 */
export function restrictedCatalogText(role: Role): string {
  const lines = ALL_TOOLS
    .filter(t => !t.allowedRoles.includes(role))
    .map(t => {
      const who = t.allowedRoles.map(r => ROLE_META[r].label).join('、')
      return `- ${t.name}: ${t.description.split('。')[0]}。（需要：${who}）`
    })
  return lines.length ? lines.join('\n') : '（无——本角色可使用系统全部能力）'
}

export interface ExecResult { ok: boolean; result: unknown; ms: number }

/** 权限第二层：执行前再查一次角色，防止 LLM 幻觉出一个它没有的工具名。 */
export function executeTool(name: string, args: any, ctx: ToolContext): ExecResult {
  const t0 = performance.now()
  const tool = ALL_TOOLS.find(t => t.name === name)
  if (!tool) {
    return { ok: false, ms: 0, result: { error: `不存在名为 ${name} 的工具` } }
  }
  if (!tool.allowedRoles.includes(ctx.role)) {
    return { ok: false, ms: 0, result: {
      error: 'PERMISSION_DENIED',
      reason: `当前角色无权调用 ${name}`,
      allowedRoles: tool.allowedRoles,
    } }
  }
  try {
    const result = tool.run(args ?? {}, ctx)
    return { ok: true, result, ms: Math.round(performance.now() - t0) }
  } catch (e) {
    return { ok: false, result: { error: String(e) }, ms: Math.round(performance.now() - t0) }
  }
}

export function auditOf(
  name: string, args: unknown, r: ExecResult, ctx: ToolContext, override = false,
): AuditEntry {
  return {
    id: `AU-${Date.now()}-${Math.round(Math.random() * 1e4)}`,
    at: new Date().toISOString(), role: ctx.role, userId: ctx.user.id,
    tool: name, args, ok: r.ok, ms: r.ms,
    summary: r.ok ? JSON.stringify(r.result).slice(0, 160) : String((r.result as any)?.error),
    ...(override ? { override: true } : {}),
  }
}
