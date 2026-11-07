import { useEffect, useState } from 'react'
import { DEFAULT_PARAMS, type ApiProfile, type TaskParams } from '../types'
import { getParamDisabledReasons } from '../lib/paramCompatibility'
import { isVectorOrAnimatedFormat, supportsGptImage26Params } from '../lib/imageModels'

interface Props {
  profile: ApiProfile
  params: TaskParams
  onChange: (patch: Partial<TaskParams>) => void
  agent?: boolean
  hasInputImages?: boolean
}

const controlClass = 'min-w-0 w-full rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-xs text-gray-700 shadow-sm outline-none focus:border-blue-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200'

function GifNumberInput({ label, value, min, max, fallback, onChange }: {
  label: string
  value: number
  min: number
  max: number
  fallback: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value ?? fallback))
  useEffect(() => setDraft(String(value ?? fallback)), [value, fallback])
  const commit = (text: string) => {
    const numeric = text.trim() ? Number(text) : fallback
    const next = Number.isFinite(numeric) ? Math.max(min, Math.min(max, Math.round(numeric))) : fallback
    setDraft(String(next))
    onChange(next)
  }
  return (
    <input
      aria-label={label}
      type="number"
      min={min} max={max} step={1}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}
      className={controlClass}
    />
  )
}

export default function ImageOutputOptions({ profile, params, onChange, agent = false, hasInputImages = false }: Props) {
  if (!supportsGptImage26Params(profile)) return null
  const disabled = getParamDisabledReasons(profile, { agent, hasInputImages })
  const outputFormat = params.output_format ?? DEFAULT_PARAMS.output_format
  return (
    <div className="col-span-full grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" data-param="output-options">
      <label className="flex min-w-0 flex-col gap-0.5">
        <span className="ml-1 text-gray-400 dark:text-gray-500">格式</span>
        <select
          aria-label="输出格式"
          value={outputFormat}
          onChange={(event) => {
            const format = event.target.value as TaskParams['output_format']
            if ((format === 'svg' && disabled.svg) || (format === 'gif' && disabled.gif)) return
            onChange({ output_format: format, output_compression: null, ...(format === 'jpeg' ? { transparent_output: false } : {}) })
          }}
          className={controlClass}
        >
          {(['png', 'jpeg', 'webp', 'svg', 'gif'] as const).map((format) => {
            const reason = format === 'svg' ? disabled.svg : format === 'gif' ? disabled.gif : undefined
            return <option key={format} value={format} disabled={Boolean(reason)} title={reason}>{format.toUpperCase()}{reason ? ` · ${reason}` : ''}</option>
          })}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-0.5" title={disabled.complexity}>
        <span className="ml-1 text-gray-400 dark:text-gray-500">复杂度</span>
        <select
          aria-label="复杂度"
          disabled={Boolean(disabled.complexity)}
          value={params.complexity ?? DEFAULT_PARAMS.complexity}
          onChange={(event) => onChange({ complexity: event.target.value as TaskParams['complexity'] })}
          className={controlClass}
        >
          {['auto', 'low', 'medium', 'high'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      {outputFormat === 'gif' && !disabled.gif && <>
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="ml-1 text-gray-400 dark:text-gray-500">GIF 帧数</span>
          <GifNumberInput label="GIF 帧数" value={params.frame_count} min={2} max={16} fallback={DEFAULT_PARAMS.frame_count} onChange={(frame_count) => onChange({ frame_count })} />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="ml-1 text-gray-400 dark:text-gray-500">每帧时长 (ms)</span>
          <GifNumberInput label="GIF 每帧时长（毫秒）" value={params.frame_duration_ms} min={20} max={2000} fallback={DEFAULT_PARAMS.frame_duration_ms} onChange={(frame_duration_ms) => onChange({ frame_duration_ms })} />
        </label>
      </>}
      {(disabled.complexity || isVectorOrAnimatedFormat(outputFormat)) && (
        <p className="col-span-full ml-1 text-[10px] leading-relaxed text-gray-400 dark:text-gray-500">
          {disabled.complexity || (outputFormat === 'svg' ? 'SVG 仅支持文生图，使用 API 配置中的 SVG 模型；生成时关闭中间图流式传输。' : 'GIF 生成时关闭中间图流式传输。')}
        </p>
      )}
    </div>
  )
}
