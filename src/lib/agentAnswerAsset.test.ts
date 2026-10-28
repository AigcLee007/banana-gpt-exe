import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveAgentAnswer } from './agentAnswerAsset'

afterEach(() => { vi.unstubAllGlobals() })

describe('manual Agent answer archive', () => {
  it('archives only the selected completed assistant text and a message source reference', async () => {
    const save = vi.fn().mockResolvedValue({ id: 'saved' })
    vi.stubGlobal('window', { __AAP_ASSETS__: { ready: Promise.resolve(), save } })
    await saveAgentAnswer('c1', { id: 'a1', role: 'assistant', content: '**选中的回答**' }, true)
    expect(save).toHaveBeenCalledWith({ text: '**选中的回答**', title: 'Agent回答.md', source: 'agent', sourceRef: 'message:c1:a1' })
  })

  it('keeps a failed manual copy retryable without changing or regenerating the answer', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'saved' })
    vi.stubGlobal('window', { __AAP_ASSETS__: { ready: Promise.resolve(), save } })
    const message = { id: 'a1', role: 'assistant' as const, content: '原有回答' }
    await expect(saveAgentAnswer('c1', message, true)).rejects.toThrow('offline')
    await expect(saveAgentAnswer('c1', message, true)).resolves.toEqual({ id: 'saved' })
    expect(message.content).toBe('原有回答')
    expect(save).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ id: 'u1', role: 'user', content: '提示词' }, true],
    [{ id: 'a1', role: 'assistant', content: '生成中' }, false],
    [{ id: 'a1', role: 'assistant', content: '  ' }, true],
  ])('does not save a prompt, streaming answer, or empty output', async (message, complete) => {
    const save = vi.fn()
    vi.stubGlobal('window', { __AAP_ASSETS__: { ready: Promise.resolve(), save } })
    await expect(saveAgentAnswer('c1', message as any, complete)).rejects.toThrow()
    expect(save).not.toHaveBeenCalled()
  })
})
