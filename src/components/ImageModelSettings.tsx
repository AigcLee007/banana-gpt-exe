import type { ApiProfile } from '../types'
import { DEFAULT_SVG_MODEL } from '../lib/imageModels'

interface Props {
  profile: ApiProfile
  onChange: (patch: Partial<ApiProfile>) => void
  onCommit: (patch: Partial<ApiProfile>) => void
}

const inputClass = 'w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50'

export default function ImageModelSettings({ profile, onChange, onCommit }: Props) {
  const isFal = profile.provider === 'fal'
  return <>
    {profile.provider === 'openai' && profile.apiMode === 'responses' && (
      <label className="block">
        <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">图像模型 ID</span>
        <input
          aria-label="图像模型 ID"
          type="text"
          value={profile.imageGenerationModel ?? ''}
          placeholder="gpt-image-2.6-sunburst-1k"
          onChange={(event) => onChange({ imageGenerationModel: event.target.value })}
          onBlur={(event) => onCommit({ imageGenerationModel: event.target.value.trim() })}
          className={inputClass}
        />
        <div data-selectable-text className="mt-1.5 text-xs text-gray-500">
          指定 Responses 图像工具使用的模型；留空使用服务商默认值。格式和复杂度选项仅在 GPT Image 2.6 的 1K动图线路提供，模型 ID 以 -1k 结尾。
        </div>
      </label>
    )}
    <label className="block">
      <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">SVG 模型 ID</span>
      <input
        aria-label="SVG 模型 ID"
        type="text"
        value={profile.svgModel ?? DEFAULT_SVG_MODEL}
        placeholder={DEFAULT_SVG_MODEL}
        disabled={isFal}
        onChange={(event) => onChange({ svgModel: event.target.value })}
        onBlur={(event) => onCommit({ svgModel: event.target.value.trim() || DEFAULT_SVG_MODEL })}
        className={inputClass}
      />
      <div data-selectable-text className="mt-1.5 text-xs text-gray-500">
        {isFal ? 'fal.ai 不支持 SVG 输出。' : `1K动图线路输出 SVG 时使用的文本模型，默认 ${DEFAULT_SVG_MODEL}；SVG 仅支持文生图。`}
      </div>
    </label>
  </>
}
