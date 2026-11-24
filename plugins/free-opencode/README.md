# free-opencode

OpenCode Zen 免费车道（`https://opencode.ai/inference`，匿名凭证 `public`）的
site_provider 插件。免密使用 OpenCode 官方 CLI 免费层的模型
（`nemotron-3.5-lightning-free`、`deepseek-v4.1-flash-free`、`glm-5.3-flash-free`、
`big-pickle` 等，具体随上游目录波动）。要求 xLyra **v1.19.0+**。

## 核心要求

上游免费车道只接受官方 OpenCode CLI（Bun runtime）的传输形状。插件现通过 v1.19
插件 API 自带：

- `transport.profile: "bun"`：宿主对网关转发与站点分步请求统一使用 Bun TLS/
  HTTP/1.1 头布局；仍由宿主负责 SSRF 防护、代理和主机白名单。
- `request.headers`：UA、`x-opencode-client` 和每请求随机 project id 模板。
- `signRequest` 用 `sessionKey` 对应的 site-scoped storage 持久化官方降序 session id，过期后重铸；无 sessionKey 时每请求随机。

因此 **不再需要手动打开 `gateway.impersonate_opencode_client`**。当管理员显式打开
核心 impersonation 开关时，宿主优先级更高，仍会覆盖插件 transport profile。

## 插件职责

| 责任 | 实现 |
|---|---|
| Bun TLS profile 与线上头布局 | manifest `transport.profile` |
| 每请求 40-hex project | manifest `{{random.hex:40}}` |
| session 降序编码、粘性与过期重铸 | `signRequest` + `sessionKey` + site-scoped `storage` |
| 官方系统提示词 + 13 工具集 | `rewritePayload` |
| 免费目录过滤 | `listModels`：保留 id 含 `free` 或文本输入/输出均零价模型 |
| 免费层限流分类 | `classify`：`FreeUsageLimitError` → `limited` |

## 使用

1. 在 xLyra v1.19.0+ 安装并启用本插件（`.xlp` 导入；公钥随包附带）。
2. 建站点：类型选 `zkl2333.free-opencode/gateway`，API Key 填 `public`
   （官方匿名凭证，会被原样用于 `Authorization: Bearer public`）。
3. 同步模型后即可使用；插件只列出免费模型。

## 维护清单（上游漂移时）

| 症状 | 更新处 | 发版 |
|---|---|---|
| 官方提示词/工具集漂了（FreeTierError 变多） | `src/assets.ts`，刷新后跑捕获体保真生成器 | 插件 |
| CLI 版本号或静态 client 标识变化 | `manifest.json` `request.headers` | 插件 |
| 免费目录字段变化 | `src/index.ts` `isFreeModel` | 插件 |
| Bun ClientHello/头布局变化 | 宿主内置 `transport.profile=bun` | 核心 |
| session 编码/窗口变化 | `src/index.ts` `mintSession` 与 session fixtures | 插件 |

改资产或整形逻辑后运行：

```
`xlyra-plugin test plugins/free-opencode`
```

本地 fixture 检查改用与正式安装相同的受信签名 CLI `xlyra-plugin test`；资产保真检查脚本只用于刷新官方提示词/工具快照。

## 测试与打包

```
xlyra-plugin build plugins/free-opencode
xlyra-plugin test plugins/free-opencode
xlyra-plugin pack --sign <developer-private-key.pem> plugins/free-opencode
xlyra-plugin verify plugins/free-opencode/dist/zkl2333.free-opencode-0.2.2.xlp
```

签名私钥仅供本地 pack 使用，不得入库。发布记录：GitHub Release `zkl2333.free-opencode-v0.2.2`
（附签名 `.xlp` 与公钥）；Cloud 市场提交同版本（审核中）。

## 许可与致谢

- 本插件 MIT。
- 官方提示词/工具资产经 [opencode2api](https://github.com/jasonxu114514/opencode2api)
  （GPL-3.0）仓库镜像维护。
- 整形逻辑参考 [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)
  （MIT）内嵌的 opencode2api JS 端口；客户端工具以可逆 `custom_<hex(原名)>`
  线上名收编（2026-11-24 起上游拒绝 `clint_` 前缀与客户端工具描述中的字面词，
  描述空格替换为 NBSP 规避），`transformStream` 在响应流把线上名解码回原名。
