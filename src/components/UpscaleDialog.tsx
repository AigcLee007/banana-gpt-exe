import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, ensureImageCached, createInputImageFromFile, submitUpscaleTask } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { getImageDimensions } from '../lib/canvasImage'
import {
  UPSCALE_MAX_INPUT_BYTES,
  UPSCALE_MODELS,
  getUpscaleModel,
  normalizeUpscaleParams,
  type UpscaleFormat,
  type UpscaleModelId,
} from '../lib/upscaleApi'
import { CloseIcon, PhotoIcon } from './icons'

/** 标准高清的预估价：按输出百万像素，0.03 元 / 百万像素，向上取整到 0.01 百万像素。 */
export function estimateStandardPrice(width: number, height: number, factor: number): { megapixels: number; yuan: number } {
  const raw = (width * factor * height * factor) / 1_000_000
  const megapixels = Math.ceil(raw * 100) / 100
  return { megapixels, yuan: Math.round(megapixels * 0.03 * 10000) / 10000 }
}

function formatYuan(value: number): string {
  return value < 0.01 ? value.toFixed(4) : value.toFixed(2)
}

export default function UpscaleDialog() {
  const dialog = useStore((s) => s.upscaleDialog)
  const setDialog = useStore((s) => s.setUpscaleDialog)
  const showToast = useStore((s) => s.showToast)
  const close = () => setDialog(null)

  const [imageId, setImageId] = useState<string | null>(null)
  const [preview, setPreview] = useState('')
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [model, setModel] = useState<UpscaleModelId>('upscale-standard')
  const [factor, setFactor] = useState(2)
  const [format, setFormat] = useState<UpscaleFormat | null>('jpg')
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useCloseOnEscape(Boolean(dialog), close)
  usePreventBackgroundScroll(Boolean(dialog))

  // 每次打开都从预选图片重新开始
  useEffect(() => {
    if (!dialog) return
    setImageId(dialog.imageId)
    setModel('upscale-standard')
    setFactor(2)
    setFormat('jpg')
    setBusy(false)
  }, [dialog])

  useEffect(() => {
    let cancelled = false
    setPreview('')
    setSize(null)
    if (!imageId) return
    void (async () => {
      const dataUrl = await ensureImageCached(imageId)
      if (cancelled || !dataUrl) return
      setPreview(dataUrl)
      try {
        const dimensions = await getImageDimensions(dataUrl)
        if (!cancelled) setSize(dimensions)
      } catch {
        /* 取不到尺寸只是不显示预估价，不影响放大 */
      }
    })()
    return () => { cancelled = true }
  }, [imageId])

  const option = getUpscaleModel(model) ?? UPSCALE_MODELS[0]

  const choose = (next: UpscaleModelId) => {
    const normalized = normalizeUpscaleParams({ model: next, factor, format })
    setModel(normalized.model)
    setFactor(normalized.factor)
    setFormat(normalized.format)
  }

  const estimate = useMemo(() => {
    if (!size) return null
    if (model === 'upscale-creative') return { text: '0.70 元 / 张', detail: `固定放大 2 倍，输出 ${size.width * 2} × ${size.height * 2}` }
    const price = estimateStandardPrice(size.width, size.height, factor)
    return {
      text: `约 ${formatYuan(price.yuan)} 元`,
      detail: `输出约 ${size.width * factor} × ${size.height * factor}（${price.megapixels.toFixed(2)} 百万像素）`,
    }
  }, [size, model, factor])

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', 'error')
      return
    }
    if (file.size > UPSCALE_MAX_INPUT_BYTES) {
      showToast('图片超过 30MB，请压缩后再放大', 'error')
      return
    }
    const image = await createInputImageFromFile(file)
    if (image) setImageId(image.id)
  }

  const submit = async () => {
    if (!imageId || busy) return
    setBusy(true)
    const taskId = await submitUpscaleTask({ imageId, params: { model, factor, format } })
    setBusy(false)
    if (taskId) close()
  }

  if (!dialog) return null

  return (
    <div data-no-drag-select className="fixed inset-0 z-[110] flex items-center justify-center p-4" onClick={close}>
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="高清放大"
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/90 shadow-[0_8px_40px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl animate-confirm-in dark:border-white/[0.08] dark:bg-gray-900/90 dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">高清放大</h3>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 pb-2">
          <section>
            <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">要放大的图片</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                void pickFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {preview ? (
              <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50/70 p-2.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <img src={preview} alt="待放大的图片" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium text-gray-700 dark:text-gray-200">
                    {size ? `${size.width} × ${size.height}` : '读取尺寸中…'}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    换一张
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 px-4 py-8 text-center transition hover:border-blue-400 hover:bg-blue-50/50 dark:border-white/15 dark:bg-white/[0.03] dark:hover:border-blue-400/60"
              >
                <PhotoIcon className="h-8 w-8 text-gray-400" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">选择一张图片</span>
                <span className="text-xs text-gray-400">PNG、JPG、WebP，30MB 以内</span>
              </button>
            )}
          </section>

          <section>
            <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">放大方式</div>
            <div role="radiogroup" aria-label="放大方式" className="space-y-2">
              {UPSCALE_MODELS.map((item) => {
                const selected = item.id === model
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => choose(item.id)}
                    className={`flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${
                      selected
                        ? 'border-blue-500 bg-blue-50/70 ring-1 ring-blue-500/30 dark:border-blue-400 dark:bg-blue-500/10'
                        : 'border-gray-200 hover:border-blue-300 dark:border-white/[0.08] dark:hover:border-blue-400/50'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${selected ? 'border-blue-500' : 'border-gray-300 dark:border-white/30'}`}
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-800 dark:text-gray-100">{item.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">{item.description}</span>
                      <span className="mt-1 block text-xs font-medium text-blue-600 dark:text-blue-300">{item.priceText}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {option.factors.length > 1 && (
            <section>
              <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">放大倍数</div>
              <div role="radiogroup" aria-label="放大倍数" className="flex flex-wrap gap-2">
                {option.factors.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={value === factor}
                    onClick={() => setFactor(value)}
                    className={`min-w-[3.25rem] rounded-full border px-3.5 py-1.5 text-sm transition ${
                      value === factor
                        ? 'border-blue-500 bg-blue-500 font-medium text-white'
                        : 'border-gray-200 text-gray-600 hover:border-blue-300 dark:border-white/[0.1] dark:text-gray-300'
                    }`}
                  >
                    {value === 1 ? '原尺寸增强' : `${value} 倍`}
                  </button>
                ))}
              </div>
            </section>
          )}

          {option.formats.length > 0 && (
            <section>
              <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">输出格式</div>
              <div role="radiogroup" aria-label="输出格式" className="flex flex-wrap gap-2">
                {option.formats.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={value === format}
                    onClick={() => setFormat(value)}
                    className={`min-w-[3.25rem] rounded-full border px-3.5 py-1.5 text-sm transition ${
                      value === format
                        ? 'border-blue-500 bg-blue-500 font-medium text-white'
                        : 'border-gray-200 text-gray-600 hover:border-blue-300 dark:border-white/[0.1] dark:text-gray-300'
                    }`}
                  >
                    {value === 'jpg' ? 'JPG' : value === 'png' ? 'PNG' : 'WebP'}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-gray-400">大图建议用 JPG 或 WebP，PNG 文件会很大。</p>
            </section>
          )}

          <section className="rounded-2xl border border-blue-200/70 bg-blue-50/60 px-4 py-3 dark:border-blue-400/20 dark:bg-blue-500/[0.07]">
            {estimate ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs leading-5 text-gray-500 dark:text-gray-400">{estimate.detail}</span>
                <span className="shrink-0 text-lg font-bold text-blue-600 dark:text-blue-300">{estimate.text}</span>
              </div>
            ) : (
              <span className="text-xs text-gray-500 dark:text-gray-400">选择图片后显示预估费用</span>
            )}
            {model === 'upscale-standard' && (
              <p className="mt-2 text-xs leading-5 text-gray-400">
                标准高清会先预扣 3 元，出图后按实际输出尺寸结算，多扣的部分自动退回；账单里会看到一条消耗和一条退款。预估价按输出尺寸估算，以实际结算为准。
              </p>
            )}
          </section>

          <p className="pb-1 text-xs leading-5 text-gray-400">放大结果会自动保存到本地历史，请不要依赖服务器上的临时地址。</p>
        </div>

        <div className="flex gap-2 px-6 pb-5 pt-3">
          <button
            type="button"
            onClick={close}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-600 transition hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.06]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!imageId || busy}
            onClick={() => void submit()}
            className="flex-1 rounded-lg bg-blue-500 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '提交中…' : '开始放大'}
          </button>
        </div>
      </div>
    </div>
  )
}
