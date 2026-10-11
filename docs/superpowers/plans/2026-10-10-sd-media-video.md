# 三个 SD 视频模型实施计划

**Goal:** 将用户指定的三个模型加入 D:/gpt-iamge-2 的视频工作台，完整支持素材、任务与精确单条价格。

**Architecture:** 在现有模型注册表新增公开模型配置，添加独立 sdMedia JSON 适配器；复用 Uguu 上传、用户 API 设置、任务持久化和成片下载。

**Tech Stack:** TypeScript、React、Zustand、Vitest、Vite、Playwright CLI。

用户已授权当前项目接入，当前 Git 工作区干净，直接在指定项目实施。此计划沿用既有工作台设计，不需要新增交互设计。元转积分复用项目 CREDITS_PER_YUAN。

## 1. 模型能力与精确价格

- [x] 在 src/lib/videoModels.test.ts 和 src/components/VideoInputBar.test.tsx 先写失败测试，覆盖 3.5/4.5/3 元与 45/60/37.5 积分、固定单条、三个/六个比例、整数时长、首尾帧和素材数量。
- [x] 运行 npm test -- src/lib/videoModels.test.ts src/components/VideoInputBar.test.tsx，确认新增断言失败。
- [x] 修改 src/lib/videoModels.ts 增加 sdMedia 适配器 ID 和三个模型；元价格换算为精确积分，选择器与 estimateVideoCredits 统一使用积分。
- [x] 修改 src/components/VideoInputBar.tsx 精确显示新模型积分，隔离 Wan 提示并添加新模型能力提示。

## 2. JSON media 协议

- [x] 新建 src/lib/videoAdapters/sdMedia.test.ts，以真实上传模块加模拟网络测试公开 JSON 请求、首尾帧、混合参考顺序、先校验后上传、超限/失败/取消、公开查询状态和认证下载；运行确认缺少适配器导致失败。
- [x] 新建 src/lib/videoAdapters/sdMedia.ts，按本站文档转换编辑器素材引用到 type/url：first_frame、last_frame、reference_image、reference_video、reference_voice；不发送隐藏参数或私有型号。
- [x] 在 src/lib/videoApi.ts 注册 sdMedia，并在 src/lib/videoApi.test.ts 测试模型对应的时长错误提示。
- [x] 在 src/videoStore.test.ts 验证新模型切换时的素材裁剪、任务快照精确积分及 30 秒轮询；在 src/lib/videoApiCancellation.test.ts 扩展取消保护。

## 3. 验证与交付

- [x] 运行新增及相关适配器/工作台回归：npm test -- src/lib/videoModels.test.ts src/lib/videoAdapters/sdMedia.test.ts src/lib/videoApi.test.ts src/lib/videoApiCancellation.test.ts src/components/VideoInputBar.test.tsx src/videoStore.test.ts。
- [x] 更新 README.md 的模型、价格、素材上传与能力说明。
- [x] 运行 npm test 和 npm run build，确认退出 0。
- [x] 使用本地浏览器检查九个模型选择、新模型价格/时长/比例/参考控件，不进行真实生成或上传。
- [x] 独立只读审查改动，处理重要问题后验证最终 diff，交付具体文件与验证结果。

## 验证记录（2026-10-10）

- 全量 `npm test`：47 个测试文件、907 项测试通过，退出 0。
- `npm run build`：TypeScript 检查和 Vite 生产构建通过，退出 0；保留现有构建体积及 Browserslist 数据提示。
- 价格详情回归：按最终定价验证 45/60/37.5 积分的精确显示；旧模型显示保持原有格式。
- 独立代码审查发现图片未解码的校验缺口；补充解码失败、零尺寸和位图释放回归后通过复审，无剩余严重或重要问题。
- 本地浏览器确认九个模型选择、三个新模型的元价格/准确积分、时长、比例、素材类型/数量与首尾帧控件；桌面及 390px 手机截图已检查，无横向溢出。
- 浏览器模拟接口验证三种调用：混合参考、首尾帧及纯文本；5 次素材上传和 9 次视频接口调用全部由本地拦截，确认 JSON 角色/顺序、鉴权、准确任务费用、下载保存与刷新后的记录恢复。
- 未执行真实视频生成、真实素材上传或线上发布。浏览器截图及临时验证脚本位于已忽略的 `output/playwright/`。
