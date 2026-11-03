import { useEffect, useMemo, useRef, useState } from 'react'
import { callAgentColorAssistantApi } from '../lib/agentApi'
import { AGENT_FIXED_MODEL } from '../lib/bananaModels'
import { applyColorAssistantProposal, getColorAssistantChangeLabel, type ColorAssistantProposal } from '../lib/colorAssistant'
import { createColorAssistantImagePayload } from '../lib/colorAssistantImage'
import { getActiveApiProfile, isOpenAICompatibleProvider, validateApiProfile } from '../lib/apiProfiles'
import { createColorAssistantHistoryRecord } from '../lib/colorAssistantHistory'
import { createLocalId } from '../lib/localId'
import { getColorAssistantHistory, putColorAssistantHistoryRecord, updateColorAssistantHistoryOutcome } from '../lib/db'
import { useStore } from '../store'
import type { ColorAdjustments } from '../lib/colorGrading'
import type { ColorAssistantHistoryOutcome, ColorAssistantHistoryRecord } from '../types'

export interface ColorAssistantPanelProps {
  imageId: string
  sourceImageId: string
  adjustments: ColorAdjustments
  previewUrl: string
  ready: boolean
  onApply: (adjustments: ColorAdjustments, baseAdjustments: ColorAdjustments, imageId: string) => boolean | void
}

interface Candidate {
  proposal: ColorAssistantProposal
  adjustments: ColorAdjustments
  baseAdjustments: ColorAdjustments
  baseKey: string
  imageId: string
  historyRecord: ColorAssistantHistoryRecord | null
}

const IMAGE_INPUT_ERROR = /(?:unsupported|not supported|does not support|not support).{0,60}(?:image|input_image|image_url)|(?:image|input_image|image_url).{0,60}(?:unsupported|not supported|does not support|not support)|(?:图片|图像).{0,20}(?:不支持|无法识别|不接受)|(?:不支持|无法识别|不接受).{0,20}(?:图片|图像)/i
const IMAGE_ANALYSIS_INSTRUCTION = '分析当前图片的整体色彩、白平衡、明暗、对比度与饱和度，结合当前调色参数判断是否存在明确的色彩问题。请先在 explanation 中用中文说明观察到的色彩状态；只在确有必要时提出少量、保守、针对性的参数调整，并尽量保持主体颜色自然。若图片色彩已经协调，请返回空的 changes 和 curves，说明无需调整。'

type RequestIntent = 'instruction' | 'analysis'

export default function ColorAssistantPanel({ imageId, sourceImageId, adjustments, previewUrl, ready, onApply }: ColorAssistantPanelProps) {
  const settings = useStore((state) => state.settings)
  const activeProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const agentProfile = useMemo(() => isOpenAICompatibleProvider(settings, activeProfile.provider)
    ? { ...activeProfile, provider: 'openai', model: AGENT_FIXED_MODEL, apiMode: 'responses' as const }
    : null, [activeProfile, settings])
  const profileError = agentProfile
    ? validateApiProfile(agentProfile)
    : '请在 API 配置中选择可用于 Agent 的 OpenAI 兼容配置。'
  const recipeKey = JSON.stringify(adjustments)
  const latestImageIdRef = useRef(imageId)
  const latestAdjustmentsRef = useRef(adjustments)
  const requestIdRef = useRef(0)
  const historyRevisionRef = useRef(0)
  const requestControllerRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const candidateRef = useRef<Candidate | null>(null)
  const [instruction, setInstruction] = useState('')
  const [isRequesting, setIsRequesting] = useState(false)
  const [error, setError] = useState('')
  const [retryTextOnly, setRetryTextOnly] = useState(false)
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [history, setHistory] = useState<ColorAssistantHistoryRecord[]>([])
  const [historyError, setHistoryError] = useState('')

  latestImageIdRef.current = imageId
  latestAdjustmentsRef.current = adjustments
  candidateRef.current = candidate

  const saveOutcome = async (record: ColorAssistantHistoryRecord | null, outcome: Exclude<ColorAssistantHistoryOutcome, 'pending'>) => {
    if (!record) return
    try {
      const updated = await updateColorAssistantHistoryOutcome(record.id, outcome)
      historyRevisionRef.current += 1
      setHistory((current) => sortHistory(current.some((item) => item.id === updated.id)
        ? current.map((item) => item.id === updated.id ? { ...item, ...updated } : item)
        : [updated, ...current]))
    } catch {
      const label = outcome === 'applied' ? '已应用' : outcome === 'discarded' ? '已放弃' : '已过期'
      setError(`建议${label}，但历史状态未能保存；请检查本地存储空间。`)
    }
  }

  const cancelRequest = () => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
    busyRef.current = false
    setIsRequesting(false)
  }

  useEffect(() => {
    cancelRequest()
    const previousCandidate = candidateRef.current
    if (previousCandidate && (previousCandidate.imageId !== imageId || previousCandidate.baseKey !== recipeKey)) {
      void saveOutcome(previousCandidate.historyRecord, 'expired')
    }
    candidateRef.current = null
    setCandidate(null)
    setError('')
    setRetryTextOnly(false)
  }, [imageId, sourceImageId, recipeKey])

  useEffect(() => {
    if (!sourceImageId) return
    let cancelled = false
    const revision = historyRevisionRef.current
    setHistory([])
    setHistoryError('')
    void getColorAssistantHistory(sourceImageId).then((records) => {
      if (!cancelled && revision === historyRevisionRef.current) setHistory(sortHistory(records))
    }).catch(() => {
      if (!cancelled) setHistoryError('无法读取调色建议历史，请检查本地存储后重试。')
    })
    return () => { cancelled = true }
  }, [sourceImageId])

  useEffect(() => () => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
  }, [])

  const submit = async (includeImage: boolean, intent: RequestIntent) => {
    const trimmedInstruction = intent === 'analysis' ? IMAGE_ANALYSIS_INSTRUCTION : instruction.trim()
    if (busyRef.current || !ready || !previewUrl || (intent === 'instruction' && !trimmedInstruction) || profileError || !agentProfile) return

    busyRef.current = true
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    const baseAdjustments = structuredClone(adjustments)
    const baseKey = recipeKey
    const requestImageId = imageId
    const requestPreviewUrl = previewUrl
    requestControllerRef.current = controller
    setIsRequesting(true)
    setError('')
    setRetryTextOnly(false)
    const previousCandidate = candidateRef.current
    if (previousCandidate) void saveOutcome(previousCandidate.historyRecord, 'expired')
    candidateRef.current = null
    setCandidate(null)

    const isCurrentRequest = () => !controller.signal.aborted
      && requestIdRef.current === requestId
      && latestImageIdRef.current === requestImageId
      && JSON.stringify(latestAdjustmentsRef.current) === baseKey

    try {
      const imagePayload = includeImage
        ? await createColorAssistantImagePayload(requestPreviewUrl)
        : undefined
      if (!isCurrentRequest()) return

      const raw = await callAgentColorAssistantApi({
        settings,
        profile: agentProfile,
        instruction: trimmedInstruction,
        adjustments: baseAdjustments,
        ...(imagePayload === undefined ? {} : {
          previewImageDataUrl: imagePayload.previewImageDataUrl,
          colorAnalysis: imagePayload.analysis,
        }),
        signal: controller.signal,
      })
      if (!isCurrentRequest()) return

      let result: ReturnType<typeof applyColorAssistantProposal>
      try {
        result = applyColorAssistantProposal(baseAdjustments, raw)
      } catch (cause) {
        if (isCurrentRequest()) {
          const detail = cause instanceof Error ? cause.message : '调色数据格式无效'
          setError(`无法读取调色建议：${detail}`)
        }
        return
      }
      const historyRecord = createColorAssistantHistoryRecord({
        id: createLocalId(),
        sourceImageId,
        activeImageId: requestImageId,
        instruction: trimmedInstruction,
        baseAdjustments,
        proposal: result.proposal,
      })
      let savedRecord: ColorAssistantHistoryRecord | null = historyRecord
      try {
        await putColorAssistantHistoryRecord(historyRecord)
      } catch {
        savedRecord = null
      }
      if (!isCurrentRequest()) {
        if (savedRecord) void saveOutcome(historyRecord, 'expired')
        return
      }
      if (savedRecord) {
        historyRevisionRef.current += 1
        setHistory((current) => sortHistory([historyRecord, ...current.filter((record) => record.id !== historyRecord.id)]))
      }
      else setError('调色建议已生成，但本轮未能保存到历史记录；仍可应用或放弃当前候选。')
      const nextCandidate = { ...result, baseAdjustments, baseKey, imageId: requestImageId, historyRecord: savedRecord }
      candidateRef.current = nextCandidate
      setCandidate(nextCandidate)
    } catch (cause) {
      if (!isCurrentRequest()) return
      const unsupportedImage = includeImage && cause instanceof Error && IMAGE_INPUT_ERROR.test(cause.message)
      setError(unsupportedImage
        ? intent === 'analysis'
          ? '当前 Agent 模型不支持图像输入，无法分析预览。请更换支持图像输入的 Agent 模型后重试。'
          : '当前 Agent 模型不支持图像输入，无法分析预览。你可以选择仅文字与参数重试。'
        : '暂时无法获取调色建议，请检查 Agent 配置或网络后重试。')
      setRetryTextOnly(unsupportedImage && intent === 'instruction')
    } finally {
      if (requestIdRef.current === requestId) {
        busyRef.current = false
        requestControllerRef.current = null
        setIsRequesting(false)
      }
    }
  }

  const visibleCandidate = candidate && candidate.imageId === imageId && candidate.baseKey === recipeKey
    ? candidate
    : null
  const visibleCandidateHasChanges = Boolean(visibleCandidate
    && (visibleCandidate.proposal.changes.length > 0 || visibleCandidate.proposal.curves.length > 0))
  const visibleCandidateNeedsClarification = Boolean(visibleCandidate?.proposal.clarification)
  const canSubmit = ready && Boolean(previewUrl) && Boolean(instruction.trim()) && !profileError && !isRequesting
  const canAnalyzeImage = ready && Boolean(previewUrl) && !profileError && !isRequesting

  return (
    <section className="color-assistant" role="region" aria-label="AI 调色助手">
      <div className="color-assistant-heading">
        <h2>AI 调色助手</h2>
        <p>点击“提交调色建议”或“分析图片色彩”后，才会将当前预览压缩为最长边不超过 768 px 的 JPEG，并附带本地色彩统计摘要发送给已配置的 Agent 模型；原始图片不会发送。</p>
      </div>

      <label className="color-assistant-label" htmlFor="color-assistant-instruction">调色需求</label>
      <textarea
        id="color-assistant-instruction"
        aria-label="调色需求"
        value={instruction}
        onChange={(event) => setInstruction(event.currentTarget.value)}
        placeholder="描述希望得到的色彩效果"
        rows={3}
        disabled={isRequesting}
      />

      {profileError && <p className="color-assistant-config" role="status">Agent 配置不可用：{profileError} 请检查设置 → API 配置。</p>}
      {!ready && <p className="color-assistant-status" role="status">等待当前调色预览完成</p>}
      {isRequesting && <p className="color-assistant-status" role="status">正在请求调色建议</p>}
      {error && <p className="color-assistant-error" role="alert">{error}</p>}
      {historyError && <p className="color-assistant-error" role="alert">{historyError}</p>}

      <div className="color-assistant-actions">
        {isRequesting ? (
          <button type="button" onClick={cancelRequest}>取消请求</button>
        ) : (
          <>
            <button type="button" className="color-assistant-submit" disabled={!canSubmit} onClick={() => void submit(true, 'instruction')}>提交调色建议</button>
            <button type="button" className="color-assistant-analyze" disabled={!canAnalyzeImage} onClick={() => void submit(true, 'analysis')}>分析图片色彩</button>
          </>
        )}
        {retryTextOnly && !isRequesting && (
          <button type="button" onClick={() => void submit(false, 'instruction')}>仅文字与参数重试</button>
        )}
      </div>

      {visibleCandidate && <section className="color-assistant-candidate" aria-label="调色候选方案">
        <h3>候选建议</h3>
        <p className="color-assistant-explanation">{visibleCandidate.proposal.explanation}</p>
        {visibleCandidate.proposal.clarification && <p className="color-assistant-clarification">{visibleCandidate.proposal.clarification}</p>}
        {(visibleCandidate.proposal.changes.length > 0 || visibleCandidate.proposal.curves.length > 0) && (
          <div className="color-assistant-change-list" aria-label="调整前后对照">
            {visibleCandidate.proposal.changes.map((change) => <div className="color-assistant-change" key={change.path}>
              <span>{getColorAssistantChangeLabel(change.path)}</span>
              <span>{formatValue(readPath(visibleCandidate.baseAdjustments, change.path))} → {formatValue(change.value)}</span>
            </div>)}
            {visibleCandidate.proposal.curves.map((curve) => <div className="color-assistant-change color-assistant-curve" key={curve.channel}>
              <span>{getColorAssistantChangeLabel(`curve.${curve.channel}`)}</span>
              <span>{formatCurve(visibleCandidate.baseAdjustments.curves[curve.channel])} → {formatCurve(visibleCandidate.adjustments.curves[curve.channel])}</span>
            </div>)}
          </div>
        )}
        <div className="color-assistant-actions">
          {visibleCandidateHasChanges && (
            <button type="button" aria-label="应用调色建议" className="color-assistant-apply" onClick={() => {
              candidateRef.current = null
              setCandidate(null)
              const applied = onApply(visibleCandidate.adjustments, visibleCandidate.baseAdjustments, visibleCandidate.imageId)
              if (applied === false) {
                setError('当前配方已变化，该建议已过期，请重新提交。')
                void saveOutcome(visibleCandidate.historyRecord, 'expired')
                return
              }
              void saveOutcome(visibleCandidate.historyRecord, 'applied')
            }}>应用建议</button>
          )}
          {!visibleCandidateHasChanges && !visibleCandidateNeedsClarification && (
            <button type="button" className="color-assistant-apply" onClick={() => {
              candidateRef.current = null
              setCandidate(null)
              void saveOutcome(visibleCandidate.historyRecord, 'applied')
            }}>保持当前配方</button>
          )}
          <button type="button" onClick={() => {
            candidateRef.current = null
            setCandidate(null)
            void saveOutcome(visibleCandidate.historyRecord, 'discarded')
          }}>放弃建议</button>
        </div>
      </section>}
      <details className="color-assistant-history">
        <summary>调色建议历史 <span>{history.length}</span></summary>
        {historyError ? null : history.length === 0
          ? <p className="color-assistant-history-empty">暂无调色建议记录</p>
          : <div className="color-assistant-history-list">{history.map((record) => <details className="color-assistant-history-entry" key={record.id}>
            <summary>
              <span className="color-assistant-history-instruction">{record.instruction}</span>
              <span className={`color-assistant-history-status is-${record.outcome}`}>{historyOutcomeLabel(record.outcome)}</span>
            </summary>
            <div className="color-assistant-history-body">
              <div className="color-assistant-history-meta">
                <time>{new Date(record.createdAt).toLocaleString()}</time>
                <span>图片版本 {record.activeImageId}</span>
              </div>
              <p>{record.explanation}</p>
              {record.clarification && <p className="color-assistant-clarification">{record.clarification}</p>}
              {record.changes.length > 0 && <div className="color-assistant-change-list" aria-label="参数变化">
                {record.changes.map((change) => <div className="color-assistant-change" key={change.path}>
                  <span>{getColorAssistantChangeLabel(change.path)}</span>
                  <span>{formatValue(change.before)} → {formatValue(change.after)}</span>
                </div>)}
              </div>}
              {record.curves.length > 0 && <div className="color-assistant-change-list" aria-label="曲线变化">
                {record.curves.map((curve) => <div className="color-assistant-change color-assistant-curve" key={curve.channel}>
                  <span>{getColorAssistantChangeLabel(`curve.${curve.channel}`)}</span>
                  <span>{formatCurve(curve.before)} → {formatCurve(curve.after)}</span>
                </div>)}
              </div>}
            </div>
          </details>)}</div>}
      </details>
    </section>
  )
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function formatValue(value: unknown): string {
  if (typeof value !== 'number') return '—'
  return String(value)
}

function formatCurve(points: Array<{ x: number; y: number }>): string {
  const actualPoints = points.length >= 2 ? points : [{ x: 0, y: 0 }, { x: 1, y: 1 }]
  return actualPoints.map(({ x, y }) => `(${formatValue(x)}, ${formatValue(y)})`).join(' ')
}

function sortHistory(records: ColorAssistantHistoryRecord[]): ColorAssistantHistoryRecord[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt)
}

function historyOutcomeLabel(outcome: ColorAssistantHistoryOutcome): string {
  return outcome === 'pending' ? '待处理'
    : outcome === 'applied' ? '已采纳'
      : outcome === 'discarded' ? '已放弃' : '已过期'
}
