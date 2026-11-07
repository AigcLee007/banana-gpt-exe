# GPT Image 2.6 支持设计

用户于 2026-11-05 确认定向移植方案。

2026-11-07 调整：Sunburst/Flare 的原模型分别标记为优质特价线路，新增以 `-1k` 结尾的 1K动图线路。格式和复杂度选项仅在 1K动图线路显示，该线路尺寸只允许 1K。保留其他线路和现有功能。

基于上游 v0.8.8（7ae7dec），保留艾特智绘现有 Electron、视频、Agent、调色和多模型功能。新增 gpt-image-2.6-sunburst 与 gpt-image-2.6-flare，不凭空指定价格，不覆盖用户已保存模型。

画廊提供 PNG/JPEG/WebP/SVG/GIF 格式，以及 auto/low/medium/high 复杂度。GIF 帧数限制 2–16，默认 9；时长限制 20–2000 ms，默认 200。SVG 仅文生图，使用 API 配置中的 svgModel，默认 gpt-6.1-sol。Agent 保留位图输出。fal.ai 支持 2.6 复杂度（reasoning_effort）与 GIF，不提供 SVG。

Images JSON、multipart 编辑、Responses 图像工具和自定义供应商模板均传递适用字段。SVG/GIF 关闭中间图流式传输；SVG 多图拆为单图请求。GIF/SVG 透明背景只使用 API 原生透明通道。SVG/GIF 用作参考图时转 PNG，GIF 取第一帧。

保存、下载、备份和历史复用保留格式及新参数；旧记录缺失字段时使用默认值。回归测试覆盖模型选择、参数兼容、请求体、MIME、下载与数据清洗，最后运行全量测试和生产构建。上线部署与桌面安装包发布是后续独立步骤。

GIF 使用原文件在画廊中播放，生成结果按实际帧数核验；单帧 GIF 报错并保留原文件。SVG 根据文件内容识别实际格式，返回 PNG 时显示格式不符并保留下载。用户部署 New API 参数保留补丁后已验证 GIF 成功；当前 Osodm 线路的 SVG 仍返回 PNG，SVG 服务端支持尚未确认，本次不增加独立文本模型生成流程。
