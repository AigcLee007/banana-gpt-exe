# 发布记录模板

> 用途：每次发版时复制本模板，替换版本号、日期、提交信息、安装包文件名与部署记录即可。
>
> 建议命名：`docs/releases/YYYY-MM-DD-vX.Y.Z.md`
> 例如：`docs/releases/2026-06-17-v0.4.6-banana.1.md`

---

## 1. 发布概览

- 项目名称：香蕉 GPT / banana-gpt-exe
- 发布版本：`vX.Y.Z`
- 发布日期：`YYYY-MM-DD`
- 发布负责人：`填写姓名`
- Git 分支：`main`
- Git Commit：`填写 commit id`
- Docker 镜像：`banana-gpt:X.Y.Z`
- 部署方式：`Docker`

### 适用平台

- Windows：`是 / 否`
- macOS Apple 芯片：`是 / 否`
- macOS Intel：`是 / 否`
- Web：`是 / 否`

---

## 2. 本次发布内容

### 2.1 功能更新

- `填写本次新增功能`
- `填写本次升级点`

### 2.2 问题修复

- `填写本次修复的问题`
- `填写本次兼容性修复`

### 2.3 风险说明

- `填写已知风险；如无则写“无”`

---

## 3. 对外发布信息

### 3.1 客户通知文案

```text
【香蕉 GPT 客户端更新通知】

最新客户端版本已发布：vX.Y.Z

下载地址：
1. Windows 版本
https://m.aittco.com/downloads/win/

2. Mac 版本
https://m.aittco.com/downloads/mac/

本次版本包含功能升级与稳定性优化，建议所有用户尽快更新到最新版本。
如在安装、登录或使用过程中遇到异常，请及时联系并提供截图，我们会第一时间协助处理。
```

### 3.2 对外固定信息

- Web 地址：`https://m.aittco.com`
- Windows 下载页：`https://m.aittco.com/downloads/win/`
- Mac 下载页：`https://m.aittco.com/downloads/mac/`
- 当前版本号：`vX.Y.Z`

---

## 4. 安装包信息

### 4.1 文件名

- Windows：`banana-gpt-windows-X.Y.Z.exe`
- macOS Apple 芯片：`banana-gpt-macos-arm64-X.Y.Z.dmg`
- macOS Intel：`banana-gpt-macos-x64-X.Y.Z.dmg`

### 4.2 静态目录

- 站点静态目录：`/www/wwwroot/m.aittco.com`
- 统一下载中心：`/www/wwwroot/m.aittco.com/downloads/index.html`
- Windows 页面目录：`/www/wwwroot/m.aittco.com/download/win/`
- Mac 页面目录：`/www/wwwroot/m.aittco.com/download/mac/`

### 4.3 下载页检查

- [ ] `https://m.aittco.com/downloads/` 可以打开
- [ ] `https://m.aittco.com/downloads/win/` 可以打开
- [ ] `https://m.aittco.com/downloads/mac/` 可以打开
- [ ] Windows 下载链接指向正确的 `.exe`
- [ ] Mac Apple 芯片下载链接指向正确的 `arm64.dmg`
- [ ] Mac Intel 下载链接指向正确的 `x64.dmg`

### 4.4 Nginx 下载目录配置

当服务器上的真实目录结构为：

- `/www/wwwroot/m.aittco.com/downloads/index.html`
- `/www/wwwroot/m.aittco.com/downloads/win/index.html`
- `/www/wwwroot/m.aittco.com/downloads/mac/index.html`

并且安装包文件也都放在 `downloads/` 目录树下时，站点 `m.aittco.com` 建议使用下面这段 Nginx 配置：

```nginx
location = /downloads {
    return 301 /downloads/;
}

location ^~ /downloads/ {
    root /www/wwwroot/m.aittco.com;
    index index.html;
    autoindex off;
    try_files $uri $uri/ =404;
}
```

这套配置适用于：

- `https://m.aittco.com/downloads/`
- `https://m.aittco.com/downloads/win/`
- `https://m.aittco.com/downloads/mac/`

注意：

- 统一下载中心与 Win/Mac 分页统一使用 `downloads/` 目录，不要再混用 `download/` 与 `downloads/`
- 如果已经改成这套真实目录映射方式，就不需要再为 `/downloads/win/` 和 `/downloads/mac/` 单独写 `alias`

---

## 5. 部署信息

### 5.1 服务器信息

- 项目目录：`/opt/banana-gpt-exe`
- 容器名称：`gpt-image-playground`
- 镜像标签：`banana-gpt:X.Y.Z`

### 5.2 部署命令

```bash
cd /opt/banana-gpt-exe
git pull origin main
docker build -t banana-gpt:X.Y.Z .
docker stop gpt-image-playground
docker rm gpt-image-playground
docker run -d \
  --name gpt-image-playground \
  -p 8080:80 \
  -e DEFAULT_API_URL=https://vip.aittco.com/v1 \
  -e ENABLE_API_PROXY=true \
  -e LOCK_API_PROXY=true \
  -e API_PROXY_URL=https://vip.aittco.com/v1 \
  banana-gpt:X.Y.Z
docker ps
docker logs --tail=200 gpt-image-playground
```

### 5.3 部署后验证

- [ ] 容器启动成功
- [ ] Web 页面可正常打开
- [ ] 图片生成功能正常
- [ ] Agent 功能正常
- [ ] 额度查询正常
- [ ] 下载页可正常访问

---

## 6. 回滚信息

### 6.1 回滚条件

- `填写需要回滚的触发条件；如无可写“严重故障时回滚到上一版本”`

### 6.2 回滚命令

```bash
docker stop gpt-image-playground
docker rm gpt-image-playground
docker run -d \
  --name gpt-image-playground \
  -p 8080:80 \
  -e DEFAULT_API_URL=https://vip.aittco.com/v1 \
  -e ENABLE_API_PROXY=true \
  -e LOCK_API_PROXY=true \
  -e API_PROXY_URL=https://vip.aittco.com/v1 \
  banana-gpt:上一版本号
docker ps
docker logs --tail=200 gpt-image-playground
```

---

## 7. 发布检查清单

### 7.1 发布前

- [ ] 代码已合并到 `main`
- [ ] 版本号已更新
- [ ] 本地构建通过
- [ ] 安装包已生成
- [ ] 下载页链接已更新

### 7.2 发布后

- [ ] 服务器已更新到目标版本
- [ ] 客户下载链接可用
- [ ] Windows 安装包可下载
- [ ] Mac 安装包可下载
- [ ] 核心功能抽查完成

---

## 8. 本次发布记录

### 8.1 实际执行记录

- 发布时间：`填写实际时间`
- 执行人：`填写姓名`
- 执行结果：`成功 / 失败`

### 8.2 备注

- `填写补充说明`
