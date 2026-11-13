# fixtures 说明

本插件是**零钩子**设计（全部行为由 manifest 声明），没有可进 `xlyra-plugin test` 样本的钩子函数，所以这里没有 `*.json` 样本。

若将来加 `listModels` 钩子（例如按 `isFree` 过滤），样本应放在本目录，命名参照官方示例（`list-models.json` 等），并用真实响应做底稿：

```bash
curl -s -m 90 https://api.kilo.ai/api/gateway/models -o /tmp/kilo-models.json
# （注意给足超时——列表约 600KB，20 秒会截断）
```

上游关键行为的实测记录（免鉴权 200 / 带无效 Authorization 401）见 `../src/index.ts` 头部注释。
