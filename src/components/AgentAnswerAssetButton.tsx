import { useState } from 'react'
import type { AgentMessage } from '../types'
import { saveAgentAnswer } from '../lib/agentAnswerAsset'
import { DownloadIcon } from './icons'

export default function AgentAnswerAssetButton({ conversationId, message }: { conversationId: string; message: AgentMessage }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const label = state === 'failed' ? '回答保存失败，点击重试' : '保存回答到素材库'
  return <button type="button" aria-label={label} title={label}
    disabled={state === 'saving' || state === 'saved'}
    className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors disabled:opacity-60 ${state === 'failed' ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200'}`}
    onClick={() => { setState('saving'); void saveAgentAnswer(conversationId, message, true).then(() => setState('saved'), () => setState('failed')) }}>
    <DownloadIcon className="h-4 w-4" />
    <span role="status">{state === 'saving' ? '正在保存…' : state === 'saved' ? '已存入素材库' : state === 'failed' ? '保存失败 · 重试' : '存入素材库'}</span>
  </button>
}
