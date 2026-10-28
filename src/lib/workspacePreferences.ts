import type { AppSettings } from '../types'

export const getAgentEnterSubmit = (settings: AppSettings) => settings.agentEnterSubmit ?? settings.enterSubmit
export const getAgentPersistDraft = (settings: AppSettings) => settings.agentPersistInputOnRestart ?? settings.persistInputOnRestart

export interface VideoPreferences { persistDraft: boolean; clearAfterSubmit: boolean }
export const DEFAULT_VIDEO_PREFERENCES: VideoPreferences = { persistDraft: true, clearAfterSubmit: false }

export function getVideoPersistedDraft<T extends {
  inputMode: unknown; mode: unknown; model: string; params: unknown; prompt: string
  firstFrameId: string | null; lastFrameId: string | null
  refItems: unknown[]; refImageIds: string[]; refVideoIds: string[]; refAudioIds: string[]
  preferences: VideoPreferences
}>(state: T) {
  const keep = state.preferences.persistDraft
  return {
    preferences: state.preferences,
    inputMode: state.inputMode, mode: state.mode, model: state.model, params: state.params,
    prompt: keep ? state.prompt : '',
    firstFrameId: keep ? state.firstFrameId : null, lastFrameId: keep ? state.lastFrameId : null,
    refItems: keep ? state.refItems : [], refImageIds: keep ? state.refImageIds : [],
    refVideoIds: keep ? state.refVideoIds : [], refAudioIds: keep ? state.refAudioIds : [],
  }
}
