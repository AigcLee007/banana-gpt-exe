import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_UPLOAD_BYTES = 51 * 1024 * 1024

function fail(res: ServerResponse, status: number, message: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify({ success: false, error: message }))
}

async function proxyUpload(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') { fail(res, 405, '素材上传仅支持 POST'); return }
  const contentType = req.headers['content-type'] ?? ''
  if (!/^multipart\/form-data;.*\bboundary=/i.test(contentType)) { fail(res, 400, '请选择素材文件上传'); return }
  const length = Number(req.headers['content-length'])
  if (length > MAX_UPLOAD_BYTES) { req.resume(); fail(res, 413, '单次素材上传不能超过 51 MB'); return }
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_UPLOAD_BYTES) { fail(res, 413, '单次素材上传不能超过 51 MB'); return }
    chunks.push(buffer)
  }
  const upstream = await fetch('https://uguu.se/upload', {
    method: 'POST', headers: { 'Content-Type': contentType }, body: Buffer.concat(chunks),
    signal: AbortSignal.timeout(120000), redirect: 'error',
  })
  // Only the upload JSON is returned; cookies and provider headers stay out of the client response.
  res.statusCode = upstream.status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(await upstream.text())
}

export function uguuUploadMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (req.url?.split('?')[0] !== '/media-upload/uguu') { next(); return }
  void proxyUpload(req, res).catch(() => {
    if (!res.headersSent) fail(res, 502, '素材上传服务暂时不可用，请稍后重试')
    else res.end()
  })
}
