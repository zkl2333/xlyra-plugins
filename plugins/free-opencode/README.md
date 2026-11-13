# free-opencode

OpenCode Zen 免费车道（`https://opencode.ai/inference`，匿名凭证 `public`）的
site_provider 插件。免密使用 OpenCode 官方 CLI 免费层的模型
（`nemotron-3.5-lightning-free`、`deepseek-v4.1-flash-free`、`glm-5.3-flash-free`、
`big-pickle` 等 12+ 个，随上游目录波动）。

## ⚠️ 前置要求（核心能力）

免费车道按**官方 OpenCode CLI（Bun 运行时）的线上形状**校验请求。本插件只承担
应用层；传输与身份头需要网关核心的 Bun 伪装能力：

- **xLyra PR [Yachiiiiyo/xLyra#5](https://github.com/Yachiiiiyo/xLyra/pull/5) 起的
  `gateway.impersonate_opencode_client`**（uTLS Bun ClientHello + Bun 头布局 +
  官方降序时间戳 session 铸造 + 每请求 40-hex project）。
- 没有该核心能力时安装本插件无破坏，但对话请求会被上游 401/429 拒收。

机制与四道门的完整调查记录：仓库 [docs/opencode-zen-free.md](../../docs/opencode-zen-free.md)。

## 分层（与核心的约定）

| 层 | 归属 | 说明 |
|---|---|---|
| TLS ClientHello / HTTP/1.1 / 头布局 / session 铸造 / 每请求 project | 核心（PR #5） | 结构性机制，插件沙箱不可及 |
| **官方系统提示词 + 13 工具注入** | 本插件 `rewritePayload` | 免费层的 agent 形状校验（实测：同传输同头，裸 body 429、整形 body 200） |
| **免费模型目录过滤** | 本插件 `listModels` | 只留 id 含 `free` 或文本输入输出全零价的模型；防误调付费模型 401 冷却唯一 `public` 占位凭据 |
| **限流分类** | 本插件 `classify` | `FreeUsageLimitError`（免费层配额）→ `limited`；核心只认 Go 套餐的 `GoUsageLimitError` |
| UA 版本 / `x-opencode-client` | 本插件 manifest 静态头 | 执行序上插件头在核心 zen 头之后写入，胜出——UA 跟版只需发新版插件 |

**设计红线**：manifest 绝不声明 `x-opencode-session` / `x-opencode-project`——
静态 session 是共享的预烧配额桶（实测快速 429），动态身份头必须由核心生成。

## 使用

1. 安装并启用本插件（`.xlp` 导入；公钥见 release 附件）。
2. 建站点：类型选 `zkl2333.free-opencode/gateway`，API Key 填 `public`
   （官方匿名凭证，会被原样放进 `Authorization: Bearer public`）。
3. 站点设置打开 `gateway.impersonate_opencode_client`（PR #5 起）。
4. 模型同步后即可使用（目录只含免费模型）。

## 维护清单（上游漂移时）

| 症状 | 更新处 | 发版 |
|---|---|---|
| 官方提示词/工具集漂了（403/429 FreeTierError 变多） | `src/assets.ts`（从 opencode2api 仓库取新 `opencode_prompt_v2.txt` / `opencode_tools.json`，跑生成脚本） | 插件 |
| CLI 版本号 UA 漂了 | `manifest.json` `request.headers` | 插件 |
| 目录 free 判定字段变了 | `src/index.ts` `isFreeModel` | 插件 |
| Bun ClientHello / session 编码变了 | xLyra 核心（`bunClientHelloSpec` / `openCodeGoNewSessionID`） | 核心 PR |

改 `src/assets.ts` 或整形逻辑后：重新生成黄金 fixtures
（`node .research/scripts/gen-free-opencode-fixtures.mjs`，脚本同时做与捕获
官方 body 的保真比对）。

## 测试

```
xlyra-plugin test plugins/free-opencode
```

6 个 fixtures：rewrite（宿主默认工具/已整形/自定义工具改名）、listModels
（free 过滤）、classify（FreeUsageLimitError→limited / 其他→unknown）。

## 许可与致谢

- 本插件 MIT。
- 官方提示词/工具资产为 OpenCode CLI 公开捕获件（经由
  [opencode2api](https://github.com/jasonxu114514/opencode2api)（GPL-3.0）仓库的镜像维护）。
- 整形逻辑移植自 [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)
  （MIT）内嵌的 opencode2api v1.4.7 JS 端口；wire 名摘要以无依赖 FNV-1a 替代
  sha256（上游只校验 `clint_` + hex 形状，无法验证摘要）。
