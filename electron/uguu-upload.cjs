const MAX_UPLOAD_BYTES = 51 * 1024 * 1024

function failure(status, message) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

async function handleUguuUpload(request, upstreamFetch) {
  if (request.method !== 'POST') return failure(405, '素材上传仅支持 POST')
  const contentType = request.headers.get('Content-Type') || ''
  if (!/^multipart\/form-data;.*\bboundary=/i.test(contentType)) return failure(400, '请选择素材文件上传')
  if (Number(request.headers.get('Content-Length')) > MAX_UPLOAD_BYTES) return failure(413, '单次素材上传不能超过 51 MB')
  try {
    const chunks = []
    let length = 0
    const reader = request.body?.getReader()
    if (!reader) return failure(400, '请选择素材文件上传')
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_UPLOAD_BYTES) { await reader.cancel(); return failure(413, '单次素材上传不能超过 51 MB') }
      chunks.push(Buffer.from(value))
    }
    const upstream = await upstreamFetch('https://uguu.se/upload', {
      method: 'POST', headers: { 'Content-Type': contentType }, body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(120000), redirect: 'error', credentials: 'omit',
    })
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  } catch { return failure(502, '素材上传服务暂时不可用，请稍后重试') }
}

module.exports = { handleUguuUpload }
