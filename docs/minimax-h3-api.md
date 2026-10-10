# MiniMax-H3 视频 API

服务地址：`https://vip.aittco.com`。模型名称：`MiniMax-H3`。

请求使用本站 API 密钥鉴权：`Authorization: Bearer sk-你的API密钥`。

## 接口

| 功能 | 方法 | 路径 |
| --- | --- | --- |
| 创建视频 | POST | `/v1/videos` |
| 查询状态 | GET | `/v1/videos/{task_id}` |
| 下载视频 | GET | `/v1/videos/{task_id}/content` |

创建任务后保存返回的 `id`，轮询状态直至 `completed` 或 `failed`。成功后通过本站内容接口下载视频；状态响应不保证包含视频直链。

## 分辨率与时长

| `metadata.resolution` | 输出时长（整数秒） |
| --- | --- |
| `480P` | 4–30 |
| `768P` | 4–30 |
| `1080P` | 4–15 |
| `2K` | 4–15 |

默认分辨率为 `768P`，默认输出时长为 4 秒。1080P、2K 不支持超过 15 秒。

## 请求参数

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 固定为 `MiniMax-H3` |
| `prompt` | string | 视频提示词；也可在内容数组提供文本 |
| `seconds` | integer | 输出时长，根据分辨率取 4–15 或 4–30 |
| `metadata.resolution` | string | `480P`、`768P`、`1080P`、`2K` |
| `metadata.ratio` | string | `adaptive`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`；默认 `9:16` |
| `metadata.content` | array | 文本、首尾帧或多参考素材 |

`resolution`、`ratio`、`content` 也可放在请求顶层。同一参数不要在不同位置填写不同值。

## 文生视频

```bash
curl -X POST 'https://vip.aittco.com/v1/videos' \
  -H 'Authorization: Bearer sk-你的API密钥' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "MiniMax-H3",
    "prompt": "一只橘猫走过阳光照亮的花园，镜头缓慢跟随",
    "seconds": 20,
    "metadata": {"resolution": "768P", "ratio": "16:9"}
  }'
```

创建响应示例：

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

## 图生视频与首尾帧

图生视频使用一张 `first_frame` 图片；首尾帧同时提供 `first_frame` 和 `last_frame`。图片可使用公开 HTTPS 地址或 Base64 Data URL。

```json
{
  "model": "MiniMax-H3",
  "prompt": "从第一张画面自然过渡到第二张画面",
  "seconds": 8,
  "metadata": {
    "resolution": "1080P",
    "ratio": "16:9",
    "content": [
      {"type": "image_url", "role": "first_frame", "image_url": {"url": "https://your-media.example/start.png"}},
      {"type": "image_url", "role": "last_frame", "image_url": {"url": "https://your-media.example/end.png"}}
    ]
  }
}
```

## 多参考素材

支持图片最多 9 张、视频最多 3 个、音频最多 3 个。公开素材 URL 必须能被服务直接下载，无需登录、Cookie 或额外鉴权。也可通过 multipart 上传本地文件，无需先上传到图床。

30 秒输出不会放宽参考素材时长限制：参考视频合计不超过 15 秒，音频合计不超过 15 秒。

JSON 内容结构：

```json
{
  "model": "MiniMax-H3",
  "prompt": "参考人物外观和镜头运动，生成新的花园场景",
  "seconds": 16,
  "metadata": {
    "resolution": "480P",
    "ratio": "16:9",
    "content": [
      {"type": "image_url", "role": "reference_image", "image_url": {"url": "https://your-media.example/person.png"}},
      {"type": "video_url", "role": "reference_video", "video_url": {"url": "https://your-media.example/motion.mp4"}},
      {"type": "audio_url", "role": "reference_audio", "audio_url": {"url": "https://your-media.example/voice.mp3"}}
    ]
  }
}
```

multipart 上传示例：

```bash
curl -X POST 'https://vip.aittco.com/v1/videos' \
  -H 'Authorization: Bearer sk-你的API密钥' \
  -F 'model=MiniMax-H3' \
  -F 'prompt=参考人物外观和镜头运动，生成新的花园场景' \
  -F 'seconds=16' \
  -F 'metadata={"resolution":"480P","ratio":"16:9"}' \
  -F 'reference_image=@person.png' \
  -F 'reference_video=@motion.mp4' \
  -F 'reference_audio=@voice.mp3'
```

多份同类素材重复提交同名字段。图片文件每张不超过 30 MB、视频文件每个不超过 50 MB、音频文件每个不超过 15 MB。multipart 请求不要手动设置 `Content-Type`，由客户端生成 boundary。

## 查询与下载

```bash
curl 'https://vip.aittco.com/v1/videos/task_xxxxxxxxxxxxxxxxx' \
  -H 'Authorization: Bearer sk-你的API密钥'

curl 'https://vip.aittco.com/v1/videos/task_xxxxxxxxxxxxxxxxx/content' \
  -H 'Authorization: Bearer sk-你的API密钥' \
  -o result.mp4
```

状态：`queued` 等待、`in_progress` 生成中、`completed` 成功、`failed` 失败。其他状态应保留任务并稍后继续查询，不应当作生成成功。

## 积分价格

以下为单个视频、标准分组的积分价格，实际扣费以账户分组及结算记录为准。

| 分辨率 | 输出时长 | 生成（积分/输出秒） | 参考视频（积分/输入秒） |
| --- | --- | --- | --- |
| 480P | 4–15 秒 | 1.5 | 1 |
| 480P | 16–30 秒 | 3 | 2 |
| 768P | 4–15 秒 | 2.5 | 1.25 |
| 768P | 16–30 秒 | 5 | 2.5 |
| 1080P | 4–15 秒 | 3.75 | 2.5 |
| 2K | 4–15 秒 | 5 | 2.5 |

- 图片前 5 张免费；输出 4–15 秒时，第 6 张起每张 0.625 积分；输出 16–30 秒时，第 6 张起每张 1.25 积分。
- 音频免费；视频参考费按全部参考视频的合计输入时长计算。
- 16–30 秒整条任务的生成费、参考视频费和超额图片费均翻倍，不是只对超过 15 秒的部分加价。

例如 768P 输出 20 秒、参考视频合计 10 秒、参考图片 7 张：`20 × 5 + 10 × 2.5 + 2 × 1.25 = 127.5 积分`。

含参考视频的任务可能先按参考视频合计时长上限预扣，完成后按实际用量结算；预计积分与预扣金额可能不同，请查看最终结算记录。

## Responses 调用

也可通过 `POST /v1/responses` 调用相同模型，将文本放在 `input`，分辨率和画面比例放在 `metadata`：

```json
{
  "model": "MiniMax-H3",
  "input": "一只橘猫走过阳光照亮的花园",
  "seconds": 20,
  "metadata": {"resolution": "480P", "ratio": "16:9"},
  "stream": true
}
```

视频生成需要等待。Responses 同步、流式和后台模式的具体可用性以本站当前服务配置为准。
