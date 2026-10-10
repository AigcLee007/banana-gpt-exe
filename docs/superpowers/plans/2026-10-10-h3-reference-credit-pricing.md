# MiniMax H3 工作台积分价格实施计划

**Goal:** 让工作台价格标识和预估包含 H3 参考素材费用，符合 1 元 = 12.5 积分。

**Architecture:** 在现有模型注册表增加参考素材价格配置，现有估算函数统一计算单次与批量积分；视频输入区读取元数据并显示规则和预估，任务保存同口径估算。

**Tech Stack:** TypeScript、React、Zustand、Vitest、Vite。

复用用户指定的 D:/gpt-iamge-2 当前工作区，保留已有未提交修改。本次直接执行已授权的本地修改，不创建新工作树、不提交、不发布。

- [x] 修改 `src/lib/videoModels.test.ts`，将旧的“忽略参考素材”断言改为新规则；新增免费边界、分辨率、参考视频、批量和标签断言。新增 `src/components/VideoInputBar.test.tsx` 的素材时长、未知时长、模式切换和费用说明断言，以及 `src/videoStore.test.ts` 的任务估算断言。运行 `npm test -- src/lib/videoModels.test.ts src/components/VideoInputBar.test.tsx src/videoStore.test.ts`，确认新行为失败。
- [x] 在 `src/lib/videoModels.ts` 增加 `referencePricing`（freeImages=5、imageCredits=0.625、videoPerSecondCredits=768p:1.25/2k:2.5），H3 标签追加“起”。H3 估算使用 `Number(((duration * pricePerSecond + Math.max(refImageCount - 5, 0) * 0.625 + refVideoSeconds * videoRate) * n).toFixed(3))`；其他模型保持当前算法。
- [x] 在 `src/components/VideoInputBar.tsx` 只统计当前模式的图片与视频；参考视频秒数取已读取元数据的合计。H3 选中时展示完整价格规则和“预估”按钮，积分最多三位小数。存在未知时长时按钮显示“费用待估算”。在 `src/videoStore.ts` 从有效任务素材读取视频时长，按每个任务数量 1 保存同口径预估，读取失败或未知时长时省略预估。
- [x] 运行上述相关测试，再运行 `npm test` 和 `npm run build`。使用本地浏览器核对 H3 768P/2K、规则提示、下拉标签及窄屏布局；不点击生成。


验证结果：新增行为在实现前出现 15 项预期失败，修正后相关 89 项测试通过；完整测试 44 个文件、794 项通过；TypeScript 与 Vite 生产构建通过（现有包体积提示保留）。浏览器核对两档基础单价、素材规则、下拉“起”标签和 390px 窄屏换行；独立测试浏览器中通过素材用量夹具验证 23.75 / 46.25 / 双份 92.5 积分。未发送生成请求。最终实际结算仍由服务端完成。
