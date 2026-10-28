import type { AgentMessage } from '../types'
import type { PortalAssets } from './portalAssetAdapter'

/** Explicit answer copy: never serializes the conversation, reasoning, or tools. */
export async function saveAgentAnswer(conversationId: string, message: Pick<AgentMessage, 'id' | 'role' | 'content'>, complete: boolean) {
  if (!complete || message.role !== 'assistant' || !message.content.trim()) throw new Error('请选择已完成的回答')
  const shared: PortalAssets | undefined = window.__AAP_ASSETS__
  if (!shared) throw new Error('素材库仍在加载，请稍后重试')
  await shared.ready
  return shared.save({ text: message.content, title: 'Agent回答.md', source: 'agent', sourceRef: `message:${conversationId}:${message.id}` })
}
