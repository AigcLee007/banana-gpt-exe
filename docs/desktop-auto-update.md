# 桌面原生更新与发布配置

Windows 桌面自动更新使用 electron-updater，仅支持 Windows x64 NSIS 安装版。macOS ARM 和 Intel 每次正式发版都会构建并发布手动安装 DMG，不使用 Mac 自动更新。Mac 包没有 Apple Developer 签名和公证，首次打开时 macOS 可能拦截，需要用户在“隐私与安全性”中手动允许。开发模式、旧客户端和其他不支持的平台也保留官网下载入口。Windows 更新在后台下载；下载完成后只有用户明确点击“重启并安装”，并且图像、Agent、视频、上传等任务都已结束，才能安装。退出应用不会自动安装。

## 固定生产地址

| 平台 | 清单 | 更新载荷 | 首次安装 |
| --- | --- | --- | --- |
| Windows x64 | `https://m.aittco.com/downloads/updates/win-x64/latest.yml` | NSIS `.exe` 与 `.exe.blockmap` | NSIS `.exe` |
| macOS Apple 芯片 | 不适用 | 不适用 | `version.json` 中的 `downloads.macosArm64Url` DMG |
| macOS Intel | 不适用 | 不适用 | `version.json` 中的 `downloads.macosX64Url` DMG |

地址由构建配置和主进程固定，网页内容不能指定任意更新服务器。`-banana.N` 是正式分发版本，因此配置 `detectUpdateChannel: false`、`channel: latest`，不使用 `banana.yml`。每次发布必须递增 `package.json` 版本；禁止覆盖已发布的安装文件或复用版本号。

构建命令必须包含 `--config build/desktop-updates.cjs`。不要直接执行省略该参数的 electron-builder 命令，否则包内的更新源可能缺失。

## 目前需要所有者配置的 GitHub Secrets

本仓库不会生成或写入真实凭据。正式发布只需要受限 SSH 发布凭据；Apple Developer 证书、公证账号不是必需项。普通推送仅构建测试包；手动勾选 `publish` 或推送 `v*` 标签才会连接下载站并切换线上清单。

| Secret | 内容 |
| --- | --- |
| `WIN_CSC_LINK` | 可选：Windows Authenticode `.pfx/.p12` 的 Base64 |
| `WIN_CSC_KEY_PASSWORD` | 可选：Windows 证书密码；与 `WIN_CSC_LINK` 成对配置 |
| `UPDATES_SSH_HOST` | 下载站 SSH 主机名或 IPv4 地址，不含协议或端口 |
| `UPDATES_SSH_USER` | 受限部署账号用户名，不能使用 root |
| `UPDATES_SSH_PORT` | SSH 端口，例如服务器实际使用的端口 |
| `UPDATES_SSH_PRIVATE_KEY` | 部署账号的 OpenSSH 私钥，多行原文 |
| `UPDATES_SSH_KNOWN_HOSTS` | 管理员通过可信渠道核验的完整 known_hosts 主机公钥行；非默认端口使用 `[主机]:端口` |

发布预检只要求受限 SSH 凭据，不需要 Apple Developer 证书或账号。Windows 签名可选；如果配置，证书和密码必须成对提供。工作流用 `env` 传递凭据，不将秘密拼进 shell 命令。SSH 开启 `StrictHostKeyChecking=yes`、`BatchMode=yes` 和固定 known_hosts 文件；不运行自动信任服务器的 `ssh-keyscan`。更换服务器主机密钥时，先由管理员核验新指纹再更新 Secret。GitHub macOS runner 会生成未签名 DMG。

Mac 自动更新已关闭。新正式发版会更新 `version.json` 里的两个 Mac 下载地址；旧 Mac 自动更新清单若存在，会原样保留以兼容旧客户端，不再生成新的 Mac 自动更新载荷。

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

新配置会让 `/downloads/version.json` 直接读取 `desktop-updates/current/version.json`。首次迁移时，先完成一次 Windows-only 发布生成 `current`，再启用这一条 Nginx alias，避免旧清单在准备阶段变成 404。现有下载页应读取 `downloads.windowsUrl`、`downloads.macosArm64Url`、`downloads.macosX64Url`；新的 Windows 地址是可直接安装的 `.exe`，不再是 ZIP/便携版。若首次发布前已有线上 Mac 下载地址但它们不在 `version.json` 中，管理员应先将实际链接写入下载清单再启用新 alias。

发布后目录结构：

```text
downloads/desktop-updates/
  artifacts/win-x64/aittco-<version>-win-x64.exe[.blockmap]
  artifacts/mac-arm64/aittco-<version>-mac-arm64.dmg
  artifacts/mac-x64/aittco-<version>-mac-x64.dmg
  releases/<version>/win-x64/latest.yml
  releases/<version>/mac-arm64/latest-mac.yml  # copied from prior release, if present
  releases/<version>/mac-x64/latest-mac.yml    # copied from prior release, if present
  releases/<version>/mac-arm64/<versioned>.dmg
  releases/<version>/mac-x64/<versioned>.dmg
  releases/<version>/version.json
  releases/<version>/release-index.json
  current -> releases/<version>
  .incoming/
```

Nginx 只开放指定清单和安装载荷，禁止公开 `.incoming`、内部回执和索引。清单及 legacy `version.json` 不缓存且允许 CORS；安装文件支持 Range、长期不可变缓存。旧版本文件保留，避免切换版本后中断已开始的下载。

## 每次发版

1. 递增 `package.json` 版本，填写发布说明，运行 `npm test`、`npm run build`。按 `版本更新说明.md` 独立发布 Web。
2. 提交代码。运行 `Desktop Build`，明确勾选 `publish` 并填写可选 `notes` 更新说明；或者推送与包版本完全一致的标签 `v<package.json.version>`。普通分支 push、未勾选 publish 的手动构建都不会发布。手动输入通过 `RELEASE_NOTES` 安全传给构建和清单生成，原生及 legacy 清单使用同一说明；标签发布默认说明为空。
3. 预检 SSH 发布凭据；Windows、macOS ARM、macOS Intel 分别使用 `--config build/desktop-updates.cjs --publish never` 构建。Mac 构建生成未签名 DMG，不需要 Apple 账号或本地 Mac。
4. 发布 job 下载 `desktop-windows`、`desktop-macos-arm64`、`desktop-macos-x64`，分别放到 `artifacts/win-x64`、`artifacts/mac-arm64`、`artifacts/mac-x64`。不上传 unpacked 应用、调试文件、证书或依赖目录。
5. 本地验证 Windows 清单、全部包的 SHA512/size 和版本，stage 两个 Mac DMG、Windows 更新载荷和 `version.json`。
6. 远端重新校验文件和哈希并获取发布锁；保留已有 Mac 更新清单快照，再原子切换 `current`。新 `version.json` 同时更新 Windows 和两个 Mac 下载地址。

可在下载并归类 Actions artifacts 后，仅本地检查（不会连接服务器）：

```bash
node scripts/desktop-release.mjs artifacts staged-release manual-mac
```

输出目录必须不存在，脚本版本自动读取 `package.json`。可用 `RELEASE_NOTES` 环境变量同时设置构建时的 native release notes 和 legacy 更新说明。自动发布读取与该执行版本一致的包版本。远端已有同版本时拒绝覆盖；失败后原 `current` 保留。若载荷已上传但清单切换前失败，会留下一些不可变文件或未激活的版本目录，由管理员检查日志后处理；不得对整个 downloads 或 releases 执行递归清理。

## 发布验证与限制

```bash
curl -i https://m.aittco.com/downloads/version.json
curl -i https://m.aittco.com/downloads/updates/win-x64/latest.yml
```

确认 MIME 正确、清单 `Cache-Control` 为 no-store、CORS 为 `*`；对清单中的每个安装地址做完整下载及 SHA512 核验，并确认 Range 请求返回 206。访问下载页确认三条按钮对应当前版 NSIS/DMG。Nginx 配置没有动态生效之前，GitHub 发布成功也不能证明公开地址已正确服务文件。

最终验收使用旧 Windows NSIS 客户端确认后台下载、忙碌任务期间禁止安装、空闲后手动重启安装。Mac 用户从下载页取得对应芯片的新版 DMG 并手动安装；确认 `version.json` 的两个 Mac 下载地址包含新版本号。未签名 DMG 可能被 Gatekeeper 拦截，需要用户在系统设置中允许打开。

旧的仅浏览器下载客户端仍读取 `/downloads/version.json`。更早没有版本检查功能的客户端需先手动安装带更新功能的 Windows 版本；Mac 始终手动安装。服务器回滚清单只用于停止分发，客户端默认不会降级已安装版本。
