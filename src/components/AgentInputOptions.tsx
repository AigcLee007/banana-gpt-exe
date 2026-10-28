import { useStore } from '../store'
import { AGENT_TEXT_MODELS, type AgentTextModel } from '../lib/bananaModels'
import { requestEcommerceWorkspace } from '../lib/agentEcommerceWorkspace'

export default function AgentInputOptions() {
  const model = useStore(state => state.settings.agentTextModel)
  const webSearch = useStore(state => state.settings.agentWebSearch)
  const setSettings = useStore(state => state.setSettings)
  return <div aria-label="Agent 对话选项" className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[color:var(--app-text-muted)]">
    <label className="inline-flex min-w-0 items-center gap-2">对话模型<select aria-label="Agent 文本模型" value={model} onChange={event => setSettings({ agentTextModel: event.target.value as AgentTextModel })} className="max-w-48 rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-2 py-1.5 text-xs text-[color:var(--app-text)] focus-visible:outline-blue-400">{AGENT_TEXT_MODELS.map(item => <option key={item.model} value={item.model}>{item.label}</option>)}</select></label>
    <button type="button" role="switch" aria-label="联网搜索" aria-checked={webSearch} onClick={() => setSettings({ agentWebSearch: !webSearch })} className={`rounded-lg border px-2.5 py-1.5 ${webSearch ? 'border-blue-400/50 bg-blue-500/10 text-blue-600 dark:text-blue-300' : 'border-[color:var(--app-border)]'}`}>联网搜索{webSearch ? ' · 已开启' : ''}</button>
    {webSearch && <span className="text-[10px]">搜索调用可能额外计费</span>}
    {window.__AAP__?.baseUrl && <button type="button" onClick={requestEcommerceWorkspace} className="rounded-lg border border-[color:var(--app-border)] px-2.5 py-1.5 hover:bg-[color:var(--app-bg-soft)]">电商套图</button>}
  </div>
}
