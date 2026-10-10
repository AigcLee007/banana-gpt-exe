// H3 视频适配器

import type { VideoAdapter } from '../videoApi'
import type { VideoApiProfileSnapshot } from '../videoTypes'
import { getMedia } from '../videoDb'
import { serializeVideoPrompt, getFrameReferences } from '../videoPromptMentions'
import { buildVideoApiUrl } from '../videoTransport'

function apiUrl(profile: VideoApiProfileSnapshot, path: string) {
  return buildVideoApiUrl(profile, path)
}

function authHeaders(profile: VideoApiProfileSnapshot): Record<string, string> {
  if (!profile.apiKey.trim()) throw new Error('视频 API 配置缺少 API Key')
  return { Authorization: `Bearer ${profile.apiKey.trim()}` }
}

function normalizeRatio(value: string) {
  return value === 'auto' ? 'adaptive' : value
}

function normalizeResolution(value: string) {
  return value.toUpperCase()
}

export const h3Adapter: VideoAdapter = {
  async buildSubmit(request) {
    const { task } = request
    const { mode, params, inputs } = task
    const references = mode !== 'ref2v'
      ? getFrameReferences(inputs.firstFrameId, inputs.lastFrameId)
      : inputs.refItems ?? [
          ...inputs.refImageIds.map((id) => ({ id, type: 'image' as const })),
          ...inputs.refVideoIds.map((id) => ({ id, type: 'video' as const })),
          ...inputs.refAudioIds.map((id) => ({ id, type: 'audio' as const })),
        ]
    const prompt = serializeVideoPrompt(task.prompt, references)
    const { duration, resolution, aspectRatio } = params
    const profile = request.profile

    // Only the reference mode uses multipart. Hidden reference drafts must never drop frame roles.
    const needsMultipart = mode === 'ref2v'

    if (!needsMultipart) {
      // JSON 模式
      const url = apiUrl(profile, 'videos')
      const body: Record<string, unknown> = {
        model: task.model,
        prompt,
        seconds: duration,
        metadata: {
          resolution: normalizeResolution(resolution),
          ratio: normalizeRatio(aspectRatio),
        },
      }

      // H3 的单图、首尾帧均使用 metadata.content。
      const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
      if (mode === 'i2v') {
        const media = await requireMedia(inputs.firstFrameId)
        content.push({
          type: 'image_url',
          role: 'first_frame',
          image_url: { url: await blobToDataUrl(media.blob) },
        })
      }
      if (mode === 'flf2v') {
        const firstMedia = await requireMedia(inputs.firstFrameId)
        const lastMedia = await requireMedia(inputs.lastFrameId)
        content.push(
          { type: 'image_url', role: 'first_frame', image_url: { url: await blobToDataUrl(firstMedia.blob) } },
          { type: 'image_url', role: 'last_frame', image_url: { url: await blobToDataUrl(lastMedia.blob) } },
        )
      }
      if (mode === 'i2v' || mode === 'flf2v') {
        body.metadata = {
          resolution: normalizeResolution(resolution),
          ratio: normalizeRatio(aspectRatio),
          content,
        }
      }

      return {
        url,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders(profile),
          },
          body: JSON.stringify(body),
        },
      }
    } else {
      // Multipart 模式
      const url = apiUrl(profile, 'videos')
      const form = new FormData()

      form.append('model', task.model)
      form.append('prompt', prompt)
      form.append('seconds', String(duration))

      const metadata: Record<string, unknown> = {
        resolution: normalizeResolution(resolution),
        ratio: normalizeRatio(aspectRatio),
      }
      form.append('metadata', JSON.stringify(metadata))

      // 参考图片
      for (const imageId of inputs.refImageIds) {
        const media = await requireMedia(imageId)
        const file = new File([media.blob], `${imageId}.png`, { type: media.mime })
        form.append('reference_image', file)
      }

      // 参考视频
      for (const videoId of inputs.refVideoIds) {
        const media = await requireMedia(videoId)
        const file = new File([media.blob], `${videoId}.mp4`, { type: media.mime })
        form.append('reference_video', file)
      }

      // 参考音频
      for (const audioId of inputs.refAudioIds) {
        const media = await requireMedia(audioId)
        const file = new File([media.blob], `${audioId}.mp3`, { type: media.mime })
        form.append('reference_audio', file)
      }

      return {
        url,
        init: {
          method: 'POST',
          headers: authHeaders(profile),
          body: form,
        },
      }
    }
  },

  parseSubmit(res: unknown) {
    const data = res as Record<string, unknown>
    if (typeof data.id !== 'string' || !data.id) throw new Error('视频创建响应缺少任务 ID')
    const status = data.status as string
    return {
      taskId: data.id,
      status: status === 'queued' ? 'queued' : status === 'in_progress' ? 'running' : undefined,
    }
  },

  buildPoll(taskId: string, profile: VideoApiProfileSnapshot) {
    return {
      url: apiUrl(profile, `videos/${encodeURIComponent(taskId)}`),
      init: { method: 'GET', headers: authHeaders(profile) },
    }
  },

  parsePoll(res: unknown) {
    const data = res as Record<string, unknown>
    const status = data.status as string
    if (!['queued', 'in_progress', 'completed', 'failed'].includes(status)) {
      throw new Error(`视频查询返回未知状态: ${status || '空'}`)
    }
    return {
      status: status === 'completed' ? 'succeeded' : status === 'failed' ? 'failed' : status === 'in_progress' ? 'running' : 'queued',
      progress: typeof data.progress === 'number' ? data.progress : 0,
      error: typeof data.error === 'string' ? data.error : undefined,
    }
  },

  buildContent(taskId: string, profile: VideoApiProfileSnapshot) {
    return {
      url: apiUrl(profile, `videos/${encodeURIComponent(taskId)}/content`),
      init: { method: 'GET', headers: authHeaders(profile) },
    }
  },
}

async function requireMedia(id: string | undefined) {
  if (!id) throw new Error('当前模式缺少必要的参考素材')
  const media = await getMedia(id)
  if (!media) throw new Error(`找不到参考素材: ${id}`)
  return media
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
