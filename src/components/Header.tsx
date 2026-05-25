import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import HistoryModal from './HistoryModal'
import { EditIcon, HelpCircleIcon, HistoryIcon, SettingsIcon } from './icons'

const APP_BRAND_NAME = '艾特智绘'
type ThemeMode = 'dark' | 'light' | 'cream'

const THEME_OPTIONS: Array<{ label: string; value: ThemeMode }> = [
  { label: '暗夜', value: 'dark' },
  { label: '白昼', value: 'light' },
  { label: '米黄', value: 'cream' },
]

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const agentMobileHeaderVisible = useStore((s) => s.agentMobileHeaderVisible)
  const agentConversations = useStore((s) => s.agentConversations)
  const activeAgentConversationId = useStore((s) => s.activeAgentConversationId)
  const createConversation = useStore((s) => s.createAgentConversation)
  const setAgentEditingConversationId = useStore((s) => s.setAgentEditingConversationId)
  const activeConversation = agentConversations.find((item) => item.id === activeAgentConversationId)

  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const theme = (settings.theme ?? 'dark') as ThemeMode

  const [showHelp, setShowHelp] = useState(false)
  const [showThemeMenu, setShowThemeMenu] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up')
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const themeMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (appMode === 'agent') {
      setScrollDirection('up')
      return
    }

    let lastScrollY = window.scrollY
    let ticking = false
    const handleScroll = () => {
      if (ticking) return
      window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY
        if (currentScrollY < 20) setScrollDirection('up')
        else if (currentScrollY > lastScrollY + 10) setScrollDirection('down')
        else if (currentScrollY < lastScrollY - 10) setScrollDirection('up')
        lastScrollY = currentScrollY
        ticking = false
      })
      ticking = true
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [appMode])

  useEffect(() => {
    if (appMode === 'agent' && !agentMobileHeaderVisible) {
      setHintVisible(true)
      const timer = setTimeout(() => setHintVisible(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [appMode, agentMobileHeaderVisible])

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(event.target as Node)) {
        setShowThemeMenu(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()
  const themeTooltip = useTooltip()
  const currentThemeLabel = THEME_OPTIONS.find((option) => option.value === theme)?.label ?? '暗夜'

  return (
    <>
      <header
        data-no-drag-select
        className={`safe-area-top fixed top-0 left-0 right-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08] transition-transform duration-300 ease-in-out ${appMode === 'agent' && !agentMobileHeaderVisible ? '-translate-y-full sm:translate-y-0' : 'translate-y-0'}`}
      >
        <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between relative">
          <div className="flex-1 min-w-0 pr-2 flex items-center gap-2">
            <h1 className="inline-flex items-start relative mr-2">
              <div className="inline-flex items-center gap-3 text-[17px] sm:text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100">
                <img
                  src="/aittco-icon.png"
                  alt={APP_BRAND_NAME}
                  className="h-9 w-9 rounded-full object-cover shadow-sm ring-1 ring-black/5 dark:ring-white/10"
                />
                <span>{APP_BRAND_NAME}</span>
              </div>
            </h1>
            {appMode === 'agent' && (
              <div className="hidden sm:flex items-center gap-1 relative">
                <button
                  ref={historyButtonRef}
                  type="button"
                  onClick={() => setShowHistoryModal((visible) => !visible)}
                  className="p-1.5 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.04] rounded-lg transition-colors"
                  title="历史记录"
                >
                  <HistoryIcon className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAppMode('agent')
                    createConversation()
                  }}
                  className="p-1.5 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.04] rounded-lg transition-colors"
                  title="新对话"
                >
                  <EditIcon className="w-5 h-5" />
                </button>
                {showHistoryModal && (
                  <HistoryModal onClose={() => setShowHistoryModal(false)} ignoreOutsideClickRef={historyButtonRef} />
                )}
              </div>
            )}
          </div>

          {appMode === 'agent' && activeConversation && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden sm:flex max-w-[30%]">
              <button
                type="button"
                onClick={() => {
                  setShowHistoryModal(true)
                  setTimeout(() => {
                    setAgentEditingConversationId(activeConversation.id)
                  }, 0)
                }}
                className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate hover:bg-gray-100 dark:hover:bg-white/[0.04] px-2 py-1 rounded transition-colors"
              >
                {activeConversation.title || 'Agent'}
              </button>
            </div>
          )}

          <div className="hidden sm:flex items-center gap-1 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-gray-100/70 dark:bg-white/[0.04] p-1 mr-4">
            <button
              type="button"
              onClick={() => setAppMode('gallery')}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${appMode === 'gallery' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              画廊
            </button>
            <button
              type="button"
              onClick={() => setAppMode('agent')}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${appMode === 'agent' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              Agent
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <div ref={themeMenuRef} className="relative" {...themeTooltip.handlers}>
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  setShowThemeMenu((v) => !v)
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="切换主题"
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v2m0 14v2m9-9h-2M5 12H3m14.95 6.95-1.414-1.414M7.464 7.464 6.05 6.05m11.314 0-1.414 1.414M7.464 16.536 6.05 17.95M12 16a4 4 0 100-8 4 4 0 000 8z" />
                </svg>
              </button>
              <ViewportTooltip visible={themeTooltip.visible} className="whitespace-nowrap">
                主题：{currentThemeLabel}
              </ViewportTooltip>
              {showThemeMenu && (
                <div className="absolute right-0 mt-2 w-28 rounded-xl border border-gray-200/70 bg-white/95 p-1 shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSettings({ theme: option.value })
                        setShowThemeMenu(false)
                      }}
                      className={`w-full rounded-lg px-3 py-1.5 text-left text-xs transition-colors ${
                        option.value === theme
                          ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
                          : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative" {...helpTooltip.handlers}>
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>

            <div className="relative" {...settingsTooltip.handlers}>
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="设置"
              >
                <SettingsIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
          </div>
        </div>

        <div
          className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 opacity-0 pb-0' : 'max-h-20 opacity-100 pb-2'}`}
        >
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-gray-100/70 dark:bg-white/[0.04] p-1 mx-2">
            <button
              type="button"
              onClick={() => setAppMode('gallery')}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${appMode === 'gallery' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              画廊
            </button>
            <button
              type="button"
              onClick={() => setAppMode('agent')}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${appMode === 'agent' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              Agent
            </button>
          </div>
        </div>
      </header>

      <div
        className={`fixed top-0 left-0 right-0 z-30 flex justify-center pointer-events-none transition-all duration-300 ease-in-out sm:hidden ${appMode === 'agent' && hintVisible && !agentMobileHeaderVisible ? 'translate-y-[env(safe-area-inset-top,0px)] opacity-100' : '-translate-y-full opacity-0'}`}
      >
        <div className="bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-b-xl shadow-lg">
          列表顶部下拉显示顶栏
        </div>
      </div>

      <div
        className={`safe-area-top invisible pointer-events-none transition-all duration-300 ease-in-out ${appMode === 'agent' && !agentMobileHeaderVisible ? 'max-h-0 sm:max-h-[500px] opacity-0 sm:opacity-100 overflow-hidden sm:overflow-visible' : 'max-h-[500px] opacity-100'}`}
        aria-hidden="true"
      >
        <div className="safe-header-inner" />
        <div
          className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 pb-0' : 'max-h-20 pb-2'}`}
        >
          <div className="p-1">
            <div className="py-1.5 text-sm">占位</div>
          </div>
        </div>
      </div>
      {showHelp && <HelpModal appMode={appMode} onClose={() => setShowHelp(false)} />}
    </>
  )
}
