import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { filterGalleryTasks, toggleVisibleGallerySelection } from './galleryPresentation'

const task = (id: string, patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id, prompt: id, params: { ...DEFAULT_PARAMS }, inputImageIds: [], outputImages: [],
  status: 'running', error: null, createdAt: 1, finishedAt: null, elapsed: null, ...patch,
})

describe('gallery filtering and selection', () => {
  it('includes recovering tasks under generating and excludes them from failed cleanup', () => {
    const tasks = [task('running'), task('recovery', { status: 'error', customRecoverable: true }), task('error', { status: 'error' })]
    expect(filterGalleryTasks(tasks, '', 'running', false).map((t) => t.id)).toEqual(['running', 'recovery'])
    expect(filterGalleryTasks(tasks, '', 'error', false).map((t) => t.id)).toEqual(['error'])
  })
  it('searches model names and keeps favorites and newest ordering', () => {
    const tasks = [task('old', { apiModel: 'GPT-Image-2', isFavorite: true }), task('new', { apiModel: 'gpt-image-2', isFavorite: true, createdAt: 5 }), task('other')]
    expect(filterGalleryTasks(tasks, ' gpt-image ', 'all', true).map((t) => t.id)).toEqual(['new', 'old'])
  })
  it('selects the visible records even when equally many hidden records were selected', () => {
    expect(toggleVisibleGallerySelection(['hidden'], ['visible'])).toEqual(['visible'])
  })
  it('deselects visible records and drops hidden selections', () => {
    expect(toggleVisibleGallerySelection(['hidden', 'visible'], ['visible'])).toEqual([])
  })
  it('combines model, recent time and requested aspect without treating auto as square', () => {
    const now = Date.UTC(2026, 9, 15, 12)
    const tasks = [
      task('match', { apiModel: 'image-2', createdAt: now, params: { ...DEFAULT_PARAMS, size: '1536x1024' } }),
      task('old', { apiModel: 'image-2', createdAt: now - 8 * 86400000, params: { ...DEFAULT_PARAMS, size: '1536x1024' } }),
      task('other', { apiModel: 'other', createdAt: now, params: { ...DEFAULT_PARAMS, size: '1536x1024' } }),
      task('auto', { apiModel: 'image-2', createdAt: now, params: { ...DEFAULT_PARAMS, size: 'auto' } }),
    ]
    expect(filterGalleryTasks(tasks, '', 'all', false, { model: 'image-2', time: 'week', aspect: 'landscape' }, now).map(t => t.id)).toEqual(['match'])
    expect(filterGalleryTasks(tasks, '', 'all', false, { aspect: 'square' }, now)).toEqual([])
  })
})
