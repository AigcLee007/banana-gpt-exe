# 视频模型标签实施计划

**Goal:** 用名称后标签表达 H3 和 Wan 的特点，删除模型下方建议文字。

**Architecture:** 在 videoModels.ts 以 badges 数组替换 guidance；VideoInputBar.tsx 复用该数组渲染选择框和菜单，并删除说明段落。标签可换行，菜单给价格保留空间。

**Tech Stack:** TypeScript、React、Vitest、Playwright CLI。

在现有 D:/gpt-iamge-2 工作区完成授权的本地修改，保留其他未提交改动。

- [x] 更新 VideoInputBar.test.tsx 既有建议测试，检查 H3 三个独立标签、Wan 两个独立标签、SD 耗时标签及删除旧说明，运行确认预期失败。
- [x] 修改 videoModels.ts 和 VideoInputBar.tsx，实现 badges 元数据与名称后可换行标签。
- [x] 运行 UI 与模型相关测试、生产构建；在浏览器核对桌面与窄屏的菜单标签、价格和主题，不提交生成请求。

验证：修改旧建议断言后出现 4 项预期失败；最终相关 69 项测试通过。Playwright 验证桌面、390/320 像素下 H3/Wan 独立标签、两款 SD 耗时标签、旧说明消失、菜单视口边界、标签与右侧价格不重叠及深色标签对比度。新增标签使菜单需要更大宽度，向右扩展到说明按钮一侧避免父面板裁掉左端；窄屏压缩“模型”字段宽度以显示 H3 完整名称。未发送生成请求；截图位于 output/playwright/video-model-badges-*.png。生产构建通过，保留原有构建提示。

后续按用户要求，将 Wan 显示名称改为 Wan 3.0 Video，保持原 API model 不变，对比表也使用统一显示名称。Wan 去掉标签换行，窄屏收紧模型行间距与标签内边距，优先保留两个完整标签；其余模型保留窄屏换行。浏览器先复现两行失败，修改后验证 1440/1040/390/320 像素下选择框与菜单的单行、标签完整显示、价格和说明入口以及对比表名称一致；最终相关 69 项测试与生产构建通过。截图位于 output/playwright/wan-single-row-*.png。
