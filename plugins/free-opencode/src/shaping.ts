// OpenCode 官方客户端的 body 整形（openai_chat 协议）。
//
// 移植自 dsh-our-free-model 内嵌的 opencode2api 端口（MIT，
// https://github.com/Ebony-Vinyl/dsh-our-free-model 的 src/o2a.js），只保留
// chat 形状；wire 工具名使用官方 SHA-256 前 12 位。
import { OFFICIAL_PROMPT, OFFICIAL_SKILLS, OFFICIAL_TOOLS, V2_OFFICIAL_TOOL_ORDER } from "./assets"

const OFFICIAL_PROMPT_MARKER = "You are opencode, an interactive CLI tool"
const ENV_WORK_DIR = "/workspace"
const ENV_PLATFORM = "linux"
const ENV_DATE = "Tue Nov 24 2026"

// 客户端工具的线上命名空间。上游免费车道 2026-11-24 起拒绝工具名携带
// "clint_"（大小写不敏感；参考实现旧前缀），其余前缀放行——实测 cl1nt_/
// xtool_/toolu_/无前缀均 200。custom_ 是普通扩展命名空间，含义诚实（这些
// 就是调用方的自定义工具）。上游若再拉黑此值，429 会只出现在带工具的
// 请求上，届时换一个普通前缀发版即可。
const CLIENT_TOOL_PREFIX = "custom_"
// 线上名编码上限：custom_(7) + 57 = 64 字符工具名上限。
const CLIENT_REVERSIBLE_LIMIT = 57
const TOOL_NAME_SEPARATORS = new Set("_- \t\r\n")

/** 折叠工具名：小写并去掉分隔符，用于别名匹配。 */
function foldToolName(name: string): string {
  let out = ""
  for (const char of String(name ?? "").toLowerCase()) {
    if (!TOOL_NAME_SEPARATORS.has(char)) out += char
  }
  return out
}

function shaHex12(value: string): string {
  return crypto.sha256(value).slice(0, 12)
}

// 线上名 = custom_ + UTF-8 hex(客户端原名)：可逆（transformStream 在响应流里
// 解码回原名），hex 单射故天然无碰撞；57 字符内（原名单字节 ≤28）可逆，更长
// 退化为不可逆的 sha256 截断摘要。纯 TS 实现，不依赖宿主全局。
function utf8Hex(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let out = ""
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0")
  return out
}

function hexToUtf8(hex: string): string | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  let out = ""
  for (let index = 0; index < bytes.length; ) {
    const byte = bytes[index]
    if (byte < 0x80) {
      out += String.fromCharCode(byte)
      index += 1
    } else if (byte < 0xe0 && index + 1 < bytes.length) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[index + 1] & 0x3f))
      index += 2
    } else if (byte < 0xf0 && index + 2 < bytes.length) {
      out += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[index + 1] & 0x3f) << 6) | (bytes[index + 2] & 0x3f))
      index += 3
    } else if (index + 3 < bytes.length) {
      const code = ((byte & 0x07) << 18) | ((bytes[index + 1] & 0x3f) << 12) | ((bytes[index + 2] & 0x3f) << 6) | (bytes[index + 3] & 0x3f)
      out += String.fromCharCode(0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff))
      index += 4
    } else {
      return null
    }
  }
  return out
}

/** 客户端工具的线上名：可逆 hex 优先，超长退化为摘要。 */
export function clientToolWireName(name: string): string {
  const encoded = utf8Hex(String(name))
  if (encoded.length > 0 && encoded.length <= CLIENT_REVERSIBLE_LIMIT) {
    return CLIENT_TOOL_PREFIX + encoded
  }
  return CLIENT_TOOL_PREFIX + shaHex12(String(name))
}

/** 线上名 → 客户端原名；仅可逆编码可解，摘要名返回 null。 */
export function clientToolOriginalName(wire: string): string | null {
  if (!wire.startsWith(CLIENT_TOOL_PREFIX)) return null
  const encoded = wire.slice(CLIENT_TOOL_PREFIX.length)
  if (encoded.length === 0 || encoded.length > CLIENT_REVERSIBLE_LIMIT) return null
  return hexToUtf8(encoded)
}

/** 客户端工具描述里的普通空格换成 NBSP：上游会匹配描述中的字面词（参考
 *  实现 2026-11-20 的发现），NBSP 打断匹配且幂等（替换后无普通空格残留）。 */
function nbspDescription(description: string): string {
  return description.split(" ").join("\u00a0")
}

/** 官方工具的客户端拼写别名（参考实现 OFFICIAL_TOOL_ALIASES）。 */
const OFFICIAL_TOOL_ALIASES: Record<string, string[]> = {
  edit: ["edit"],
  execute: ["execute"],
  glob: ["glob"],
  grep: ["grep"],
  question: ["question", "askuserquestion"],
  read: ["read", "view"],
  shell: ["shell", "bash"],
  skill: ["skill"],
  subagent: ["subagent", "agent", "task"],
  webfetch: ["webfetch", "fetch"],
  websearch: ["websearch"],
  write: ["write"],
  patch: ["patch", "applypatch"],
}

const FOLDED_OFFICIAL_ALIASES: Map<string, string> = (() => {
  const index = new Map<string, string>()
  for (const [official, spellings] of Object.entries(OFFICIAL_TOOL_ALIASES)) {
    for (const spelling of spellings) {
      const folded = foldToolName(spelling)
      if (!index.has(folded)) index.set(folded, official)
    }
  }
  return index
})()

function officialForClientName(name: unknown): string | null {
  if (typeof name !== "string" || name === "") return null
  return FOLDED_OFFICIAL_ALIASES.get(foldToolName(name)) ?? null
}

/** 客户端名 → 线上名 的分配表（冲突保留先到的）。 */
class ToolRenameMap {
  private byClient = new Map<string, string>()
  private byWire = new Map<string, string>()

  add(client: string, wire: string): void {
    if (!client || !wire || client === wire) return
    if (this.byClient.has(client) || this.byWire.has(wire)) return
    this.byClient.set(client, wire)
    this.byWire.set(wire, client)
  }

  wireOf(client: string): string | undefined {
    return this.byClient.get(client)
  }

  /** 所有已分配的线上名（等价参考实现的 renames.keys()）。 */
  wireValues(): string[] {
    return Array.from(this.byWire.keys())
  }

  get size(): number {
    return this.byClient.size
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** chat 形状的官方工具定义（function 包裹）。 */
function officialTool(name: string): Record<string, unknown> {
  const definition = OFFICIAL_TOOLS[name]
  const description = definition ? definition.description : `Agent tool ${name}`
  const parameters = definition && definition.parameters != null ? deepClone(definition.parameters) : { type: "object", properties: {} }
  return { type: "function", function: { name, description, parameters } }
}

/** chat 形状里可改名的工具条目：function.name 必须是非空字符串。 */
function renamableToolName(entry: unknown): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
  const fn = (entry as { function?: { name?: unknown } }).function
  const name = fn && typeof fn === "object" ? fn.name : undefined
  return typeof name === "string" && name !== "" ? name : null
}

function withToolName(entry: Record<string, unknown>, name: string): Record<string, unknown> {
  const fn = (entry.function ?? {}) as Record<string, unknown>
  return { ...entry, function: { ...fn, name } }
}

/** 收集文本片段，用于探测已有系统提示词是否携带官方标记。 */
function textFragments(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.trim() !== "") out.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) textFragments(item, out)
  } else if (value && typeof value === "object") {
    const obj = value as { text?: unknown; content?: unknown }
    if (typeof obj.text === "string") textFragments(obj.text, out)
    else if (obj.content !== undefined) textFragments(obj.content, out)
  }
  return out
}

function carriesOpenCodePrompt(value: unknown): boolean {
  return textFragments(value).some((part) => part.includes(OFFICIAL_PROMPT_MARKER))
}

/** 官方系统提示词：base + 模型行 + <env> + skills。 */
export function officialSystemPrompt(model: string): string {
  const apiModel = String(model ?? "").trim().replace(/^opencode\//, "") || "unknown"
  const env = [
    `You are powered by the model named ${apiModel}. The exact model ID is opencode/${apiModel}`,
    "Here is some useful information about the environment you are running in:",
    "<env>",
    `  Working directory: ${ENV_WORK_DIR}`,
    `  Workspace root folder: ${ENV_WORK_DIR}`,
    "  Is directory a git repo: yes",
    `  Platform: ${ENV_PLATFORM}`,
    `  Today's date: ${ENV_DATE}`,
    "</env>",
  ].join("\n")
  return `${OFFICIAL_PROMPT}${env}\n${OFFICIAL_SKILLS}`
}

/** 把官方系统提示词注入最前的 system 消息；已携带标记则原样通过。 */
export function injectChatPrompt(payload: Record<string, unknown>, prompt: string): boolean {
  const messages = Array.isArray(payload.messages) ? (payload.messages as Record<string, unknown>[]) : []
  let anchorIndex = -1
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    if (!message || typeof message !== "object") continue
    const role = message.role
    if (role !== "system" && role !== "developer") continue
    if (carriesOpenCodePrompt(message.content)) return false
    if (anchorIndex === -1) anchorIndex = i
  }
  if (anchorIndex === -1) {
    payload.messages = [{ role: "system", content: prompt }, ...messages]
    return true
  }
  const anchor = messages[anchorIndex]
  if (Array.isArray(anchor.content)) {
    messages[anchorIndex] = { ...anchor, content: [{ type: "text", text: prompt }, ...anchor.content] }
  } else if (typeof anchor.content === "string" && anchor.content.trim() !== "") {
    messages[anchorIndex] = { ...anchor, content: `${prompt}\n\n${anchor.content}` }
  } else {
    messages[anchorIndex] = { ...anchor, content: prompt }
  }
  return true
}

/**
 * 工具整形：客户端工具改名为官方拼写（命中别名）或 clint_<digest>，再补全
 * 13 个官方工具；同步改写 tool_choice / tool_calls 引用，清洗悬空历史。
 */
export function renameAndCompleteTools(payload: Record<string, unknown>): void {
  const renames = new ToolRenameMap()
  const keepNames = new Set<string>()
  const officialUsed = new Set<string>(keepNames)
  const items = Array.isArray(payload.tools) ? ([...payload.tools] as unknown[]) : []
  const declaredClientTools = items.filter((item) => renamableToolName(item) !== null).length
  const shaped: unknown[] = []
  for (const item of items) {
    const name = renamableToolName(item)
    if (name === null) {
      shaped.push(item)
      continue
    }
    // 已携带本插件线上名的条目是重复整形的幂等透传。
    if (keepNames.has(name) || name.startsWith(CLIENT_TOOL_PREFIX)) {
      shaped.push(item)
      continue
    }
    // 所有客户端工具统一改成线上名：客户端定义若顶着官方名（如自带 read
    // 覆盖官方 read），实测会被上游拒绝；官方名下只允许官方定义。
    let wireName = renames.wireOf(name)
    if (wireName === undefined) {
      wireName = clientToolWireName(name)
      renames.add(name, wireName)
    }
    shaped.push(withToolName(nbspClientDescription(item as Record<string, unknown>), wireName))
  }
  for (const name of V2_OFFICIAL_TOOL_ORDER) {
    if (officialUsed.has(name)) continue
    shaped.push(officialTool(name))
    officialUsed.add(name)
  }
  payload.tools = shaped
  rewriteToolReferences(payload, renames)
  const known = new Set<string>(officialUsed)
  for (const wire of renames.wireValues()) known.add(wire)
  if (declaredClientTools > 0) sanitizeToolHistory(payload, known)
  dropDanglingToolChoice(payload, known)
}

/** 客户端工具描述的空格 → NBSP（幂等）；参数与官方工具不动。 */
function nbspClientDescription(entry: Record<string, unknown>): Record<string, unknown> {
  const fn = objectOf(entry.function)
  if (!fn || typeof fn.description !== "string" || fn.description === "") return entry
  return { ...entry, function: { ...fn, description: nbspDescription(fn.description) } }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function rewriteToolReferences(payload: Record<string, unknown>, renames: ToolRenameMap): void {
  if (renames.size === 0) return
  const renamed = (container: Record<string, unknown> | null): string | null => {
    if (!container) return null
    const name = container.name
    if (typeof name !== "string") return null
    const wireName = renames.wireOf(name)
    return wireName !== undefined && wireName !== name ? wireName : null
  }
  const choice = objectOf(payload.tool_choice)
  if (choice) {
    const fn = objectOf(choice.function)
    if (fn) {
      const wire = renamed(fn)
      if (wire !== null) payload.tool_choice = { ...choice, function: { ...fn, name: wire } }
    } else {
      const wire = renamed(choice)
      if (wire !== null) payload.tool_choice = { ...choice, name: wire }
    }
  }
  const call = objectOf(payload.function_call)
  if (call) {
    const wire = renamed(call)
    if (wire !== null) payload.function_call = { ...call, name: wire }
  }
  const messages = Array.isArray(payload.messages) ? (payload.messages as Record<string, unknown>[]) : []
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    if (!message || typeof message !== "object") continue
    if (Array.isArray(message.tool_calls)) {
      const calls = message.tool_calls as Record<string, unknown>[]
      const kept = calls.map((c) => {
        const fn = objectOf(c.function)
        if (!fn) return c
        const wire = renamed(fn)
        return wire !== null ? { ...c, function: { ...fn, name: wire } } : c
      })
      messages[i] = { ...message, tool_calls: kept }
    }
  }
}

function chatMessageHasContent(message: Record<string, unknown>): boolean {
  for (const key of ["content", "reasoning_content", "reasoning"]) {
    const value = message[key]
    if (typeof value === "string") {
      if (value !== "") return true
      continue
    }
    if (Array.isArray(value)) {
      if (value.length > 0) return true
      continue
    }
    if (value != null && typeof value === "object") {
      if (Object.keys(value).length > 0) return true
      continue
    }
    if (value !== undefined && value !== null) return true
  }
  return false
}

/** 清洗悬空工具调用历史：未知名字的 tool_calls/function_call 及其结果行删除。 */
function sanitizeToolHistory(payload: Record<string, unknown>, known: Set<string>): void {
  const fateOf = (name: unknown): { verdict: "keep" | "rename" | "drop"; official?: string } => {
    if (typeof name !== "string" || name === "") return { verdict: "drop" }
    if (known.has(name)) return { verdict: "keep" }
    const official = officialForClientName(name)
    if (official !== null && known.has(official)) return { verdict: "rename", official }
    return { verdict: "drop" }
  }
  const messages = Array.isArray(payload.messages) ? ([...payload.messages] as Record<string, unknown>[]) : null
  if (messages === null) return
  const droppedCalls = new Set<string>()
  const droppedFunctions = new Set<string>()
  const emptied: Record<string, unknown>[] = []
  let changed = false
  for (let i = 0; i < messages.length; i += 1) {
    let message = messages[i]
    if (!message || typeof message !== "object") continue
    if (Array.isArray(message.tool_calls)) {
      const kept: Record<string, unknown>[] = []
      let touched = (message.tool_calls as unknown[]).length === 0
      for (const call of message.tool_calls as Record<string, unknown>[]) {
        const fn = objectOf(call?.function)
        const fate = fateOf(fn?.name)
        if (fate.verdict === "keep") {
          kept.push(call)
          continue
        }
        if (fate.verdict === "rename" && fn) {
          kept.push({ ...call, function: { ...fn, name: fate.official } })
          touched = true
          continue
        }
        if (typeof call?.id === "string" && call.id !== "") droppedCalls.add(call.id)
        touched = true
      }
      if (touched) {
        if (kept.length === 0) {
          const rest = { ...message } as Record<string, unknown>
          delete rest.tool_calls
          messages[i] = rest
          if ((message.tool_calls as unknown[]).length > 0 && message.function_call === undefined) emptied.push(rest)
        } else {
          messages[i] = { ...message, tool_calls: kept }
        }
        changed = true
      }
    }
    let current = messages[i]
    if (current && typeof current === "object" && current.function_call && typeof current.function_call === "object") {
      const fc = current.function_call as Record<string, unknown>
      const fate = fateOf(fc.name)
      if (fate.verdict === "rename") {
        messages[i] = { ...current, function_call: { ...fc, name: fate.official } }
        changed = true
      } else if (fate.verdict === "drop") {
        if (typeof fc.name === "string") droppedFunctions.add(fc.name)
        const rest = { ...current }
        delete rest.function_call
        messages[i] = rest
        changed = true
      }
    }
    const row = messages[i]
    if (row && row.role === "tool" && typeof row.tool_call_id === "string" && droppedCalls.has(row.tool_call_id)) {
      messages.splice(i, 1)
      i -= 1
      changed = true
    }
    if (row && row.role === "function" && typeof row.name === "string" && droppedFunctions.has(row.name)) {
      messages.splice(i, 1)
      i -= 1
      changed = true
    }
  }
  if (emptied.length > 0) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const row = messages[i]
      if (emptied.includes(row) && row && typeof row === "object" && !chatMessageHasContent(row)) {
        messages.splice(i, 1)
        changed = true
      }
    }
  }
  if (changed) payload.messages = messages
}

function dropDanglingToolChoice(payload: Record<string, unknown>, known: Set<string>): void {
  const choice = objectOf(payload.tool_choice)
  if (choice === null) return
  const fn = objectOf(choice.function)
  const name = fn ? fn.name : choice.name
  if (typeof name === "string" && name !== "" && !known.has(name)) delete payload.tool_choice
}

/** 流式请求补 include_usage（官方 CLI 姿态）。 */
function ensureChatUsage(payload: Record<string, unknown>): void {
  if (payload.stream !== true) return
  const options = objectOf(payload.stream_options)
  if (options && options.include_usage === true) return
  payload.stream_options = options ? { ...options, include_usage: true } : { include_usage: true }
}

/** 未命名上限时补官方客户端自己的 ceiling。 */
function ensureV2CompletionLimit(payload: Record<string, unknown>): void {
  if (payload.max_completion_tokens !== undefined) return
  if (payload.max_tokens !== undefined) return
  payload.max_completion_tokens = 32000
}

/** 入口：对 openai_chat payload 做官方整形（model/stream 不动，宿主强制不变）。 */
export function shapeChatPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const model = typeof payload.model === "string" ? payload.model : ""
  injectChatPrompt(payload, officialSystemPrompt(model))
  renameAndCompleteTools(payload)
  ensureChatUsage(payload)
  ensureV2CompletionLimit(payload)
  return payload
}
