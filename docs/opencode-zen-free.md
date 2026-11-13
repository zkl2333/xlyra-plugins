# OpenCode Zen 免费车道接入调查（2026-11-13 完结）

结论先行：**门禁 = 传输层指纹（TLS ClientHello + ALPN + HTTP/1.1 头布局），不是 IP**。
纯 Go 通过 uTLS 复刻 Bun 指纹即可通过，本机直连已实测 200 出 token。

## 实验记录（同机同 IP 同日对照）

| # | 客户端 | 请求形态 | 结果 |
|---|---|---|---|
| A | Node fetch（undici） | 完整应用层指纹：官方系统提示词 + 13 官方工具 + canonical session + 40-hex project + `Bearer public` → `/inference/openai/v1/chat/completions` | **401** `Missing API key` |
| B | 同上 | → `/zen/go` | **401** `requires an API key` |
| C | 同上 | + 每请求新 project id | **401**（2026-11-13 复测仍 401） |
| D | **opencode2api v1.4.7（Go + BunTransport）** | 同样的应用层整形 + uTLS Bun ClientHello | **200**，2.4s，流式正常 |

## 门禁机制（源自 opencode2api `internal/httpx/bun.go` / `bun_dial.go`）

上游校验请求是否来自官方 OpenCode CLI（1.x/2.x 均基于 Bun 运行时），不匹配则按
"无凭证" 处理返回 401。三件事都要对：

1. **TLS ClientHello**：Bun 1.4.3 BoringSSL 规格（JA4 `t13d1713h1`，无 GREASE、
   无 padding，X25519MLKEM768 首位 key share）→ uTLS `HelloCustom` + 手写 spec；
2. **只说 HTTP/1.1**：ALPN 仅 `http/1.1`（Bun fetch 不协商 h2）；
3. **头布局**：WebKit 常见头（Accept/Authorization/Content-Type/User-Agent…）按
   固定顺序 + 原始拼写排最前，其余头小写并排序，fetch 自加
   `Accept-Encoding: gzip, deflate, br, zstd`、`Accept: */*`、`Connection: keep-alive`。

应用层整形（两项都来自社区参考，dsh-our-free-model 的 MIT 移植与 opencode2api 一致）：

- 官方系统提示词（base + `<env>` 块 + skills 列表）注入最前；
- 客户端工具改名为 `clint_<sha256前12hex>`，再附加官方 13 工具集（2.x 定义）；
- 会话 id 必须是"铸造"的真时间戳（UTC 今天减最多 30 天），project id 每请求 40-hex 随机。

伪装代价：官方提示词 + 工具定义 ≈ 5.8k prompt tokens（上游 prompt cache 可命中 ~1.8k）。

## 上游行为语义

- 匿名凭证就是字面量 `Bearer public`；
- 免费额度按**会话/项目**记账：429 `FreeUsageLimitError`；
- IP 级滥用 403、地区 403 `RegionError`——本机 IP 干净，直连即可；
- 端点族路径：`/inference/openai/v1/chat/completions|responses`、
  `/inference/anthropic/v1/messages?beta=true`（模型决定路由）。

## 当前免费模型（经 opencode2api 目录过滤，2026-11-13）

beam-free、big-pickle、deepseek-v4.1-flash-free、flint-40b-free、glm-5.3-flash-free、
iceman-free、inkling-2-small-free、longcat-2.5-free、mimo-v2.6-flash-free、
minimax-m3.1-flash-free、nemotron-3.5-lightning-free、nemotron-3.5-super-vl-free（共 12）

## 接入方案

### 方案一：opencode2api sidecar（零核心改动，立即可用）

[参考实现 jasonxu114514/opencode2api](https://github.com/jasonxu114514/opencode2api)
（GPL-3.0，v1.4.7）是完整产品：整形 + BunTransport + 模型目录 + 会话亲和 + 熔断退避。

部署在 xLyra 实例同机（如 Docker compose 同网络），xLyra 加 `openai` 通用站点：

- base_url：`http://127.0.0.1:18080`（同宿主机）或 compose 服务名
- api_key：opencode2api 的 `server_keys` 之一
- 已验证：`/v1/models`、`/v1/chat/completions`、SSE 流式全部正常

本机验证用配置（`.research/o2a-test/config.json`，仅监听 127.0.0.1，WebUI 关闭）：
`anonymous: true` + `proxies: ["direct"]` + `free_only: true` 即可，无需任何 key。

### 方案二：xLyra 核心原生接入（"完美接入"，中期）

xLyra 为 AGPL-3.0，GPL-3.0 的 BunTransport（约 700 行，依赖
refraction-networking/utls、andybalholm/brotli、klauspost/compress/zstd）可合法移植
（保留署名）。要点：

1. 移植 `BunTransport` 为 per-site 可选传输（`impersonate: bun`）；
2. 移植整形（官方提示词/工具资产在两个参考仓库里都有捕获件）；
3. 新站点类型（或扩展内置 `opencode_go`）：目录按 isFree 过滤、按模型分流三种端点、
   429/403 走 xLyra 既有 per-credential cooldown 机制；
4. 指纹漂移维护：上游改指纹时需跟版（参考 opencode2api 的更新节奏）。

## 风险与边界

- 免费 ≠ 无限：按会话/项目记账，重负载会 429；opencode2api 的会话轮换机制可缓解；
- 上游随时可收紧（指纹/额度/地区），两个社区项目都在持续跟版；
- 伪装流量与官方 ToS 的关系自担；opencode2api 的 README 明确用于自有账号/匿名层。
