#!/usr/bin/env node
// 视频接口探测：验证 New API 的 /v1/videos 上某个视频模型实际支持哪些输入方式。
// 默认只预览用例和预估费用，加 --yes 才会真正提交（会扣费）。
//
// PowerShell:
//   $env:VIDEO_API_KEY='sk-...'; node scripts/video-api-probe.mjs
//   $env:VIDEO_API_KEY='sk-...'; node scripts/video-api-probe.mjs --yes --cases t2v,flf2v
// 可选参数:
//   --base https://vip.aittco.com  --model MiniMax-H3  --seconds 4  --price 0.2（每秒单价，仅用于预估）
//   --image a.png  --image2 b.png  --video ref.mp4  --audio ref.mp3  --out .tmp-video-probe
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const args = parseArgs(process.argv.slice(2))
const BASE = String(args.base || process.env.VIDEO_API_BASE || 'https://vip.aittco.com').replace(/\/+$/, '')
const KEY = process.env.VIDEO_API_KEY || ''
const MODEL = String(args.model || 'MiniMax-H3')
const SECONDS = Number(args.seconds || 4)
const PRICE = Number(args.price || 0.2)
const OUT_DIR = path.resolve(String(args.out || '.tmp-video-probe'))
const POLL_MS = 10_000
const TIMEOUT_MS = 30 * 60_000
const ORIGIN = 'https://m.aittco.com'
const PROMPT = '画面中的主体缓慢移动，镜头平稳推进，光线柔和'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i++
    }
  }
  return out
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const parseJson = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return text.slice(0, 2000)
  }
}

// ---------- 测试素材：没传 --image 时生成渐变 PNG ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function gradientPng(width, height, from, to) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2
      for (let ch = 0; ch < 3; ch++) raw[row + 1 + x * 3 + ch] = Math.round(from[ch] + (to[ch] - from[ch]) * t)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' }
function loadMedia(file, fallback) {
  if (file && file !== true) {
    const buf = fs.readFileSync(file)
    const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
    return { name: path.basename(file), mime, buf, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
  }
  if (!fallback) return null
  return { ...fallback, dataUrl: `data:${fallback.mime};base64,${fallback.buf.toString('base64')}` }
}

// ---------- 用例 ----------
const imageA = loadMedia(args.image, { name: 'probe-a.png', mime: 'image/png', buf: gradientPng(1280, 720, [255, 140, 60], [40, 80, 200]) })
const imageB = loadMedia(args.image2, { name: 'probe-b.png', mime: 'image/png', buf: gradientPng(1280, 720, [30, 200, 120], [250, 230, 90]) })
const video = loadMedia(args.video, null)
const audio = loadMedia(args.audio, null)
const META = { metaso_resolution: '768P', metaso_ratio: '16:9' }

const blob = (media) => new Blob([media.buf], { type: media.mime })
const baseForm = (extraMeta = {}) => {
  const form = new FormData()
  form.append('model', MODEL)
  form.append('prompt', PROMPT)
  form.append('seconds', String(SECONDS))
  form.append('metadata', JSON.stringify({ ...META, ...extraMeta }))
  return form
}
const contentItem = (type, role, url) => ({ type, role, [type]: { url } })

// 每个用例：name、desc、kind（json/multipart）、build()、expectFail（预期被拒绝）、needs（缺素材时跳过）
const CASES = [
  {
    name: 't2v', desc: '纯文生视频（JSON）', kind: 'json',
    build: () => ({ model: MODEL, prompt: PROMPT, seconds: SECONDS, metadata: META }),
  },
  {
    name: 'i2v-dataurl', desc: '单图，metaso_content 里放 base64 dataURL（JSON）', kind: 'json',
    build: () => ({ model: MODEL, seconds: SECONDS, metadata: { ...META, metaso_content: [{ type: 'text', text: PROMPT }, contentItem('image_url', 'reference_image', imageA.dataUrl)] } }),
  },
  {
    name: 'i2v-input-reference', desc: '单图，OpenAI 风格 input_reference.image_url 放 dataURL（JSON）', kind: 'json',
    build: () => ({ model: MODEL, prompt: PROMPT, seconds: SECONDS, size: '1280x720', input_reference: { image_url: imageA.dataUrl } }),
  },
  {
    name: 'i2v-multipart', desc: '单图，multipart 上传 reference_image 文件', kind: 'multipart',
    build: () => { const f = baseForm(); f.append('reference_image', blob(imageA), imageA.name); return f },
  },
  {
    name: 'multi-image-multipart', desc: '两张参考图，multipart 重复 reference_image', kind: 'multipart',
    build: () => { const f = baseForm(); f.append('reference_image', blob(imageA), imageA.name); f.append('reference_image', blob(imageB), imageB.name); return f },
  },
  {
    name: 'flf2v', desc: '首尾帧：role=first_frame / last_frame（插件未声明，测试是否透传）', kind: 'json',
    build: () => ({ model: MODEL, seconds: SECONDS, metadata: { metaso_resolution: '768P', metaso_ratio: 'adaptive', metaso_content: [{ type: 'text', text: PROMPT }, contentItem('image_url', 'first_frame', imageA.dataUrl), contentItem('image_url', 'last_frame', imageB.dataUrl)] } }),
  },
  {
    name: 'i2v-first-frame-portrait', desc: '只传 first_frame，9:16、5 秒（验证比例和时长是否生效）', kind: 'json',
    build: () => ({ model: MODEL, seconds: 5, metadata: { metaso_resolution: '768P', metaso_ratio: '9:16', metaso_content: [{ type: 'text', text: PROMPT }, contentItem('image_url', 'first_frame', imageA.dataUrl)] } }),
  },
  {
    name: 'ref-7-images', desc: '7 张参考图（验证参考图上限，超过 5 张部分按张计费）', kind: 'multipart',
    build: () => { const f = baseForm(); for (let i = 0; i < 7; i++) { const m = i % 2 ? imageB : imageA; f.append('reference_image', blob(m), `ref-${i}.png`) } return f },
  },
  {
    name: 'ref-video-multipart', desc: '参考图 + 参考视频，multipart 上传 reference_video', kind: 'multipart', needs: 'video',
    build: () => { const f = baseForm(); f.append('reference_image', blob(imageA), imageA.name); f.append('reference_video', blob(video), video.name); return f },
  },
  {
    name: 'ref-audio-multipart', desc: '参考图 + 参考音频，multipart 上传 reference_audio', kind: 'multipart', needs: 'audio',
    build: () => { const f = baseForm(); f.append('reference_image', blob(imageA), imageA.name); f.append('reference_audio', blob(audio), audio.name); return f },
  },
  {
    name: 'invalid-seconds', desc: 'seconds=3（超出 4~15），看错误返回格式', kind: 'json', expectFail: true,
    build: () => ({ model: MODEL, prompt: PROMPT, seconds: 3, metadata: META }),
  },
]

// ---------- 请求 ----------
async function submit(testCase) {
  const headers = { Authorization: `Bearer ${KEY}` }
  const payload = testCase.build()
  let body
  if (testCase.kind === 'json') {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(payload)
  } else {
    body = payload // FormData，boundary 由 fetch 自动设置
  }
  const started = Date.now()
  const res = await fetch(`${BASE}/v1/videos`, { method: 'POST', headers, body })
  return { http: res.status, ms: Date.now() - started, body: parseJson(await res.text()) }
}

async function poll(id, log) {
  const started = Date.now()
  let last = ''
  while (Date.now() - started < TIMEOUT_MS) {
    const res = await fetch(`${BASE}/v1/videos/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${KEY}` } })
    const body = parseJson(await res.text())
    const status = typeof body === 'object' ? body.status : `http ${res.status}`
    const marker = `${status}:${typeof body === 'object' ? body.progress : ''}`
    if (marker !== last) {
      log.push({ t: Math.round((Date.now() - started) / 1000), http: res.status, status, progress: body?.progress })
      last = marker
    }
    if (status === 'completed' || status === 'failed' || res.status === 404) return body
    await sleep(POLL_MS)
  }
  return { status: 'probe_timeout' }
}

async function download(id, file) {
  const res = await fetch(`${BASE}/v1/videos/${encodeURIComponent(id)}/content`, { headers: { Authorization: `Bearer ${KEY}` } })
  const buf = Buffer.from(await res.arrayBuffer())
  if (res.ok) fs.writeFileSync(file, buf)
  return {
    http: res.status,
    redirected: res.redirected,
    finalHost: new URL(res.url).host,
    contentType: res.headers.get('content-type'),
    bytes: buf.length,
    isMp4: buf.subarray(4, 8).toString('latin1') === 'ftyp',
  }
}

// 前端直连时需要的跨域头
async function checkCors() {
  const result = {}
  for (const [label, url, method] of [['create', `${BASE}/v1/videos`, 'POST'], ['query', `${BASE}/v1/videos/probe`, 'GET']]) {
    try {
      const res = await fetch(url, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'authorization,content-type' } })
      result[label] = { http: res.status, allowOrigin: res.headers.get('access-control-allow-origin'), allowHeaders: res.headers.get('access-control-allow-headers') }
    } catch (error) {
      result[label] = { error: String(error.message || error) }
    }
  }
  return result
}

// ---------- 执行 ----------
async function runCase(testCase) {
  const record = { name: testCase.name, desc: testCase.desc, kind: testCase.kind, timeline: [] }
  try {
    record.submit = await submit(testCase)
    const id = record.submit.body?.id
    if (!id) {
      record.ok = Boolean(testCase.expectFail)
      return record
    }
    record.final = await poll(id, record.timeline)
    if (record.final?.status === 'completed') {
      record.content = await download(id, path.join(OUT_DIR, `${testCase.name}.mp4`))
    }
    record.ok = testCase.expectFail ? record.final?.status === 'failed' : Boolean(record.content?.isMp4)
  } catch (error) {
    record.error = String(error.message || error)
    record.ok = false
  }
  return record
}

async function runPool(items, limit, worker) {
  const results = []
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index])
      console.log(`${results[index].ok ? '✓' : '✗'} ${items[index].name}`)
    }
  })
  await Promise.all(lanes)
  return results
}

async function main() {
  const wanted = typeof args.cases === 'string' ? new Set(args.cases.split(',')) : null
  const selected = CASES.filter((c) => !wanted || wanted.has(c.name))
  const runnable = selected.filter((c) => !c.needs || (c.needs === 'video' ? video : audio))
  const skipped = selected.filter((c) => !runnable.includes(c))

  console.log(`目标: ${BASE}  模型: ${MODEL}  时长: ${SECONDS}s`)
  for (const c of runnable) console.log(`  · ${c.name.padEnd(22)} ${c.desc}`)
  for (const c of skipped) console.log(`  - ${c.name.padEnd(22)} 跳过：需要 --${c.needs} 文件`)
  const billable = runnable.filter((c) => !c.expectFail).length
  console.log(`预估费用: ${billable} 条 × ${SECONDS}s × ${PRICE}/s ≈ ${(billable * SECONDS * PRICE).toFixed(2)}（按站点额度单位）`)

  if (!args.yes) {
    console.log('\n这是预览。确认后加 --yes 真正提交。')
    return
  }
  if (!KEY) {
    console.error('缺少环境变量 VIDEO_API_KEY')
    process.exit(1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, imageA.name), imageA.buf)
  fs.writeFileSync(path.join(OUT_DIR, imageB.name), imageB.buf)

  const report = { base: BASE, model: MODEL, seconds: SECONDS, startedAt: new Date().toISOString() }
  report.cors = await checkCors()
  report.cases = await runPool(runnable, 2, runCase)
  report.skipped = skipped.map((c) => c.name)
  report.finishedAt = new Date().toISOString()

  const reportFile = path.join(OUT_DIR, 'report.json')
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
  console.log(`\n报告: ${reportFile}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
