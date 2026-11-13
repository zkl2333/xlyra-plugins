/**
 * free-kilo —— Kilo AI 公共免费模型池的站点类型声明。
 *
 * 转发与鉴权由 manifest.json 声明：
 *
 *  - 对话转发：request.headers 不声明 Authorization 且 stripDownstreamHeaders=true，
 *    协议适配器写的 Authorization 也会被剥离，上游请求不带任何鉴权头。
 *  - 验 Key / 健康检查：通用适配器 GET {base}/models，凭据（占位值）放进无关头
 *    X-Kilo-Free-Key——Kilo 只校验 Authorization，无关头放行（2026-11 实测）。
 *
 * 本文件只有一个 listModels 钩子：上游 /models 列出全部模型（快照 473 个），
 * 免密能用的只有 isFree=true 的子集（快照 13 个），其余过滤掉。
 *
 * 上游关键行为（2026-11-13 实测）：
 *  - 对话：完全不带 Authorization → 200；带任意无效 Authorization → 401 INVALID_TOKEN。
 *  - 对话：非 isFree 模型（包括标价为 0 的）免密调用 → 401 PAID_MODEL_AUTH_REQUIRED；
 *    isFree 模型 13/13 免密 200。
 *  - /models：带不带 Authorization 都是 200 且内容相同。钩子请求由 xLyra 固定加
 *    `Authorization: Bearer <站点 Key>`（不看 models.auth），对这个端点无害。
 *
 * 为什么必须过滤：xLyra 把上游 401 记成凭据冷却（5 分钟，重复则 30 分钟），本站只有
 * 一把占位 Key，路由到任一付费模型就会让整站免费模型一起停摆；而且 `xxx:free` 与付费的
 * `xxx` 会被归并成同一个标准模型，不过滤时请求免费模型也可能被路由到付费版。
 */
import type { JsonObject, ModelListDecision, ModelListEntry, ProbeContext, ProbeStep } from "@yachiyo-5i/xlyra-plugin-sdk"

export const meta = { apiVersion: 1, id: "zkl2333.free-kilo", kind: "site_provider" }

/** 上游 /models 条目中本钩子读取的字段（OpenRouter 形状 + Kilo 的 isFree 扩展）。 */
interface KiloModel {
  id?: unknown
  name?: unknown
  isFree?: unknown
  context_length?: unknown
  top_provider?: { max_completion_tokens?: unknown } | null
}

export function listModels(_ctx: ProbeContext, steps: ProbeStep[]): ModelListDecision {
  if (steps.length === 0) {
    return { request: { method: "GET", path: "/models" } }
  }
  const response = steps[0].response
  if (response.status === 0) {
    return { error: `GET /models failed: ${response.error ?? "no response"}` }
  }
  if (response.status < 200 || response.status > 299) {
    return { error: `GET /models returned ${response.status}` }
  }
  const data = (response.json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    return { error: "models response has no data array" }
  }
  const models: ModelListEntry[] = []
  const seen = new Set<string>()
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue
    const item = raw as KiloModel
    if (item.isFree !== true || typeof item.id !== "string" || item.id === "" || seen.has(item.id)) continue
    seen.add(item.id)
    models.push(toEntry(item.id, item))
  }
  if (models.length === 0) {
    // 空列表宿主同样判这次同步失败；直接报错，信息更清楚（多半是上游改了字段）。
    return { error: `none of the ${data.length} upstream models is flagged isFree` }
  }
  return { result: { models } }
}

function toEntry(id: string, item: KiloModel): ModelListEntry {
  // 导出 listModels 后宿主不再套用 manifest 的 defaultEndpointTypes，不声明就无法路由。
  const capabilities: JsonObject = { supported_endpoint_types: ["openai"] }
  // xLyra 只认这两个上限键（进 /v1/models 的 metadata）；上游给 null 时不写。
  const input = positiveInteger(item.context_length)
  if (input !== undefined) capabilities.input_token_limit = input
  const output = positiveInteger(item.top_provider?.max_completion_tokens)
  if (output !== undefined) capabilities.output_token_limit = output
  const entry: ModelListEntry = { name: id, capabilities }
  // displayName 只在管理端展示；客户端调用仍用 name 归并出的标准模型名。
  if (typeof item.name === "string" && item.name.trim() !== "") entry.displayName = item.name.trim()
  return entry
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}
