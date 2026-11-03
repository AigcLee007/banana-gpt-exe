import { describe, expect, it } from 'vitest'
import { createColorGradingRenderer, getPreviewDimensions, type ColorGradingWorkerPort } from './colorGradingRenderer'

class FakeWorker implements ColorGradingWorkerPort {
  onmessage: ColorGradingWorkerPort['onmessage'] = null
  onerror: ColorGradingWorkerPort['onerror'] = null
  messages: unknown[] = []
  terminated = false

  postMessage(message: unknown) {
    this.messages.push(message)
  }

  terminate() {
    this.terminated = true
  }

  respond(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

describe('color grading renderer', () => {
  it('keeps source dimensions for small images and caps preview dimensions without enlarging', () => {
    expect(getPreviewDimensions(320, 180, 1200)).toEqual({ width: 320, height: 180 })
    expect(getPreviewDimensions(6000, 4000, 1200)).toEqual({ width: 1200, height: 800 })
    expect(getPreviewDimensions(3840, 2160)).toEqual({ width: 1200, height: 675 })
  })

  it('rejects invalid source dimensions', () => {
    expect(() => getPreviewDimensions(0, 800)).toThrow('图片尺寸')
  })

  it('sends load, render, and full-resolution export requests through one worker', async () => {
    const worker = new FakeWorker()
    const renderer = createColorGradingRenderer(() => worker)
    const source = new Blob(['source'], { type: 'image/png' })
    const loaded = renderer.load(source)
    const loadMessage = worker.messages[0] as { id: number; type: string }
    expect(loadMessage.type).toBe('load')
    worker.respond({ id: loadMessage.id, type: 'loaded', width: 6000, height: 4000 })
    await expect(loaded).resolves.toEqual({ width: 6000, height: 4000 })

    const preview = renderer.renderPreview({} as never, 640)
    const renderMessage = worker.messages[1] as { id: number; type: string }
    expect(renderMessage).toMatchObject({ type: 'render', maxEdge: 640 })
    const bitmap = { close() {} } as ImageBitmap
    worker.respond({ id: renderMessage.id, type: 'rendered', bitmap, histogram: { red: [], green: [], blue: [], maxCount: 0 } })
    await expect(preview).resolves.toMatchObject({ bitmap })

    const exported = renderer.exportImage({} as never, 'image/png', 0.92)
    const exportMessage = worker.messages[2] as { id: number; type: string; width: number; height: number; mimeType: string }
    expect(exportMessage).toMatchObject({ type: 'export', width: 6000, height: 4000, mimeType: 'image/png' })
    const blob = new Blob(['edited'], { type: 'image/png' })
    worker.respond({ id: exportMessage.id, type: 'exported', blob })
    await expect(exported).resolves.toBe(blob)

    renderer.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('reports export progress and cancels an in-flight export', async () => {
    const worker = new FakeWorker()
    const renderer = createColorGradingRenderer(() => worker)
    const loaded = renderer.load(new Blob(['source'], { type: 'image/png' }))
    const loadMessage = worker.messages[0] as { id: number }
    worker.respond({ id: loadMessage.id, type: 'loaded', width: 800, height: 600 })
    await loaded

    const controller = new AbortController()
    const progress: number[] = []
    const exported = renderer.exportImage({} as never, 'image/webp', 0.8, (value) => progress.push(value), controller.signal)
    const exportMessage = worker.messages[1] as { id: number; type: string }
    worker.respond({ id: exportMessage.id, type: 'progress', progress: 0.5 })
    expect(progress).toEqual([0.5])

    controller.abort()
    await expect(exported).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.messages.some((message) => (message as { type: string }).type === 'cancel')).toBe(true)
    renderer.dispose()
  })
})
