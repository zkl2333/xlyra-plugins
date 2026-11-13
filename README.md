# xlyra-plugins

[xLyra](https://github.com/Yachiiiiyo/xLyra) 网关的插件集。每个插件是 `plugins/` 下一个独立包：`manifest.json` + 零外部依赖的 TypeScript + fixtures 测试样本，用官方 `xlyra-plugin` CLI 测试、打包（`.xlp`）、签名、发布。

> xLyra 插件的设计原则：**插件只"描述"要做什么，真正的执行永远在 xLyra 里**——密钥不进 JS，选路和计费不可被插件改动。kind 由 xLyra 固定（`quota_probe` / `protocol` / `model_list` / `credential_check` / `site_detect` / `error_classifier` / `model_metadata` / `pricing_parse` / `automation` / `site_provider`），不能自造。

## 插件一览

`free-*` 系列：免密钥、免伪装的公开免费模型池，每池一个包（xLyra 规定一个包只能声明一个站点类型，聚合由网关天然完成）。

| 插件 | kind | 说明 |
| --- | --- | --- |
| [free-kilo](plugins/free-kilo/) | `site_provider` | Kilo AI 公共免费池（`isFree` 模型，2026-11 快照 14 个，含 1M ctx 的 NVIDIA/百度免费模型）：零密钥零鉴权，纯 manifest 声明（清 Authorization 头 + 无关头放凭据占位） |

### 路线记录

- **OpenCode 免费车道（待验证）**：此前请求返回 401，但未做同请求的 Bun/Node 对照，不能据此认定是传输层校验，更不能断言插件不可行。本仓库暂不提供该适配。
- **注册送 key 型免费层**（OpenRouter free tier 等）不需要插件：通用 `openai` 类型 + 自定义 baseURL + 真 key 直接加站点。

## 开发流程

`xlyra-plugin` CLI 需要从新版 xLyra 源码构建（本地 `E:\workspace\mine\ai\xlyra\xLyra` 克隆较旧，先 `git pull`）：

```bash
cd /e/workspace/mine/ai/xlyra/xLyra/server && go build -o xlyra-plugin ./cmd/xlyra-plugin
```

然后（在插件目录或指定目录）：

```bash
xlyra-plugin init --kind site_provider plugins/<name>   # 生成规范结构（可校对手写脚手架）
xlyra-plugin test                                        # 跑 fixtures
xlyra-plugin run --key-env XXX --base-url https://...    # 对真实站点试跑（支持的 kind）
xlyra-plugin keygen --out my-key.pem                     # 首次生成签名密钥
xlyra-plugin pack --sign my-key.pem                      # 打包 dist/<id>-<version>.xlp
xlyra-plugin verify dist/<id>-<version>.xlp
```

发布两条路：私下分发（`.xlp` + 公钥给管理员导入，**`site_provider` 必须签名**）或 xLyra Cloud 市场（命名空间 id，审核制）。

## 注意

- `site_provider` 的 `account_pool`（OAuth 订阅账号池）启用需**受信签名**并确认主机列表；自己网关自签即可上，公开分发需平台信任。
- 插件代码不能 `import` 任何 npm 包（`import type` 除外）；编辑器类型由根 `package.json` 的 devDependency `@yachiyo-5i/xlyra-plugin-sdk` 提供。
- 文档：xLyra 仓库 `docs/plugins/`（本仓库脚手架依据 quickstart / kinds / manifest / site-provider）。
