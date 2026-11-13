/**
 * free-kilo —— Kilo AI 公共免费模型池的站点类型声明（零钩子设计）。
 *
 * 全部行为由 manifest.json 声明，本文件只导出 meta：
 *
 *  - 模型列表：通用适配器 GET {base}/models；凭据（占位值）放进无关头
 *    X-Kilo-Free-Key——Kilo 只校验 Authorization，无关头放行（2026-11 实测）。
 *  - 对话转发：request.headers 不声明 Authorization 且 stripDownstreamHeaders=true，
 *    协议适配器写的 Authorization 也会被剥离，上游请求不带任何鉴权头。
 *
 * 上游关键行为（2026-11-13 实测）：
 *  - 完全不带 Authorization → 200（免费池放行）
 *  - 带任意无效 Authorization → 401（免费池拒绝）
 *  - 免费模型为列表的子集（isFree=true，快照 14/474）；付费模型无 key 调用会 401。
 *
 * 若将来需要按 isFree 过滤模型列表，再考虑加 listModels 钩子；
 * 注意钩子请求由 xLyra 附加鉴权头，需先实测其走向是否遵循 models.auth。
 */
export const meta = { apiVersion: 1, id: "free-kilo", kind: "site_provider" }
