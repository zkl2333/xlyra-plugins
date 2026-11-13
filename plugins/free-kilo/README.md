# Kilo Free Pool（`zkl2333.free-kilo`）

把 [Kilo AI 公共网关的免费模型池](https://api.kilo.ai/api/gateway)接进 xLyra：**零密钥、零鉴权、零伪装**。免费池由 Kilo 官方公开提供（`/models` 与 `/chat/completions` 对无凭据请求放行），本插件把它声明成站点类型 `zkl2333.free-kilo/gateway`，并且**只同步免密能用的 `isFree` 模型**。

## 为什么需要插件（而不是 openai 通用类型 + 自定义 baseURL）

Kilo 免费池的行为很特别（2026-11-13 实测）：

| 请求姿势 | 结果 |
| --- | --- |
| 完全不带 `Authorization` 调 `isFree` 模型 | ✅ 200（13/13） |
| 带任意无效 `Authorization`（如占位 key） | ❌ 401 `INVALID_TOKEN` |
| 不带 `Authorization` 调非 `isFree` 模型（包括标价为 0 的） | ❌ 401 `PAID_MODEL_AUTH_REQUIRED` |

通用 `openai` 类型站点会**给每个请求挂 `Authorization: Bearer <你存的key>`**，免费池直接拒绝；它还会把 `/models` 里的全部模型（快照 473 个）都同步进来。本插件这样处理：

- **对话转发**：`request.headers` 不声明 `Authorization`，并开启 `stripDownstreamHeaders: true`。协议适配器写的 Authorization 也会被剥离，上游收到的是干净请求。
- **模型列表**：`listModels` 钩子拉 `/models`，只保留 `isFree: true` 的条目，并写上 `supported_endpoint_types` 和输入、输出 token 上限。
- **验 Key / 健康检查**：通用适配器的 `models.auth: "header:X-Kilo-Free-Key"` 把占位凭据放进 Kilo 不检查的无关头，不碰 Authorization。

### 为什么必须过滤

在 xLyra 里，上游返回 401 会让**这把凭据**进入冷却：5 分钟，30 分钟内重复则 30 分钟。本站只有一把占位 Key，所以只要有一次请求被路由到付费模型，**整站的免费模型都会跟着停用**。另外，xLyra 会把 `xxx:free` 和付费的 `xxx` 归并成同一个标准模型（快照里 13 个免费模型有 5 个存在付费同名版本）。不过滤的话，即使请求的是免费模型，也可能被路由到付费版。v0.2.0 起付费模型不再进入列表，这两条路都断了。

## 使用

1. 构建并签名（工具链见仓库根 README）：
   ```bash
   xlyra-plugin pack --sign my-key.pem plugins/free-kilo
   ```
2. 安装：从 **设置 → 插件 → 市场** 安装（上架后），或者在「已安装」里上传 `dist/zkl2333.free-kilo-<version>.xlp`。手动上传需要先导入公钥。启用时确认主机 `api.kilo.ai`。
3. 添加站点：类型选 **Kilo 免费池**（`zkl2333.free-kilo/gateway`）。**API Key 随便填**（如 `free`），它只用来满足表单校验，不会发往上游。baseURL 留空即使用官方端点。
4. 同步模型。列表里只会出现下表这类免费模型。

客户端调用时用 xLyra 归并后的模型名，例如 `kilo-auto/free` 在 `/v1/models` 里显示为 `kilo-auto`（直接写 `kilo-auto/free` 也能命中）。

## 免费模型快照（2026-11-13，473 个中 13 个 `isFree`，逐个免密实测 200）

| 模型 | 上下文 | 最大输出 | 输入 |
| --- | --- | --- | --- |
| `kilo-auto/free`（在免费模型间自动轮换） | 256K | 32K | 文本 |
| `nvidia/nemotron-3.5-super-vl:free` | 1M | 131K | 文+图+视频 |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 1M | 64K | 文本 |
| `nvidia/nemotron-3.5-lightning:free` | 1M | 64K | 文本 |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256K | 64K | 文+图+音+视频 |
| `baidu/ernie-5.5-flash-preview:free` | 1M | 921K | 文本 |
| `particle-ai/particle-1:free` | 1M | 131K | 文+图 |
| `dots-studio/dots-3-note-preview:free`（免费期至 2026-12-31） | 512K | 460K | 文+图 |
| `cohere/north-mini-code:free` | 256K | 64K | 文本 |
| `stealth/glyph-cluster` | 256K | 256K | 文本 |
| `liquid/lfm-3-1.7b:free` | 256K | 8K | 文本 |
| `openrouter/free`（OpenRouter 免费路由） | 200K | — | 文+图 |
| `reflection/beam-free` | 1M | 131K | 文本 |

免费模型集合由 Kilo 随时调整（11-13 当天就下线了 `apodex/apodex-1.1-mini:free`）。站点定时刷新时会重新同步模型（默认 cron `0 */15 * * *`），也可以手动刷新。下线的模型会被标成 `unavailable`：不再参与路由，但不会被删除。

## 注意事项

- **隐私**：Kilo 模型卡明示免费池的 prompt 可能被上游提供方记录，并用于改进服务（NVIDIA 免费端点按试用条款执行，有日志）。**不要用免费池跑敏感内容**。
- **两次同步之间的变化**：如果某个模型在两次同步之间从免费转为付费，调用它会返回 401 并让站点凭据冷却，直到下次同步把它移出列表。遇到这种情况可以手动刷新一次模型。
- **列表体积**：上游 `/models` 目前约 610 KB，而钩子能接收的响应上限是 1 MiB。超过上限后同步会报 `response too large`，已同步的模型保持不变。
- **非官方**：本插件与 Kilo AI 无隶属关系。免费额度、模型集合和接口行为都由上游单方面决定，随时可能变更。图标取自 [kilo.ai 官方 favicon](https://kilo.ai/favicon/android-chrome-512x512.png)（为满足 xLyra 深色界面的图标校验垫了白色底），商标权利归 Kilo AI 所有，如有侵权请联系下架。
- 上游行为的实测记录见 `src/index.ts` 头部注释。上游变化时，可以先用 `xlyra-plugin run --hook listModels --key-env K --base-url https://api.kilo.ai/api/gateway plugins/free-kilo` 复核（`K=free`）。

## License

MIT
