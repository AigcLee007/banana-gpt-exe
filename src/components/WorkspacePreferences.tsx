import { useState } from 'react'
import type { AppMode } from '../types'
import { useStore } from '../store'
import { useVideoStore } from '../videoStore'
import { getActiveApiProfile, normalizeAgentMaxToolRounds } from '../lib/apiProfiles'
import { getAgentEnterSubmit, getAgentPersistDraft } from '../lib/workspacePreferences'
import WorkspaceDialog, { PreferenceSwitch, workspaceControlClass } from './WorkspaceDialog'

export default function WorkspacePreferences({ mode, onClose }: { mode: AppMode; onClose: () => void }) {
  const settings = useStore(state => state.settings)
  const setSettings = useStore(state => state.setSettings)
  const videoPreferences = useVideoStore(state => state.preferences)
  const setVideoPreferences = useVideoStore(state => state.setPreferences)
  const [rounds, setRounds] = useState(String(settings.agentMaxToolRounds))
  const agent = mode === 'agent'
  const enter = agent ? getAgentEnterSubmit(settings) : settings.enterSubmit
  const title = mode === 'gallery' ? '画廊创作偏好' : agent ? 'Agent 对话偏好' : '视频创作偏好'
  return <WorkspaceDialog title={title} onClose={onClose}>
    <p className="text-xs leading-relaxed text-[color:var(--app-text-muted)]">偏好自动保存，仅调整当前板块的使用习惯。</p>
    {mode === 'video' ? <>
      <PreferenceSwitch label="保留未提交草稿" description="刷新或重新打开后恢复提示词和参考素材。模型与画面参数始终保留。" checked={videoPreferences.persistDraft} onChange={persistDraft => setVideoPreferences({ persistDraft })} />
      <PreferenceSwitch label="提交后清空创作内容" description="本机任务创建成功后清空提示词和参考素材，保留模型与画面参数。" checked={videoPreferences.clearAfterSubmit} onChange={clearAfterSubmit => setVideoPreferences({ clearAfterSubmit })} />
    </> : <>
      <label className="flex items-center justify-between gap-4 text-sm">{agent ? '消息发送方式' : '任务提交方式'}<select aria-label={agent ? '消息发送方式' : '任务提交方式'} className={workspaceControlClass} value={enter ? 'enter' : 'modifier'} onChange={event => setSettings(agent ? { agentEnterSubmit: event.target.value === 'enter' } : { enterSubmit: event.target.value === 'enter' })}><option value="modifier">Ctrl / Cmd + Enter</option><option value="enter">Enter</option></select></label>
      <p className="!mt-2 text-xs text-[color:var(--app-text-muted)]">{enter ? 'Shift + Enter 换行。' : 'Enter 换行。'}</p>
      <PreferenceSwitch label="保留未提交草稿" description="刷新或重新打开后恢复当前板块的提示词和参考图。" checked={agent ? getAgentPersistDraft(settings) : settings.persistInputOnRestart} onChange={keep => setSettings(agent ? { agentPersistInputOnRestart: keep } : { persistInputOnRestart: keep })} />
      {!agent && <>
        <PreferenceSwitch label="提交后清空创作内容" description="本机任务创建成功后清空提示词与参考图。" checked={settings.clearInputAfterSubmit} onChange={clearInputAfterSubmit => setSettings({ clearInputAfterSubmit })} />
        <label className="flex items-center justify-between gap-4 text-sm">参考图编辑按钮<select aria-label="参考图编辑按钮" className={workspaceControlClass} value={settings.referenceImageEditAction} onChange={event => setSettings({ referenceImageEditAction: event.target.value as typeof settings.referenceImageEditAction })}><option value="ask">每次询问</option><option value="replace-reference">替换参考图</option><option value="add-mask">添加遮罩</option></select></label>
      </>}
      {agent && <>
        <PreferenceSwitch label="发送后自动滚动到底部" checked={settings.agentScrollToBottomAfterSubmit} onChange={agentScrollToBottomAfterSubmit => setSettings({ agentScrollToBottomAfterSubmit })} />
        <details className="rounded-xl border border-[color:var(--app-border)] p-3"><summary className="cursor-pointer text-sm font-medium">高级偏好</summary><div className="mt-5 space-y-5">
          <PreferenceSwitch label="数学公式格式提示" description="优先输出当前界面支持的数学公式格式。" checked={settings.agentMathFormattingPrompt} onChange={agentMathFormattingPrompt => setSettings({ agentMathFormattingPrompt })} />
          <label className="flex items-center justify-between gap-4 text-sm">最大工具调用轮数<input aria-label="最大工具调用轮数" type="number" min={1} max={50} className={`${workspaceControlClass} w-20`} value={rounds} onChange={event => setRounds(event.target.value)} onBlur={() => { const value = normalizeAgentMaxToolRounds(rounds, settings.agentMaxToolRounds); setRounds(String(value)); setSettings({ agentMaxToolRounds: value }) }} /></label><p className="text-xs text-[color:var(--app-text-muted)]">默认 15，范围 1–50。限制连续工具调用次数。</p>
        </div></details>
      </>}
      {!getActiveApiProfile(settings).locked && <PreferenceSwitch label="复用作品时沿用原自定义渠道" description="仅适用于手动添加的自定义渠道。" checked={settings.reuseTaskApiProfileTemporarily} onChange={reuseTaskApiProfileTemporarily => setSettings({ reuseTaskApiProfileTemporarily })} />}
    </>}
  </WorkspaceDialog>
}
