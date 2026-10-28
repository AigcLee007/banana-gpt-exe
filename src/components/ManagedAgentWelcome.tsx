import { ChevronDownIcon, CopyIcon, EditIcon, RefreshIcon } from './icons'
import { requestInputBarExpansion } from '../lib/inputBarPresentation'
import { requestEcommerceWorkspace } from '../lib/agentEcommerceWorkspace'

const starters = [
  {
    title: '先聊方案，再开始创作',
    description: '把模糊想法整理清楚，确认方向后再生成。',
    prompt: '我想做一组视觉作品，但还没有明确方向。请先询问我的主题、用途和喜欢的风格，帮我整理几个创意方向。等我确认方案后再生成图片。',
    icon: EditIcon,
  },
  {
    title: '产品实拍，生成电商套图',
    description: '上传真实产品，规划主图、副图与详情页。',
    prompt: '',
    icon: CopyIcon,
  },
  {
    title: '围绕参考图持续修改',
    description: '保留画面主体，通过对话逐步调整细节。',
    prompt: '我会上传或从素材库选择一张参考图。请先帮我梳理可以调整的构图、背景、光线和细节，保留我指定的主体特征；等参考图和修改要求都确认后再生成。',
    icon: RefreshIcon,
  },
]

export default function ManagedAgentWelcome({ onChoose }: { onChoose: (prompt: string) => void }) {
  return <div data-aap-agent-welcome>
    <h2>从一个想法，开始创作</h2>
    <p className="agent-welcome-description">一起理清方向、生成系列图，再通过对话打磨细节。</p>
    <div className="agent-starters" aria-label="选择示例，开始创作">
      {starters.map(({ title, description, prompt, icon: Icon }) => <button key={title} type="button" className="agent-starter" onClick={() => prompt ? onChoose(prompt) : requestEcommerceWorkspace()}>
        <Icon className="agent-starter-icon" />
        <span className="agent-starter-title">{title}</span>
        <span className="agent-starter-description">{description}</span>
      </button>)}
    </div>
    <button data-aap-agent-start type="button" aria-label="展开输入框" aria-controls="image-generation-composer" aria-expanded={false} className="agent-welcome-start composer-disclosure-cue" onClick={requestInputBarExpansion}>
      <ChevronDownIcon className="h-4 w-4 rotate-180" /><span>展开输入框</span>
    </button>
  </div>
}
