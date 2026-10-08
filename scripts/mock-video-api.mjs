import http from 'node:http'
import { createHash } from 'node:crypto'

const port = Number(process.env.MOCK_VIDEO_API_PORT || 8788)
const host = process.env.MOCK_VIDEO_API_HOST || '127.0.0.1'
const expectedKey = process.env.MOCK_VIDEO_API_KEY || 'mock-key'
const tasks = new Map()

// 一个可被浏览器 <video> 识别为 MP4 的最小确定性内容；mock 只验证鉴权和生命周期。
const tinyMp4 = Buffer.from('00000018667479706d703432000000006d7034320000000866726565', 'hex')

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  res.end(payload)
}

function authorized(req) {
  return req.headers.authorization === `Bearer ${expectedKey}`
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function inspectRequest(body, contentType) {
  if (!contentType?.includes('application/json')) {
    console.log('[mock] multipart request received; raw media body bytes:', body.length)
    return { kind: 'multipart', imageCount: 0, roles: [] }
  }
  try {
    const payload = JSON.parse(body.toString('utf8'))
    const content = payload.metadata?.metaso_content || []
    const images = content.filter((item) => item?.type === 'image_url')
    const roles = images.map((item) => item.role)
    const frames = images.map((item) => {
      const url = item.image_url?.url
      if (typeof url !== 'string' || !/^data:image\/[^;]+;base64,/.test(url)) throw new Error('图片内容缺失')
      const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
      if (!bytes.length) throw new Error('图片内容为空')
      return { role: item.role, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    })
    const kind = roles.includes('last_frame') ? 'flf2v' : roles.includes('first_frame') ? 'i2v' : 't2v'
    console.log(`[mock] ${kind} received:`, JSON.stringify({ model: payload.model, seconds: payload.seconds, imageCount: images.length, roles, frames }))
    return { kind, imageCount: images.length, roles, frames, prompt: payload.prompt, hasN: Object.prototype.hasOwnProperty.call(payload, 'n') }
  } catch (error) {
    console.log('[mock] invalid JSON request:', error.message)
    return { kind: 'invalid', imageCount: 0, roles: [] }
  }
}

function taskView(task) {
  const elapsed = Date.now() - task.createdAt
  const status = elapsed < 300 ? 'queued' : elapsed < 900 ? 'in_progress' : 'completed'
  return {
    id: task.id,
    object: 'video',
    model: task.model,
    status,
    progress: status === 'queued' ? 0 : status === 'in_progress' ? 50 : 100,
    created_at: Math.floor(task.createdAt / 1000),
    ...(status === 'completed' ? { completed_at: Math.floor((task.createdAt + 900) / 1000) } : {}),
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    })
    res.end()
    return
  }

  if (!authorized(req)) {
    json(res, 401, { error: { message: 'mock authorization required' } })
    return
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  if (req.method === 'GET' && url.pathname === '/__audit') {
    json(res, 200, [...tasks.values()].map(({ id, requestInfo }) => ({ id, ...requestInfo })))
    return
  }
  const match = url.pathname.match(/^\/v1\/videos(?:\/([^/]+))?(\/content)?$/)
  if (!match) {
    json(res, 404, { error: { message: 'not found' } })
    return
  }

  const [, id, content] = match
  if (req.method === 'POST' && !id) {
    const body = await readBody(req)
    const taskId = `mock_${Date.now()}_${tasks.size + 1}`
    let model = 'MiniMax-H3'
    let requestInfo
    try {
      const parsed = JSON.parse(body.toString('utf8'))
      model = parsed.model || model
      requestInfo = inspectRequest(body, req.headers['content-type'])
    } catch {
      requestInfo = inspectRequest(body, req.headers['content-type'])
    }
    if (req.headers['content-type']?.startsWith('multipart/form-data')) {
      const form = await new Response(body, { headers: { 'Content-Type': req.headers['content-type'] } }).formData()
      model = String(form.get('model') || model)
      requestInfo = {
        kind: 'multipart', prompt: String(form.get('prompt') || ''),
        imageCount: form.getAll('reference_image').length,
        videoCount: form.getAll('reference_video').length,
        audioCount: form.getAll('reference_audio').length,
        hasInternalTokens: String(form.get('prompt') || '').includes('video-ref:'),
      }
      console.log('[mock] reference received:', JSON.stringify(requestInfo))
    }
    tasks.set(taskId, { id: taskId, model, createdAt: Date.now(), body, requestInfo })
    json(res, 200, { id: taskId, object: 'video', model, status: 'queued', progress: 0, created_at: Math.floor(Date.now() / 1000) })
    return
  }

  if (req.method === 'GET' && id) {
    const task = tasks.get(id)
    if (!task) {
      json(res, 404, { error: { message: 'task not found' } })
      return
    }
    if (content) {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': tinyMp4.length,
        'Access-Control-Allow-Origin': '*',
      })
      res.end(tinyMp4)
      return
    }
    json(res, 200, taskView(task))
    return
  }

  json(res, 405, { error: { message: 'method not allowed' } })
})

server.listen(port, host, () => {
  console.log(`mock video API listening on http://${host}:${port}`)
})
