/**
 * free-opencode —— OpenCode Zen 免费车道（opencode.ai/inference，匿名凭证 public）
 * 的站点类型：官方客户端 body 整形 + 免费模型过滤 + 限流分类。
 *
 * 分层（与 xLyra 核心的约定，见仓库 docs/opencode-zen-free.md）：
 *  - 传输与身份头（Bun 线上形状、session 铸造、每请求 project）归核心的
 *    `gateway.impersonate_opencode_client`（需 Yachiiiiyo/xLyra#5 起的核心）；
 *    本插件绝不声明 x-opencode-session 或 x-opencode-project 头——静态 session
 *    是共享的预烧配额桶，实测快速 429。
 *  - 本插件（manifest 静态头 + 钩子）承担跟版面：
 *      rewritePayload：注入官方系统提示词 + 13 个官方工具（免费层按 agent
 *        形状校验请求体；2026-11 实测裸 body 429、整形 body 200）；
 *      listModels：目录只留免费模型（id 含 free 或输入输出全零价），防止误调
 *        付费模型 401 把唯一 public 占位凭据整把冷却；
 *      classify：FreeUsageLimitError 归为 limited（核心只认 Go 套餐的
 *        GoUsageLimitError）。
 *  - manifest 静态头只覆盖身份类静态值（UA 版本、client 标识）——执行序上插件
 *    头在核心 zen 头之后写入，胜出；UA 跟版只需发新版插件。
 */
import type { ErrorClassifyResult, JsonObject, ModelListDecision, ModelListEntry, ProbeContext, ProbeStep, RewritePayloadContext } from "@yachiyo-5i/xlyra-plugin-sdk"
import { shapeChatPayload } from "./shaping"

export const meta = { apiVersion: 1, id: "zkl2333.free-opencode", kind: "site_provider" }

/** rewritePayload：openai_chat 之外的协议原样通过（本站点类型只声明 chat）。 */
export function rewritePayload(ctx: RewritePayloadContext, payload: Record<string, unknown>): Record<string, unknown> {
  if (ctx.protocol && ctx.protocol !== "openai_chat") return payload
  return shapeChatPayload(payload)
}

/** 上游 /v1/models 条目中本钩子读取的字段（OpenCode Zen 目录形状）。 */
interface ZenModel {
  id?: unknown
  name?: unknown
  cost?: { text?: { input?: { price?: unknown }; output?: { price?: unknown } } } | null
  limit?: { context?: unknown; output?: unknown } | null
}

/** 免费判定：id 含 free（o2a 同款），或文本输入输出全零价（big-pickle 这类）。 */
function isFreeModel(item: ZenModel): boolean {
  if (typeof item.id === "string" && item.id.toLowerCase().includes("free")) return true
  const text = item.cost?.text
  const input = typeof text?.input?.price === "number" ? text.input.price : undefined
  const output = typeof text?.output?.price === "number" ? text.output.price : undefined
  return input === 0 && output === 0
}

export function listModels(_ctx: ProbeContext, steps: ProbeStep[]): ModelListDecision {
  if (steps.length === 0) {
    return { request: { method: "GET", path: "/v1/models" } }
  }
  const response = steps[0].response
  if (response.status === 0) {
    return { error: `GET /v1/models failed: ${response.error ?? "no response"}` }
  }
  if (response.status < 200 || response.status > 299) {
    return { error: `GET /v1/models returned ${response.status}` }
  }
  const data = (response.json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    return { error: "models response has no data array" }
  }
  const models: ModelListEntry[] = []
  const seen = new Set<string>()
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue
    const item = raw as ZenModel
    if (!isFreeModel(item) || typeof item.id !== "string" || item.id === "" || seen.has(item.id)) continue
    seen.add(item.id)
    models.push(toEntry(item.id, item))
  }
  if (models.length === 0) {
    return { error: `none of the ${data.length} upstream models qualifies as free` }
  }
  return { result: { models } }
}

function toEntry(id: string, item: ZenModel): ModelListEntry {
  // 导出 listModels 后宿主不再套用 manifest 的 defaultEndpointTypes，不声明就无法路由。
  const capabilities: JsonObject = { supported_endpoint_types: ["openai"] }
  const input = positiveInteger(item.limit?.context)
  if (input !== undefined) capabilities.input_token_limit = input
  const output = positiveInteger(item.limit?.output)
  if (output !== undefined) capabilities.output_token_limit = output
  const entry: ModelListEntry = { name: id, capabilities }
  if (typeof item.name === "string" && item.name.trim() !== "") entry.displayName = item.name.trim()
  return entry
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * classify：429 FreeUsageLimitError 是免费层的会话/项目配额墙（与 Go 套餐的
 * GoUsageLimitError 同类语义，核心已对后者建冷却）；归为 limited 让宿主按
 * 凭据限流处理，其余交回默认分类。
 */
export function classify(_ctx: { siteType: string }, input: { status: number; code?: string; type?: string; message?: string }): ErrorClassifyResult {
  const type = (input.type ?? "").trim()
  const message = (input.message ?? "")
  if (input.status === 429 && (type === "FreeUsageLimitError" || message.includes("Free usage limit"))) {
    return { class: "limited", reason: "opencode zen free-tier usage limit" }
  }
  return { class: "unknown" }
}
