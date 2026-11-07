# 桌面原生更新与发布配置

本功能使用 electron-updater：Windows x64 仅支持 NSIS 安装版；macOS arm64/x64 使用签名应用的 ZIP 更新载荷，DMG 用于首次安装。开发模式、旧客户端和不支持的平台保留官网下载入口。下载在后台进行；下载完成后只有用户明确点击“重启并安装”，并且图像、Agent、视频、上传等任务都已结束，才能安装。退出应用不会自动安装。

## 固定生产地址

| 平台 | 清单 | 更新载荷 | 首次安装 |
| --- | --- | --- | --- |
| Windows x64 | `https://m.aittco.com/downloads/updates/win-x64/latest.yml` | NSIS `.exe` 与 `.exe.blockmap` | NSIS `.exe` |
| macOS Apple 芯片 | `https://m.aittco.com/downloads/updates/mac-arm64/latest-mac.yml` | 签名、公证的应用 ZIP | `.dmg` |
| macOS Intel | `https://m.aittco.com/downloads/updates/mac-x64/latest-mac.yml` | 签名、公证的应用 ZIP | `.dmg` |

地址由构建配置和主进程固定，网页内容不能指定任意更新服务器。`-banana.N` 是正式分发版本，因此配置 `detectUpdateChannel: false`、`channel: latest`，不使用 `banana.yml`。每次发布必须递增 `package.json` 版本；禁止覆盖已发布的安装文件或复用版本号。

构建命令必须包含 `--config build/desktop-updates.cjs`。不要直接执行省略该参数的 electron-builder 命令，否则包内的更新源可能缺失。

## 目前需要所有者配置的 GitHub Secrets

本仓库不会生成或写入真实凭据。尚未配置时，普通推送仅构建测试包；手动勾选 `publish` 或推送 `v*` 标签会在预检阶段失败，不会连接服务器或修改线上清单。

| Secret | 内容 |
| --- | --- |
| `MAC_CSC_LINK` | 含私钥的 Developer ID Application `.p12` 的 Base64；从 Apple Developer 账号导出，不能使用 ad-hoc 签名 |
| `MAC_CSC_KEY_PASSWORD` | 上述 `.p12` 密码 |
| `APPLE_ID` | 可访问对应 Apple Developer 团队的 Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | 该 Apple ID 的应用专用密码 |
| `APPLE_TEAM_ID` | 10 位 Apple Developer Team ID，必须与签名证书一致 |
| `WIN_CSC_LINK` | 可选：Windows Authenticode `.pfx/.p12` 的 Base64 |
| `WIN_CSC_KEY_PASSWORD` | 可选：Windows 证书密码；与 `WIN_CSC_LINK` 成对配置 |
| `UPDATES_SSH_HOST` | 下载站 SSH 主机名或 IPv4 地址，不含协议或端口 |
| `UPDATES_SSH_USER` | 受限部署账号用户名，不能使用 root |
| `UPDATES_SSH_PORT` | SSH 端口，例如服务器实际使用的端口 |
| `UPDATES_SSH_PRIVATE_KEY` | 部署账号的 OpenSSH 私钥，多行原文 |
| `UPDATES_SSH_KNOWN_HOSTS` | 管理员通过可信渠道核验的完整 known_hosts 主机公钥行；非默认端口使用 `[主机]:端口` |

发布预检要求全部 Mac 签名、公证和 SSH 凭据就绪。Windows 签名可选；配置后构建必须成功签名。工作流用 `env` 传递凭据，不将秘密拼进 shell 命令。SSH 开启 `StrictHostKeyChecking=yes`、`BatchMode=yes` 和固定 known_hosts 文件；不运行自动信任服务器的 `ssh-keyscan`。更换服务器主机密钥时，先由管理员核验新指纹再更新 Secret。

Apple 两种架构发布都必须签名、公证。`verify-mac-release.mjs` 分别解压 ZIP、只读挂载 DMG，检查应用的 Developer ID、Team ID、Hardened Runtime、`codesign --verify --deep --strict`、Gatekeeper、已装订公证票据和二进制架构，最后生成与载荷 SHA512 绑定的 `signing-verification.json`。任一检查失败就不会进入发布步骤。ZIP 内的已公证应用是自动更新实际使用的内容；不能仅给下载页上传一个能打开的未签名 DMG。

## 下载站一次性配置（由服务器管理员执行）

这是需要管理员实际操作的配置说明，本次代码实现没有连接或改动服务器。下载文件在宿主机保存，与 Web Docker 容器分离；Web 重建不会自动发布桌面包。

管理员先创建仅可写下列目录的部署账号，安装 Python 3.9+、OpenSSH/SFTP。给该账号配置专用 authorized_keys 公钥，建议加 `restrict` 限制转发、PTY 等能力，并限制可登录来源；不要赋予 sudo 或 Docker 权限。SSH 账号的 shell 需要能执行 Python，SFTP 用于 scp 上传。部署目录必须是实际目录，不能是符号链接，其父目录也必须使用规范绝对路径。

管理员将实际账号写入 `UPDATES_USER` 后创建目录：

```bash
test -n "$UPDATES_USER" && test "$UPDATES_USER" != root || exit 1
install -d -m 0755 -o "$UPDATES_USER" -g "$(id -gn "$UPDATES_USER")" \
  /www/wwwroot/m.aittco.com/downloads/desktop-updates \
  /www/wwwroot/m.aittco.com/downloads/desktop-updates/.incoming
```

将仓库 `deploy/desktop-updates-nginx.conf` include 到 `m.aittco.com` 的 HTTPS `server {}` 中，放在其他通用正则 location 前。保留现有 `/downloads/` 下载页。若现有配置有 `location ^~ /downloads/`，要先调整，否则它会屏蔽原生 feed 的正则规则。若现有配置全局禁止 symlink，允许受控的 `desktop-updates/current` 指向本目录的 `releases/`。然后执行 `nginx -t`，通过后才 reload。不要将该配置包含在仅负责反向代理 Web 容器的错误 server 中。

新配置会让 `/downloads/version.json` 直接读取 `desktop-updates/current/version.json`。首次迁移时，先完成一次发布生成 `current`，再启用这一条 Nginx alias，避免旧清单在准备阶段变成 404。原生 feed 规则可提前添加。现有下载页应读取 `downloads.windowsUrl`、`downloads.macosArm64Url`、`downloads.macosX64Url`；新的 Windows 地址是可直接安装的 `.exe`，不再是 ZIP/便携版。

发布后目录结构：

```text
downloads/desktop-updates/
  artifacts/win-x64/aittco-<version>-win-x64.exe[.blockmap]
  artifacts/mac-arm64/aittco-<version>-mac-arm64.{dmg,zip,...}
  artifacts/mac-x64/aittco-<version>-mac-x64.{dmg,zip,...}
  releases/<version>/win-x64/latest.yml
  releases/<version>/mac-arm64/latest-mac.yml
  releases/<version>/mac-x64/latest-mac.yml
  releases/<version>/version.json
  releases/<version>/release-index.json
  current -> releases/<version>
  .incoming/
```

Nginx 只开放指定清单和安装载荷，禁止公开 `.incoming`、内部回执和索引。清单及 legacy `version.json` 不缓存且允许 CORS；安装文件支持 Range、长期不可变缓存。旧版本文件保留，避免切换版本后中断已开始的下载。

## 每次发版

1. 递增 `package.json` 版本，填写发布说明，运行 `npm test`、`npm run build`。按 `版本更新说明.md` 独立发布 Web。
2. 提交代码。运行 `Desktop Build`，明确勾选 `publish` 并填写可选 `notes` 更新说明；或者推送与包版本完全一致的标签 `v<package.json.version>`。普通分支 push、未勾选 publish 的手动构建都不会发布。手动输入通过 `RELEASE_NOTES` 安全传给构建和清单生成，原生及 legacy 清单使用同一说明；标签发布默认说明为空。
3. 预检全部凭据；三个平台构建分别使用 `--config build/desktop-updates.cjs --publish never`。macOS 两个产物都通过实际签名、公证验证后，发布 job 才能运行。
4. 发布 job 下载 `desktop-windows`、`desktop-macos-arm64`、`desktop-macos-x64`，分别放到 `artifacts/win-x64`、`artifacts/mac-arm64`、`artifacts/mac-x64`。不上传 unpacked 应用、调试文件、证书或依赖目录。
5. 本地验证清单版本与当前包完全一致、所有列出的载荷 SHA512/size 正确、文件名无目录穿越或外部 URL、平台完整、Mac 回执与实际载荷一致，复制安装包、所有生成的 blockmap、原生清单和 legacy `version.json` 到新 staging 目录。
6. 整个 staging 打包上传私有 incoming。远端重新校验每一个文件的 SHA512/size、所有平台载荷和签名回执，获取独占发布锁。先安装不可变载荷，再安装版本清单，最后通过单次 `os.replace` 原子切换 `current`，同时使三平台原生清单和 `/downloads/version.json` 生效。

可在下载并归类 Actions artifacts 后，仅本地检查（不会连接服务器）：

```bash
node scripts/desktop-release.mjs artifacts staged-release
```

输出目录必须不存在，脚本版本自动读取 `package.json`。可用 `RELEASE_NOTES` 环境变量同时设置构建时的 native release notes 和 legacy 更新说明。自动发布读取与该执行版本一致的包版本。远端已有同版本时拒绝覆盖；失败后原 `current` 保留。若载荷已上传但清单切换前失败，会留下一些不可变文件或未激活的版本目录，由管理员检查日志后处理；不得对整个 downloads 或 releases 执行递归清理。

## 发布验证与限制

```bash
curl -i https://m.aittco.com/downloads/version.json
curl -i https://m.aittco.com/downloads/updates/win-x64/latest.yml
curl -i https://m.aittco.com/downloads/updates/mac-arm64/latest-mac.yml
curl -i https://m.aittco.com/downloads/updates/mac-x64/latest-mac.yml
```

确认 MIME 正确、清单 `Cache-Control` 为 no-store、CORS 为 `*`；对清单中的每个安装地址做完整下载及 SHA512 核验，并确认 Range 请求返回 206。访问下载页确认三条按钮对应当前版 NSIS/DMG。Nginx 配置没有动态生效之前，GitHub 发布成功也不能证明公开地址已正确服务文件。

最终验收必须使用至少一个已安装的旧 Windows NSIS 客户端、一个同 Apple Team 签名的旧 macOS 客户端，完成检查→后台下载/进度→任务进行时禁止安装→任务结束后明确重启安装→重开版本正确。断网应报错并能重试，关闭应用不自动安装。当前尚未配置生产凭据时，不能宣称真实跨版本升级链路已验收。

旧的仅浏览器下载客户端仍读取 `/downloads/version.json`，下载页手动升级继续可用。更早没有更新功能的版本，需要首次手动安装包含 native updater 的版本。macOS 必须保持签名团队连续；错误证书或换团队会被系统拒绝。服务器回滚清单只用于停止分发，客户端默认不会降级已安装版本。

相关配置参考：[electron-builder v26 macOS](https://www.electron.build/v26/docs/mac/)、[v26 代码签名](https://www.electron.build/v26/docs/features/code-signing/)、[v26 公证](https://www.electron.build/v26/docs/features/code-signing/notarization/)。本项目使用 v26 的 `mac.hardenedRuntime`、`mac.entitlements` 等平面字段，不套用 v27 的 `mac.sign` 配置。
