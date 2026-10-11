# 艾特智绘 MiniMax-H3 视频 API 接入文档

本文说明如何通过本站 API 使用 `MiniMax-H3` 进行文字生视频、图片生视频、首尾帧控制，以及图片、视频、音频的多素材参考生成。

## 1. 服务地址与鉴权

| 项目 | 值 |
| --- | --- |
| 服务地址 | `https://vip.aittco.com` |
| API 基础地址 | `https://vip.aittco.com/v1` |
| 模型名称 | `MiniMax-H3` |
| 鉴权方式 | `Authorization: Bearer 你的本站API密钥` |

创建、查询和下载都需携带本站 API Key。请确认密钥的模型权限包含 `MiniMax-H3`，所属分组可以使用该模型，账户有足够积分。

如果客户端要求填写“基础地址”，填写 `https://vip.aittco.com/v1`；自行拼接接口时不要重复添加 `/v1`。

## 2. 接口与调用流程

| 功能 | 方法 | 路径 |
| --- | --- | --- |
| 创建视频任务 | POST | `/v1/videos` |
| 查询任务状态 | GET | `/v1/videos/{task_id}` |
| 下载视频成品 | GET | `/v1/videos/{task_id}/content` |

1. 提交提示词、输出规格和可选参考素材。
2. 保存创建响应中的 `id`，作为后续查询、下载使用的 `task_id`。
3. 建议每 10–20 秒查询一次，直到状态为 `completed` 或 `failed`。
4. 返回 `completed` 后调用下载接口，保存 MP4 文件。

视频生成是异步任务，创建成功代表任务已接收。等待过程中请查询已有任务；再次调用创建接口会创建新的任务。

## 3. 输出规格与请求参数

### 3.1 分辨率与时长

| 分辨率 | `metadata.resolution` | 支持时长 |
| --- | --- | --- |
| 480P | `480P` | 4–30 秒 |
| 768P | `768P` | 4–30 秒 |
| 1080P | `1080P` | 4–15 秒 |
| 2K | `2K` | 4–15 秒 |

时长必须为整数秒。默认分辨率为 **768P**，默认时长为 **4 秒**。包含参考视频时，480P、768P 也可输出最长 30 秒；参考视频自身的合计输入时长仍不得超过 15 秒。

### 3.2 参数表

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 固定为 `MiniMax-H3`。 |
| `prompt` | string | 是* | 非空的视频提示词。 |
| `seconds` | integer | 否 | 输出时长，默认 4 秒；范围见第 3.1 节。 |
| `metadata` | object | 否 | 输出规格和参考素材。 |
| `metadata.resolution` | string | 否 | `480P`、`768P`、`1080P`、`2K`；默认 `768P`。 |
| `metadata.ratio` | string | 否 | `adaptive`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`；默认 `9:16`。 |
| `metadata.content` | array | 否 | 文本、首尾帧或多参考素材，结构见第 5 节。 |

*也可以在 `metadata.content` 中提供非空的 `text` 项，替代 `prompt`。若两处都提供文本，内容数组中的文本优先。建议使用 `prompt` 写提示词，内容数组仅放素材。

`adaptive` 表示自动画面比例。分辨率建议按表中的大小写填写。

`resolution`、`ratio`、`content` 也支持放在请求顶层；本文示例统一使用 `metadata`。同一参数在多个位置出现时，值应一致，否则请求会被拒绝。

每次创建请求生成一个视频。需要多个视频时，请分别创建任务并保存各自的 `id`。

## 4. 快速开始：文生视频

以下命令使用 Bash 语法。设置本站密钥：

```bash
export AITTCO_API_KEY='sk-你的本站API密钥'
```

将以下内容保存为 UTF-8 文件 `text-video.json`：

```json
{
  "model": "MiniMax-H3",
  "prompt": "海边日出，金色阳光照在平静海面，镜头缓慢向前推进，电影感画面，无文字",
  "seconds": 8,
  "metadata": {
    "resolution": "768P",
    "ratio": "16:9"
  }
}
```

提交请求：

```bash
curl --fail --show-error 'https://vip.aittco.com/v1/videos' \
  -H "Authorization: Bearer $AITTCO_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary '@text-video.json'
```

Windows PowerShell 使用：

```powershell
$env:AITTCO_API_KEY = 'sk-你的本站API密钥'
curl.exe --fail --show-error 'https://vip.aittco.com/v1/videos' `
  -H "Authorization: Bearer $env:AITTCO_API_KEY" `
  -H 'Content-Type: application/json' `
  --data-binary '@text-video.json'
```

创建响应示例，示例任务编号与时间戳仅用于说明：

```json
{
  "id": "task_xxxxxxxxxxxxxxxxx",
  "object": "video",
  "model": "MiniMax-H3",
  "status": "queued",
  "progress": 0,
  "created_at": 1791560000
}
```

## 5. 图片、视频与音频参考

### 5.1 提交方式

**参考素材不必使用 URL。**可以按以下方式提交：

| 方式 | 用法 |
| --- | --- |
| 公网素材直链 | 在 JSON 的内容数组中填写图片、视频或音频 URL。 |
| 图片 Base64 | 在图片 URL 字段填写完整 Data URL，例如 `data:image/png;base64,...`。 |
| 本地文件上传 | 使用 `multipart/form-data` 上传图片、视频或音频，无需先上传到图床。 |

视频、音频本地文件建议使用 multipart 上传。JSON 中的素材链接必须指向实际文件，不能是预览网页或网盘分享页面；应能从公网直接下载，无需登录 Cookie、额外鉴权请求头或验证码，并在排队、生成期间保持有效。

本地路径和浏览器 `blob:` 地址不能作为 JSON 素材 URL。需要本站 API Key 才能下载的 `/content` 地址也不能直接作为素材链接；请先下载，再通过 multipart 上传。

### 5.2 素材数量与大小

| 素材 | 数量上限 | 单文件大小上限 | 时长限制 |
| --- | --- | --- | --- |
| 图片 | 多参考模式最多 9 张 | 30 MB | — |
| 视频 | 最多 3 个 | 50 MB | 所有参考视频合计不超过 15 秒。 |
| 音频 | 最多 3 个 | 15 MB | 所有参考音频合计不超过 15 秒。 |

输出 30 秒不会增加素材数量或输入时长上限。首帧模式使用 1 张图片，首尾帧模式使用 2 张图片。

### 5.3 内容数组结构

| `type` | 内容字段 | `role` | 用途 |
| --- | --- | --- | --- |
| `text` | `text` | 不需要 | 文字提示。 |
| `image_url` | `image_url.url` | `first_frame` | 视频首帧。 |
| `image_url` | `image_url.url` | `last_frame` | 视频尾帧，与首帧搭配。 |
| `image_url` | `image_url.url` | `reference_image` | 多参考图片。 |
| `video_url` | `video_url.url` | `reference_video` | 参考视频。 |
| `audio_url` | `audio_url.url` | `reference_audio` | 参考音频。 |

示例中的 `https://example.com/...` 只是占位地址，请替换为实际素材。

### 5.4 单图生视频

将以下 JSON 保存为 `image-video.json`，使用第 4 节的提交命令，将文件名改为 `image-video.json`。

```json
{
  "model": "MiniMax-H3",
  "prompt": "保持图片中人物的外貌和服装一致，人物缓慢转头并微笑，镜头平稳",
  "seconds": 8,
  "metadata": {
    "resolution": "768P",
    "ratio": "9:16",
    "content": [
      {
        "type": "image_url",
        "role": "first_frame",
        "image_url": {"url": "https://example.com/person.png"}
      }
    ]
  }
}
```

使用 Base64 图片时，仅将 `image_url.url` 替换为实际的完整 Data URL：

```json
{
  "type": "image_url",
  "role": "first_frame",
  "image_url": {"url": "data:image/png;base64,这里填写图片的Base64内容"}
}
```

### 5.5 首尾帧控制

```json
{
  "model": "MiniMax-H3",
  "prompt": "从第一张画面自然过渡到第二张画面，保持主体一致，镜头缓慢移动",
  "seconds": 8,
  "metadata": {
    "resolution": "1080P",
    "ratio": "16:9",
    "content": [
      {"type": "image_url", "role": "first_frame", "image_url": {"url": "https://example.com/start.png"}},
      {"type": "image_url", "role": "last_frame", "image_url": {"url": "https://example.com/end.png"}}
    ]
  }
}
```

### 5.6 图片、视频、音频混合参考

```json
{
  "model": "MiniMax-H3",
  "prompt": "参考图片中的人物外观、视频中的镜头运动和音频节奏，生成新的花园场景",
  "seconds": 16,
  "metadata": {
    "resolution": "480P",
    "ratio": "16:9",
    "content": [
      {"type": "image_url", "role": "reference_image", "image_url": {"url": "https://example.com/person.png"}},
      {"type": "video_url", "role": "reference_video", "video_url": {"url": "https://example.com/motion.mp4"}},
      {"type": "audio_url", "role": "reference_audio", "audio_url": {"url": "https://example.com/voice.mp3"}}
    ]
  }
}
```

可以只提供所需素材。多份同类素材按顺序添加到数组；提示词可用“第一张参考图”“参考视频中的动作”等自然语言描述。

### 5.7 本地文件直接上传

下面使用 Bash 命令上传本地文件：

```bash
curl --fail --show-error 'https://vip.aittco.com/v1/videos' \
  -H "Authorization: Bearer $AITTCO_API_KEY" \
  -F 'model=MiniMax-H3' \
  -F 'prompt=参考人物外观、镜头运动和声音，生成新的花园场景' \
  -F 'seconds=8' \
  -F 'metadata={"resolution":"768P","ratio":"16:9"}' \
  -F 'reference_image=@person.png' \
  -F 'reference_video=@motion.mp4' \
  -F 'reference_audio=@voice.mp3'
```

| 上传字段 | 含义 |
| --- | --- |
| `reference_image` | 参考图片文件。 |
| `reference_video` | 参考视频文件。 |
| `reference_audio` | 参考音频文件。 |

多份同类素材重复提交同名文件字段，例如两次 `-F 'reference_image=@...'`。删除不需要的素材字段即可只上传图片或视频。文本字段 `model`、`prompt`、`seconds`、`metadata` 每个只提交一次。

multipart 中 `metadata` 是 JSON 字符串。不要手动设置 `Content-Type`，由客户端生成包含 boundary 的请求头。需要首尾帧角色控制时，使用第 5.4、5.5 节的 JSON 方式。

## 6. 查询状态与下载

查询任务，将示例编号替换为创建响应中的 `id`：

```bash
curl --fail --show-error 'https://vip.aittco.com/v1/videos/task_xxxxxxxxxxxxxxxxx' \
  -H "Authorization: Bearer $AITTCO_API_KEY"
```

| `status` | 含义 | 下一步 |
| --- | --- | --- |
| `queued` | 排队中。 | 稍后查询同一个任务。 |
| `in_progress` | 生成中。 | 稍后查询同一个任务。 |
| `completed` | 生成成功。 | 调用下载接口。 |
| `failed` | 生成失败。 | 查看 `error`，检查输入后决定是否重新创建。 |
| `unknown` 或其他值 | 状态暂时无法确认。 | 保留任务编号并稍后查询。 |

成功响应示例：

```json
{
  "id": "task_xxxxxxxxxxxxxxxxx",
  "object": "video",
  "model": "MiniMax-H3",
  "status": "completed",
  "progress": 100,
  "created_at": 1791560000
}
```

下载视频：

```bash
curl --fail --show-error 'https://vip.aittco.com/v1/videos/task_xxxxxxxxxxxxxxxxx/content' \
  -H "Authorization: Bearer $AITTCO_API_KEY" \
  -o result.mp4
```

查询响应不保证包含视频直链。使用 `id` 和本站下载接口获取成品即可。

任务生成失败时，查询响应中的 `error` 示例：

```json
{
  "code": "video_generation_failed",
  "message": "视频生成失败，请调整提示词或参考素材后重试。"
}
```

## 7. Python 完整调用示例

以下示例使用 Python 3.8 或以上版本的标准库，无需安装额外依赖。运行前设置环境变量 `AITTCO_API_KEY`，然后将代码保存为 `generate_h3.py`，执行 `python generate_h3.py`。

示例会创建一个 **768P、4 秒**的视频，轮询状态并下载至 `result.mp4`。创建视频按正常接口价格计费。

```python
import json
import os
import time
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE_URL = "https://vip.aittco.com/v1"
API_KEY = os.environ["AITTCO_API_KEY"]
HEADERS = {"Authorization": f"Bearer {API_KEY}"}


def request_json(path, payload=None):
    headers = dict(HEADERS)
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(BASE_URL + path, data=data, headers=headers)
    with urlopen(request, timeout=60) as response:
        return json.load(response)


created = request_json("/videos", {
    "model": "MiniMax-H3",
    "prompt": "一只橘猫走过阳光照亮的花园，镜头缓慢跟随",
    "seconds": 4,
    "metadata": {"resolution": "768P", "ratio": "16:9"},
})
task_id = created["id"]
print("任务编号：", task_id, flush=True)
task_path = "/videos/" + quote(task_id, safe="")
deadline = time.monotonic() + 1800

while True:
    task = request_json(task_path)
    status = task.get("status", "unknown")
    print("状态：", status, "进度：", task.get("progress"), flush=True)
    if status == "completed":
        break
    if status == "failed":
        raise RuntimeError(task.get("error") or "视频生成失败")
    if time.monotonic() >= deadline:
        raise TimeoutError(f"等待超时，请继续查询任务 {task_id}")
    time.sleep(10)

request = Request(BASE_URL + task_path + "/content", headers=HEADERS)
temporary = Path("result.mp4.part")
with urlopen(request, timeout=120) as response, temporary.open("wb") as output:
    while chunk := response.read(1024 * 1024):
        output.write(chunk)
temporary.replace("result.mp4")
print("视频已保存：result.mp4")
```

如果脚本在查询或下载阶段遇到网络异常，可以使用已经打印的任务编号继续查询或下载，无需重新创建视频。等待超时不会取消服务中的任务。

## 8. 积分价格

下表为单个视频、分组倍率 1× 的积分价格。实际扣费以账户分组和本站最终结算记录为准。

| 分辨率 | 输出时长 | 视频生成（积分/输出秒） | 参考视频（积分/输入秒） |
| --- | --- | --- | --- |
| 480P | 4–15 秒 | 1.5 | 1 |
| 480P | 16–30 秒 | 3 | 2 |
| 768P | 4–15 秒 | 2.5 | 1.25 |
| 768P | 16–30 秒 | 5 | 2.5 |
| 1080P | 4–15 秒 | 3.75 | 2.5 |
| 2K | 4–15 秒 | 5 | 2.5 |

| 参考素材 | 输出 4–15 秒 | 输出 16–30 秒 |
| --- | --- | --- |
| 图片前 5 张 | 免费 | 免费 |
| 第 6 张起的图片 | 每张 0.625 积分 | 每张 1.25 积分 |
| 音频 | 免费 | 免费 |

输出 16–30 秒时，整条任务的视频生成费、参考视频费和超额图片费全部翻倍；不是只对超过 15 秒的部分加价。上表已包含该倍率，计算时不要再乘 2。

计算公式：

```text
总积分 = 输出秒数 × 表中生成单价
       + 参考视频合计输入秒数 × 表中参考视频单价
       + max(参考图片总数 − 5, 0) × 表中超额图片单价
```

计算示例：

| 输出规格 | 素材 | 积分 |
| --- | --- | --- |
| 480P，30 秒 | 无参考素材 | `30 × 3 = 90` |
| 768P，4 秒 | 无参考素材 | `4 × 2.5 = 10` |
| 768P，20 秒 | 7 张图，参考视频合计 10 秒 | `20 × 5 + 10 × 2.5 + 2 × 1.25 = 127.5` |
| 1080P，15 秒 | 无参考素材 | `15 × 3.75 = 56.25` |
| 2K，15 秒 | 无参考素材 | `15 × 5 = 75` |

含参考视频的任务可能先按参考视频合计输入时长上限 **15 秒**预扣；任务完成并获得实际用量后再调整结算。预计积分、预扣积分与最终扣费可能不同，请查看最终结算记录；若实际用量尚未确认，可能保留预扣值，有疑问请联系本站客服。

## 9. Responses API（可选）

也可通过 `POST /v1/responses` 调用同一模型。将文字放在 `input`，输出规格放在 `seconds` 和 `metadata`；参考素材沿用第 5 节的内容数组。

```json
{
  "model": "MiniMax-H3",
  "input": "一只橘猫走过阳光照亮的花园",
  "seconds": 8,
  "metadata": {"resolution": "768P", "ratio": "16:9"},
  "stream": true
}
```

同步、流式和后台模式的具体可用性以本站当前配置为准。使用视频接口接入的客户端建议直接采用本文的 `/v1/videos` 创建、查询、下载流程。

## 10. 常见问题

| 情况 | 处理方法 |
| --- | --- |
| 提示模型不可用或无权限 | 核对模型名为 `MiniMax-H3`、密钥模型权限和账户分组。 |
| 参数校验失败 | 检查分辨率、整数秒数、比例及重复参数；1080P/2K 不支持 16 秒及以上。 |
| 素材无法读取 | 检查链接是否可直接下载、是否过期；本地素材可改用 multipart 上传。 |
| 等待时间较长 | 保存任务编号并继续查询，排队和生成时间随任务而变化。 |
| 下载失败 | 确认任务为 `completed`，使用原任务编号并携带本站 API Key。 |
| 工作台预计积分与预扣不同 | 含参考视频的任务可能按输入上限预扣，查看任务最终结算。 |

遇到无法解决的问题，请向本站客服提供任务编号、提交时间、输出规格及错误信息，无需提供 API Key。
