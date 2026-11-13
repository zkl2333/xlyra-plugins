# fixtures 说明

`listModels` 钩子的样本，`xlyra-plugin test plugins/free-kilo` 会全部跑一遍：

| 文件 | 覆盖 |
| --- | --- |
| `list-models.json` | 真实 `/models` 快照（2026-11-13）裁剪出的 6 条：只留 3 个 `isFree`。被过滤掉的有付费路由 `kilo-auto/efficient`、`:free` 版的付费同名 `nvidia/nemotron-3.5-super-vl`、标价为 0 但不是 `isFree` 的 `humansand/ampersand-v0.1`；`openrouter/free` 的最大输出为 `null`，不写 `output_token_limit` |
| `list-models-http-error.json` | 上游非 2xx：报错，不返回空列表 |
| `list-models-no-free.json` | 一个 `isFree` 都没有（多半是上游改了字段）：报错 |
| `list-models-bad-shape.json` | 响应里没有 `data` 数组：报错 |

更新快照时请用真实响应做底稿，裁剪后再放进样本（完整列表约 610 KB，不要整份入库）：

```bash
curl -s -m 90 https://api.kilo.ai/api/gateway/models -o kilo-models.json
# 给足超时；20 秒可能截断
```
