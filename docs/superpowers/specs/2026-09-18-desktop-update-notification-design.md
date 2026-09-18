# Desktop Update Notification Design

## Goal

让 Windows 和 macOS 桌面客户端在有新版本时自动提示用户，并在用户点击“立即更新”时打开自有下载中心，由用户手动选择并安装对应平台的安装包。

## Architecture

- 桌面端启动后继续使用现有版本检查流程，但桌面端的清单地址固定为 `https://m.aittco.com/downloads/version.json`。
- Web 端继续检查当前部署根路径下的 `/version.json`，不改变现有 Web 版刷新更新行为。
- 版本清单采用 JSON，至少包含 `version`、可选 `notes`，以及 `desktop.downloadPage`。桌面端只需要下载页面地址，不自动下载或安装文件。
- 网站清单必须通过 HTTPS 返回 `application/json`，并允许桌面客户端跨域 GET 请求。清单中的 `version` 使用与 `package.json` 一致的版本字符串。

## User Flow

1. 桌面客户端启动约 10 秒后执行一次自动检查；已有本地节流和失败重试抑制规则继续生效。
2. 当远程版本高于当前版本时显示现有“发现新版本”弹窗，展示当前版本、最新版本和更新说明。
3. 用户点击“立即更新”时，在系统浏览器打开 `desktop.downloadPage`；若清单缺少该地址，则回退到 `https://m.aittco.com/downloads/`。
4. 用户点击“稍后提醒”时关闭弹窗；本次运行期间不重复提示，下次启动仍会检查。
5. 清单请求失败、格式无效或下载页地址不是 HTTPS 时静默失败（手动检查时沿用现有错误提示），不影响主应用使用。

## Data Contract

```json
{
  "version": "0.4.6-banana.11",
  "notes": "新增功能与问题修复",
  "desktop": {
    "downloadPage": "https://m.aittco.com/downloads/"
  }
}
```

## Testing

- 单元测试覆盖桌面清单地址、清单解析、HTTPS 下载页校验、缺省下载页回退和版本比较。
- 运行完整测试与生产构建，确认桌面入口和 Web 版入口均可正常编译。
- 不在本次改动中实现自动下载、签名校验或自动安装；这些属于后续独立需求。
