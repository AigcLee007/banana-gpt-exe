import { useEffect, useState } from 'react'
import { retryStudioArchives, studioArchiveRecords } from '../lib/portalAssets'

export default function PortalAssetStatus() {
  const [records, setRecords] = useState(studioArchiveRecords)
  useEffect(() => { const update = () => setRecords(studioArchiveRecords()); window.addEventListener('aap:archive-state', update); update(); return () => window.removeEventListener('aap:archive-state', update) }, [])
  if (!records.length) return null
  const failed = records.some(record => record.status === 'failed')
  return <div role="status" className="fixed bottom-3 right-3 z-[85] max-w-xs rounded-xl border border-gray-200 bg-white p-3 text-xs shadow-lg dark:border-white/10 dark:bg-gray-900 dark:text-white"><span>{records.length} 个素材{failed ? '未能存入本机素材库，原文件保留' : '正在存入本机素材库'}</span>{failed && <button type="button" className="ml-3 underline" onClick={() => void retryStudioArchives()}>重试存入</button>}</div>
}
