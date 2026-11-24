/**
 * free-opencode —— OpenCode Zen 免费车道（opencode.ai/inference，匿名凭证 public）
 * 的站点类型：官方客户端 body 整形 + 免费模型过滤 + 限流分类。
 *
 * - signRequest 用稳定 sessionKey 派生官方降序 session id；同一会话保持粘性，
 *   超过官方窗口后基于新 now 重铸；没有 sessionKey 时每请求随机 session，
 *   避免无关请求共享配额桶；
 * - rewritePayload 注入官方系统提示词 + 13 工具；listModels 过滤免费目录；
 *   classify 将 FreeUsageLimitError 映射到 limited。
 *
 * session/project 头由 signRequest/manifest 动态生成，绝不使用静态 session。
 */
import type { ErrorClassifyResult, JsonObject, ModelListDecision, ModelListEntry, ProbeContext, ProbeStep, ProtocolBuildContext, ProtocolSignInput, ProtocolSignResult, RewritePayloadContext, StreamTransformContext, StreamTransformEvent, StreamTransformResult } from "../types-xlyra-v119"
import { clientToolOriginalName, shapeChatPayload } from "./shaping"

export const meta = { apiVersion: 1, id: "zkl2333.free-opencode", kind: "site_provider" }

const SESSION_PREFIX = "opencode.session."
const SESSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_RANDOM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** rewritePayload：只改 body，官方 prompt/tool 资产跟插件版本走。 */
export function rewritePayload(ctx: RewritePayloadContext, payload: Record<string, unknown>): Record<string, unknown> {
  if (ctx.protocol && ctx.protocol !== "openai_chat") return payload
  return shapeChatPayload(payload)
}

/**
 * transformStream：把响应流里模型发出的 custom_<b64> 工具名解码回客户端
 * 原名——rewritePayload 把客户端工具改成了可逆线上名，这里在 SSE 事件级
 * （5ms 预算）还原，客户端才能执行自己的工具。仅覆盖流式响应；data 为
 * [DONE] 或非 JSON 时原样通过。
 */
export function transformStream(ctx: StreamTransformContext, event: StreamTransformEvent): StreamTransformResult {
  if (ctx.protocol && ctx.protocol !== "openai_chat") return {}
  const data = event.data
  if (typeof data !== "string" || data.trim() === "" || data.trim() === "[DONE]") return {}
  let chunk: any
  try {
    chunk = JSON.parse(data)
  } catch {
    return {}
  }
  if (!chunk || typeof chunk !== "object" || !Array.isArray(chunk.choices)) return {}
  let changed = false
  for (const choice of chunk.choices) {
    const calls = choice?.delta?.tool_calls
    if (!Array.isArray(calls)) continue
    for (const call of calls) {
      const fn = call?.function
      if (!fn || typeof fn.name !== "string") continue
      const original = clientToolOriginalName(fn.name)
      if (original !== null) {
        fn.name = original
        changed = true
      }
    }
  }
  return changed ? { data: JSON.stringify(chunk) } : {}
}

/**
 * 把官方 OpenCode 的 session 编码和动态头放进插件层：
 * - transport.profile=bun 让宿主统一使用 Bun TLS/HTTP/1.1 线上形状；
 * - request.headers 的 random.hex 模板生成每请求 project；
 * - signRequest 只改写 session 头族，sessionKey 相同的会话保持粘性；
 *   没有 sessionKey 时不跨请求共享，避免把无会话请求挤进同一个配额桶。
 */
export function signRequest(ctx: ProtocolBuildContext, _req: ProtocolSignInput): ProtocolSignResult {
  const sessionID = sessionFor(ctx)
  return {
    headers: {
      "x-opencode-session-id": sessionID,
      "x-session-affinity": sessionID,
      "x-opencode-session": sessionID,
      "x-session-id": sessionID,
    },
  }
}

function sessionFor(ctx: ProtocolBuildContext): string {
  const now = Number.isFinite(ctx.now) && (ctx.now ?? 0) > 0 ? Number(ctx.now) : Date.now()
  const hint = typeof ctx.sessionKey === "string" ? ctx.sessionKey.trim() : ""
  if (hint === "") return mintSession(now, bytes.toHex(crypto.randomBytes(16)))

  const keyHash = crypto.sha256(hint)
  const storageKey = `${SESSION_PREFIX}${keyHash.slice(0, 32)}`
  const saved = storage.get(storageKey)
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    const session = (saved as Record<string, unknown>).session
    if (typeof session === "string" && isOfficialSession(session, now)) return session
  }
  const session = mintSession(now, keyHash)
  storage.set(storageKey, { session, updatedAt: now })
  return session
}

function mintSession(now: number, seed: string): string {
  const digest = crypto.sha256(`opencode-session\0${seed}`)
  const offset = Number.parseInt(digest.slice(0, 8), 16) % SESSION_WINDOW_MS
  const midnight = Math.floor(now / 86400000) * 86400000
  const base = BigInt(midnight - offset)
  const encoded = (~((base << 12n) | 1n)) & 0xffffffffffffn
  const randomValue = BigInt(`0x${digest.slice(8, 28)}`)
  let quotient = randomValue
  let random = ""
  for (let index = 0; index < 14; index += 1) {
    const digit = Number(quotient % 62n)
    random = SESSION_RANDOM_CHARS[digit] + random
    quotient /= 62n
  }
  return `ses_${encoded.toString(16).padStart(12, "0")}${random}`
}

function isOfficialSession(value: string, now: number): boolean {
  if (!/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(value)) return false
  const timePart = value.slice(4, 16)
  if (!/^[0-9a-f]{9}f[c-f][0-9a-f]$/.test(timePart)) return false
  const inverted = BigInt(`0x${timePart}`)
  const phase = Number(((~inverted) & 0xffffffffffffn) >> 12n)
  const phaseMS = 2 ** 36
  const nowPhase = Math.floor(now) % phaseMS
  const age = (nowPhase - phase + phaseMS) % phaseMS
  return age <= SESSION_WINDOW_MS
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
  const code = (input.code ?? "").trim()
  const message = (input.message ?? "")
  if (input.status === 429 && (type === "FreeUsageLimitError" || message.includes("Free usage limit"))) {
    return { class: "limited", reason: "opencode zen free-tier usage limit" }
  }
  // 上下文超限：请求本身合法，只是超出该模型窗口。归为 limited 以复用
  // 站点转移（转向更大窗口的候选站点），并给本凭据短暂冷却（无
  // Retry-After 时 30s）——v1.19 选路不按 input_token_limit 过滤，这是
  // 插件层唯一能把 oversized 请求送去正确站点的杠杆。
  if ((input.status === 400 || input.status === 413) && (code === "context_length_exceeded" || message.includes("maximum context length"))) {
    return { class: "limited", reason: "context length exceeded on this model" }
  }
  return { class: "unknown" }
}
