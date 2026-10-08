// 视频工作台容器组件

import { useEffect, useState } from 'react'
import { useVideoStore } from '../videoStore'
import { useVideoAssetStore } from '../videoAssetStore'
import { resolveVideoAssetToMediaReference } from '../lib/videoAssetBridge'
import { useStore } from '../store'
import VideoInputBar from './VideoInputBar'
import VideoTaskGrid from './VideoTaskGrid'
import VideoDetailModal from './VideoDetailModal'
import VideoAssetLibrary from './VideoAssetLibrary'
import { getVideoModelDefinition } from '../lib/videoModels'

export default function VideoWorkspace() {
  const { loadTasks, recoverTasks, inputMode, firstFrameId, lastFrameId } = useVideoStore()
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false)
  const { load: loadAssets } = useVideoAssetStore()

  const useAssets = async (assets: import('../lib/videoAssetTypes').VideoAssetRecord[]) => {
    const state = useVideoStore.getState()
    try {
      const references = []
      for (const asset of assets) references.push(await resolveVideoAssetToMediaReference(asset))
      if (state.inputMode === 'reference') {
        for (const reference of references) state.addReference(reference)
      } else {
        for (const reference of references.filter((item) => item.type === 'image')) {
          const current = useVideoStore.getState()
          if (!current.firstFrameId) current.setFirstFrame(reference.id)
          else if (getVideoModelDefinition(current.model)?.modes.flf2v && !current.lastFrameId) current.setLastFrame(reference.id)
          else break
        }
      }
    } catch (error) {
      useStore.getState().showToast(error instanceof Error ? error.message : '添加素材失败', 'error')
    }
  }

  useEffect(() => {
    const draft = useVideoStore.getState()
    draft.setModel(draft.model)
    loadTasks().then(() => {
      recoverTasks()
    })
    void loadAssets()
  }, [loadTasks, recoverTasks, loadAssets])

  return (
    <div data-video-workspace className="min-h-[calc(100vh-5rem)] bg-[color:var(--app-bg)] px-4 pb-8 pt-2 sm:px-6">
      <div className="mx-auto grid max-w-[1560px] items-start gap-6 lg:grid-cols-[minmax(380px,440px)_minmax(0,1fr)]">
        <aside data-video-panel className="min-w-0 lg:sticky lg:top-24">
          <VideoInputBar />
        </aside>
        <section data-video-results className="min-w-0">
          <VideoTaskGrid onOpenAssetLibrary={() => setAssetLibraryOpen(true)} />
        </section>
      </div>
      <VideoAssetLibrary open={assetLibraryOpen} onClose={() => setAssetLibraryOpen(false)} onUse={useAssets} />
      <VideoDetailModal />
    </div>
  )
}
