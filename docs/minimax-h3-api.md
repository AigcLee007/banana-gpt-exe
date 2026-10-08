# MiniMax-H3 视频 API 接入文档

> 本接口由 New API 对外提供，底层通过 MiniMax-Meta 任务插件接入 MiniMax H3。
>
> 本文档适用于希望在自己的工具、工作流或 OpenAI 兼容客户端中调用 MiniMax-H3 的用户。

## 1. 接口信息

### 服务地址

将下面的地址替换成实际分配给你的 New API 地址：

```text
https://vip.aittco.com
```

### 鉴权

所有请求都需要携带 API Key：

```http
Authorization: Bearer sk-你的API密钥
Content-Type: application/json
```

### 模型名称

```text
MiniMax-H3
```

可以通过模型列表确认模型是否已对当前分组开放：

```bash
curl https://vip.aittco.com/v1/models \
  -H "Authorization: Bearer sk-你的API密钥"
```

返回的 `data` 中应包含：

```json
{
  "id": "MiniMax-H3"
}
```

## 2. 接口地址

| 功能 | 方法 | 地址 |
|---|---:|---|
| 创建视频任务 | `POST` | `/v1/videos` |
| 查询任务状态 | `GET` | `/v1/videos/{task_id}` |
| 下载视频成品 | `GET` | `/v1/videos/{task_id}/content` |

注意：任务完成后的状态查询不保证返回 `video_url`。客户端应在状态变成 `completed` 后，使用 `/content` 接口下载视频。

## 3. 支持的生成模式

### 文生视频

只提交文字提示词，不提交图片或其他参考素材。

### 图生视频

提交一张起始帧图片。视频会基于该图片继续生成。

### 首尾帧视频

提交两张图片：

- `first_frame`：起始帧
- `last_frame`：结束帧

### 多参考视频

可以同时提交图片、视频和音频参考素材：

- 图片：最多 9 张
- 视频：最多 3 个
- 音频：最多 3 个

不同分组的实际限制和计费，以服务端当前配置为准。

## 4. 文生视频

### 请求示例

```bash
curl -X POST "https://vip.aittco.com/v1/videos" \
  -H "Authorization: Bearer sk-你的API密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiniMax-H3",
    "prompt": "一只橘猫在窗台上伸懒腰，阳光从窗户照进来，镜头缓慢推进",
    "seconds": 4,
    "metadata": {
      "metaso_resolution": "768P",
      "metaso_ratio": "16:9"
    }
  }'
```

### 创建响应

```json
{
  "id": "task_xxxxxxxxxxxxxxxxx",
  "object": "video",
  "model": "MiniMax-H3",
  "status": "queued",
  "progress": 0,
  "created_at": 1790000000
}
```

请保存响应中的 `id`，后续查询和下载都需要使用它。

## 5. 图生视频：起始帧

图片可以作为 Base64 Data URL 放入 `metadata.metaso_content`。

```json
{
  "model": "MiniMax-H3",
  "prompt": "主体开始缓慢移动，镜头平稳推进",
  "seconds": 4,
  "metadata": {
    "metaso_resolution": "768P",
    "metaso_ratio": "16:9",
    "metaso_content": [
      {
        "type": "text",
        "text": "主体开始缓慢移动，镜头平稳推进"
      },
      {
        "type": "image_url",
        "role": "first_frame",
        "image_url": {
          "url": "data:image/png;base64,你的图片Base64内容"
        }
      }
    ]
  }
}
```

请求示例：

```bash
curl -X POST "https://vip.aittco.com/v1/videos" \
  -H "Authorization: Bearer sk-你的API密钥" \
  -H "Content-Type: application/json" \
  -d @request.json
```

其中 `request.json` 保存上面的 JSON 内容。

## 6. 首尾帧视频

```json
{
  "model": "MiniMax-H3",
  "prompt": "画面从第一张图片自然过渡到第二张图片，镜头保持稳定",
  "seconds": 4,
  "metadata": {
    "metaso_resolution": "768P",
    "metaso_ratio": "16:9",
    "metaso_content": [
      {
        "type": "text",
        "text": "画面从第一张图片自然过渡到第二张图片，镜头保持稳定"
      },
      {
        "type": "image_url",
        "role": "first_frame",
        "image_url": {
          "url": "data:image/png;base64,第一张图片Base64内容"
        }
      },
      {
        "type": "image_url",
        "role": "last_frame",
        "image_url": {
          "url": "data:image/png;base64,第二张图片Base64内容"
        }
      }
    ]
  }
}
```

关键要求：

- 必须同时提供 `first_frame` 和 `last_frame`；
- 两个图片内容应不同；
- 顺序不能颠倒；
- 不要只在提示词里写“从图片 A 变成图片 B”，必须把图片作为 `image_url` 内容提交。

## 7. 多参考：图片、视频、音频

多参考建议使用 `multipart/form-data`，不要把大型视频或音频直接编码成 JSON Base64。

### cURL 示例

```bash
curl -X POST "https://vip.aittco.com/v1/videos" \
  -H "Authorization: Bearer sk-你的API密钥" \
  -F "model=MiniMax-H3" \
  -F "prompt=参考所有素材，生成一段主体自然运动的视频" \
  -F "seconds=4" \
  -F 'metadata={"metaso_resolution":"768P","metaso_ratio":"16:9"}' \
  -F "reference_image=@./image-1.png" \
  -F "reference_image=@./image-2.jpg" \
  -F "reference_video=@./reference.mp4" \
  -F "reference_audio=@./reference.wav"
```

同一种字段可以重复提交：

```text
reference_image  图片参考，可重复
reference_video  视频参考，可重复
reference_audio  音频参考，可重复
```

使用 `multipart/form-data` 时，不要手动设置 `Content-Type`。让 HTTP 客户端自动生成 boundary。

### Python 示例

```python
import requests

BASE_URL = "https://vip.aittco.com"
API_KEY = "sk-你的API密钥"

headers = {
    "Authorization": f"Bearer {API_KEY}"
}

files = [
    ("reference_image", ("image-1.png", open("image-1.png", "rb"), "image/png")),
    ("reference_image", ("image-2.jpg", open("image-2.jpg", "rb"), "image/jpeg")),
    ("reference_video", ("reference.mp4", open("reference.mp4", "rb"), "video/mp4")),
    ("reference_audio", ("reference.wav", open("reference.wav", "rb"), "audio/wav")),
]

data = {
    "model": "MiniMax-H3",
    "prompt": "参考所有素材，生成一段主体自然运动的视频",
    "seconds": "4",
    "metadata": '{"metaso_resolution":"768P","metaso_ratio":"16:9"}',
}

response = requests.post(
    f"{BASE_URL}/v1/videos",
    headers=headers,
    data=data,
    files=files,
    timeout=120,
)

response.raise_for_status()
print(response.json())
```

## 8. 查询任务状态

创建任务后，使用返回的任务 ID查询：

```bash
curl "https://vip.aittco.com/v1/videos/task_xxxxxxxxxxxxxxxxx" \
  -H "Authorization: Bearer sk-你的API密钥"
```

### 排队中

```json
{
  "id": "task_xxxxxxxxxxxxxxxxx",
  "object": "video",
  "model": "MiniMax-H3",
  "status": "queued",
  "progress": 0,
  "created_at": 1790000000
}
```

### 生成中

```json
{
  "id": "task_xxxxxxxxxxxxxxxxx",
  "object": "video",
  "model": "MiniMax-H3",
  "status": "in_progress",
  "progress": 50,
  "created_at": 1790000000
}
```

### 已完成

```json
{
  "id": "task_xxxxxxxxxxxxxxxxx",
  "object": "video",
  "model": "MiniMax-H3",
  "status": "completed",
  "progress": 100,
  "created_at": 1790000000,
  "completed_at": 1790000060
}
```

注意：`completed` 响应可能不包含视频地址。不要等待 `video_url` 字段，直接调用视频下载接口。

### 失败

```json
{
  "id": "task_xxxxxxxxxxxxxxxxx",
  "object": "video",
  "model": "MiniMax-H3",
  "status": "failed",
  "progress": 0,
  "error": {
    "code": "video_generation_failed",
    "message": "视频生成失败原因"
  }
}
```

建议客户端每 10～20 秒查询一次，直到状态为 `completed` 或 `failed`。不要高频轮询。

## 9. 下载视频成品

```bash
curl -L \
  "https://vip.aittco.com/v1/videos/task_xxxxxxxxxxxxxxxxx/content" \
  -H "Authorization: Bearer sk-你的API密钥" \
  -o result.mp4
```

响应是二进制 MP4，不是 JSON：

```http
Content-Type: video/mp4
```

必须携带 API Key。不要直接在浏览器地址栏打开 `/content`，因为地址栏不会自动携带 Bearer 请求头。

## 10. JavaScript 示例

```javascript
const baseUrl = 'https://vip.aittco.com'
const apiKey = 'sk-你的API密钥'

const createResponse = await fetch(`${baseUrl}/v1/videos`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'MiniMax-H3',
    prompt: '一只猫在窗台上伸懒腰，镜头缓慢推进',
    seconds: 4,
    metadata: {
      metaso_resolution: '768P',
      metaso_ratio: '16:9',
    },
  }),
})

if (!createResponse.ok) {
  throw new Error(await createResponse.text())
}

const task = await createResponse.json()

let status
 do {
  await new Promise((resolve) => setTimeout(resolve, 10000))
  const response = await fetch(`${baseUrl}/v1/videos/${task.id}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })
  status = await response.json()
} while (status.status !== 'completed' && status.status !== 'failed')

if (status.status === 'failed') {
  throw new Error(status.error?.message || '视频生成失败')
}

const contentResponse = await fetch(`${baseUrl}/v1/videos/${task.id}/content`, {
  headers: { 'Authorization': `Bearer ${apiKey}` },
})

const videoBlob = await contentResponse.blob()
const videoUrl = URL.createObjectURL(videoBlob)
// 将 videoUrl 设置到 <video src={videoUrl}> 即可播放
```

## 11. OpenAI 兼容客户端配置

对于支持 OpenAI 视频接口的客户端，可以尝试配置：

```text
Base URL: https://vip.aittco.com/v1
API Key: 你的 sk- 密钥
Model: MiniMax-H3
```

注意：

- 如果客户端的 Base URL 已经包含 `/v1`，不要再填写 `https://vip.aittco.com/v1/v1`；
- 只支持标准文生视频字段的客户端通常可以直接使用文生视频；
- 图生、首尾帧、多参考建议使用本文的原始 HTTP 或 multipart 示例，因为不同客户端对媒体字段的支持方式不同。

## 12. 参数说明

### 基础参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `model` | string | 固定为 `MiniMax-H3` |
| `prompt` | string | 视频描述提示词 |
| `seconds` | integer | 视频时长，当前支持 4～15 秒的整数 |
| `metadata.metaso_resolution` | string | `768P` 或 `2K` |
| `metadata.metaso_ratio` | string | `adaptive`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16` 等 |

### 参考素材字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `reference_image` | file | multipart 图片参考，可重复 |
| `reference_video` | file | multipart 视频参考，可重复 |
| `reference_audio` | file | multipart 音频参考，可重复 |
| `metaso_content` | array | JSON 模式下的文本和图片内容 |

### 文件限制

单文件限制以当前插件配置为准，当前常用限制为：

- 图片：每个不超过约 30 MB；
- 视频：每个不超过约 50 MB；
- 音频：每个不超过约 15 MB。

## 13. 错误排查

### 401 Unauthorized

检查：

- 是否携带 `Authorization: Bearer ...`；
- API Key 是否有效；
- API Key 所属分组是否开放 `MiniMax-H3`。

### 400 参数错误

检查：

- `model` 是否为 `MiniMax-H3`；
- `seconds` 是否为 4～15 的整数；
- JSON 是否为合法格式；
- 首尾帧是否同时提供 `first_frame` 和 `last_frame`；
- multipart 字段是否使用 `reference_image`、`reference_video`、`reference_audio`。

### 404 任务不存在

检查 task ID 是否完整，是否误用了其他用户或其他 API Key 创建的任务 ID。

### 长时间 queued

视频生成是异步任务。建议：

- 每 10～20 秒查询一次；
- 客户端至少等待 20～30 分钟再判定超时；
- 不要重复提交同一个任务，避免重复计费。

## 14. 计费说明

视频价格由 New API 后台的模型定价、用户分组倍率和站点计费策略决定。客户端不需要提交价格字段。

通常计费因素包括：

- 输出视频时长；
- 输出分辨率；
- 超出免费数量的参考图片；
- 输入参考视频时长；
- 用户所在分组的倍率。

实际扣费以 New API 返回的使用记录和余额变化为准。

## 15. 重要注意事项

1. 不要把 API Key 写入前端公开网页或提交到 Git 仓库。
2. `/content` 下载接口需要 Bearer 鉴权。
3. 任务完成后建议立即下载，因为上游视频文件可能有保存期限。
4. 不要依赖状态查询中的 `video_url`，统一使用 `/content`。
5. UI 中的“图片1”“视频1”等标签是客户端展示概念，不等于 H3 官方提示词语法；API 调用应使用本文规定的 JSON/multipart 字段。
6. 当前 H3 任务插件不提供视频编辑和视频延长接口，客户端不要调用不存在的 `/edit` 或 `/extend` 路径。
