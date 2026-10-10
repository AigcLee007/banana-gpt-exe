# Wan 720P 与 Uguu 自动上传

用户已同意接入 wan3.0-video-720p，并保留本地文件选择、生成前自动上传到 Uguu。

创建、查询、下载使用现有 API Profile 和视频代理。Wan 使用独立适配器，仅发送文档列出的 JSON 字段；默认 8 秒、16:9、720p、数量 1，不发送 n、metadata、size 或生成声音开关。支持 t2v、i2v、ref2v，无尾帧。图片最多 10 张、30 MB；视频最多 5 个、50 MB、MP4/MOV、2–15 秒、24–60 FPS，总长 15 秒；音频最多 5 个、15 MB、MP3/WAV、2–15 秒、总长 15 秒；合计 20 个。音频需搭配图片或视频。有参考视频时输出限制 4–15 秒，否则 4–30 秒。

素材继续存 IndexedDB。提交时先验证全部素材及提示词，再逐文件向 Uguu 上传，不持久化临时直链，每次新建任务重新上传；失败时不创建远程视频任务。Uguu 用 multipart files[]，返回 success/files/url。接受其 HTTPS 子域下载直链。网页通过固定目标同源 /media-upload/uguu，开发服务器和 Docker Nginx 均提供此路由；安装版通过 app 协议主进程转发，保持 webSecurity。不向 Uguu 转发 Authorization 或 Cookie。直链保存 3 小时，界面说明第三方临时上传。上传有超时和大小限制。

按素材类型分别编号，提示词 UI 标签转为 @image1/@video1/@audio1；单图映射 image_url，多图使用 reference_image_urls，视频/音频使用数组。保持引用顺序，不上传隐藏模式草稿。unknown 状态保留任务、15 秒后重查，不重复创建；completed 才带原密钥下载 /content。错误消息避免错误地提示 1–15 秒限制。价格未知显示待配置。提供模型标识，不冒用其他品牌 Logo。

验证包括注册、时长动态变化、素材全量预校验、MP4/MOV 帧率解析、Uguu 回包及失败、鉴权隔离、提交字段白名单、提示词编号、unknown 恢复、网页和桌面上传代理、旧模型回归、构建。用无敏感内容的合成 PNG 实测 Uguu 上传与无鉴权直链下载，不调用真实付费生成接口。不发布、推送或部署。
