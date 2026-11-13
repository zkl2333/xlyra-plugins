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

### 路线（已定）：宿主能力 + 插件交付

本仓库是插件仓库，交付物是 `.xlp` 插件包；**部署第三方网关（sidecar）的方案已否决**
（2026-11-13，定位不符——我们是插件作者，不为 opencode 运维网关）。

插件单独做不到（四道宿主层门禁），正确路径是给 xLyra 核心补
`impersonate_opencode`——顺着它已有的 `impersonate_codex_client` /
`impersonate_claude_code_client` 站点级伪装模式做第三个实例：

1. `bunClientHelloSpec()` 加入 `internal/httpclient/tlsfingerprint.go`（~30 行）；
2. 动态 `x-opencode-session*`/`project` 头生成（照抄 codex/claude_code 的指纹头模式）；
3. （仅当头序实验证明门禁校验头布局时）原始 HTTP/1.1 头渲染器；
4. 之后本仓库交付 `free-opencode` site_provider：端点族/免费目录过滤/品牌化/
   错误分类→cooldown，body 整形可由 `rewritePayload` 承担。

待定案：头序隔离实验（uTLS-Bun hello + Go 排序头）→ 决定第 3 步是否需要。

### 已否决：opencode2api sidecar（仅作机制验证记录）

[参考实现 jasonxu114514/opencode2api](https://github.com/jasonxu114514/opencode2api)
（GPL-3.0，v1.4.7）在本机验证过完整链路（127.0.0.1:18080，`anonymous: true` +
`proxies: ["direct"]`，`/v1/models`、`/v1/chat/completions`、SSE 全通），
作为"Go 能过门禁"的实验证据保留；不作为部署方案。

## 风险与边界

- 免费 ≠ 无限：按会话/项目记账，重负载会 429；opencode2api 的会话轮换机制可缓解；
- 上游随时可收紧（指纹/额度/地区），两个社区项目都在持续跟版；
- 伪装流量与官方 ToS 的关系自担；opencode2api 的 README 明确用于自有账号/匿名层。
