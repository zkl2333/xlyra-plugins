# free-kilo

把 [Kilo AI 公共网关的免费模型池](https://api.kilo.ai/api/gateway)接进 xLyra：**零密钥、零鉴权、零伪装**——免费池由 Kilo 官方公开提供（`/models` 与 `/chat/completions` 对无凭据请求放行），本插件只是把它声明成一个站点类型。

## 为什么需要插件（而不是 openai 通用类型 + 自定义 baseURL）

Kilo 免费池的行为很特别（2026-11-13 实测）：

| 请求姿势 | 结果 |
| --- | --- |
| 完全不带 `Authorization` | ✅ 200 |
| 带任意无效 `Authorization`（如占位 key） | ❌ 401 |

通用 `openai` 类型站点会**给每个请求挂 `Authorization: Bearer <你存的key>`**——免费池直接拒绝。本插件用 site_provider 的声明能力解决：

- **对话转发**：`request.headers` 不声明 `Authorization` + `stripDownstreamHeaders: true`——协议适配器写的 Authorization 也会被剥离，上游收到干净请求；
- **模型列表**：`models.auth: "header:X-Kilo-Free-Key"`——占位凭据放进 Kilo 无视的无关头，不碰 Authorization。

零钩子：全部行为在 manifest 里，`src/index.ts` 只导出 meta。

## 使用

1. 构建并签名（详见仓库根 README 的工具链说明）：
   ```bash
   xlyra-plugin keygen --out my-key.pem        # 首次
   xlyra-plugin pack --sign my-key.pem plugins/free-kilo
   ```
2. 管理员在 **设置 → 插件** 导入公钥、上传 `dist/free-kilo-0.1.0.xlp`、启用（site_provider 必须签名）；
3. 添加站点：类型选 `free-kilo/gateway`，**API Key 随便填**（如 `free`，仅满足表单校验，不会发往上游），baseURL 留空用官方端点；
4. 同步模型，选择器里就会出现免费模型。

## 免费模型快照（2026-11-13，474 个中 14 个 `isFree`）

| 模型 | 上下文 | 最大输出 | 输入 |
| --- | --- | --- | --- |
| `kilo-auto/free`（自动路由全部免费模型） | 256K | 32K | 文本 |
| `nvidia/nemotron-3.5-super-vl:free` | 1M | 131K | 文+图+视频 |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 1M | 64K | 文本 |
| `nvidia/nemotron-3.5-lightning:free` | 1M | 64K | 文本 |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256K | 64K | 文+图+音+视频 |
| `baidu/ernie-5.5-flash-preview:free` | 1M | 921K | 文本 |
| `particle-ai/particle-1:free` | 1M | 131K | 文+图 |
| `dots-studio/dots-3-note-preview:free` | 512K | 460K | 文+图 |
| `apodex/apodex-1.1-mini:free` | 256K | 235K | 文本 |
| `cohere/north-mini-code:free` | 256K | 64K | 文本 |
| `stealth/glyph-cluster` | 256K | 256K | 文本 |
| `liquid/lfm-3-1.7b:free` | 256K | 8K | 文本 |
| `openrouter/free` | 200K | — | 文+图 |
| `reflection/beam-free` | 1M | 131K | 文本 |

注意：模型列表会同步**全部** 474 个（manifest 无法过滤）；只有上表里的 `isFree` 模型能真正跑通，付费模型无 key 调用会 401。要过滤列表需加 `listModels` 钩子（见 `src/index.ts` 尾注）。

## 注意事项

- **隐私**：Kilo 模型卡明示免费池 prompt 可能被上游提供方记录并用于改进服务（NVIDIA 免费端点为试用条款、有日志）。**不要用免费池跑敏感内容**。
- **非官方**：本插件与 Kilo AI 无隶属关系；免费额度、模型集合、接口行为由上游单方面决定，随时可能变更。
- 端点与行为的实测记录见 `src/index.ts` 注释；上游变更时可先跑 `curl -s https://api.kilo.ai/api/gateway/models | head` 快速复核。

## License

MIT
