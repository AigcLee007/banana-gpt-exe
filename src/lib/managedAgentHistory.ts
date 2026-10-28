import type { AgentConversation } from '../types'

export interface ManagedAgentConversationGroup {
  key: 'today' | 'yesterday' | 'earlier'
  label: string
  conversations: AgentConversation[]
}

export function groupManagedAgentConversations(conversations: AgentConversation[], now = new Date()): ManagedAgentConversationGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
  const groups: ManagedAgentConversationGroup[] = [
    { key: 'today', label: '今天', conversations: [] },
    { key: 'yesterday', label: '昨天', conversations: [] },
    { key: 'earlier', label: '更早', conversations: [] },
  ]
  for (const conversation of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const index = conversation.updatedAt >= today ? 0 : conversation.updatedAt >= yesterday ? 1 : 2
    groups[index].conversations.push(conversation)
  }
  return groups.filter(group => group.conversations.length > 0)
}

export function getManagedAgentRenameTitle(conversation: AgentConversation, value: string, generatingTitleIds: Record<string, boolean>): string | null {
  if (generatingTitleIds[conversation.id]) return null
  const title = value.trim()
  return title && title !== conversation.title ? title : null
}

export function getManagedAgentRenameKeyAction(key: string, isComposing: boolean): 'cancel' | 'commit' | null {
  if (isComposing) return null
  return key === 'Escape' ? 'cancel' : key === 'Enter' ? 'commit' : null
}
