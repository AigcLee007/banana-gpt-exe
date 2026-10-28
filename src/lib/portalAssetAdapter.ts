export interface PortalAsset { id: string; kind: string; title: string; mime: string; contentUrl?: string }
export interface SelectedAsset { asset: PortalAsset; blob: Blob; text?: string }
export interface LocalAsset { id: string; title: string; kind: string; load: () => Promise<{ blob?: Blob; text?: string }> }
export interface AssetSave { blob?: Blob; text?: string; title: string; source: string; sourceRef?: string; category?: string }
export interface AssetAdapter { source: string; label: string; kinds: string[]; use: (items: SelectedAsset[]) => Promise<void>; local?: () => Promise<LocalAsset[]>; canUse?: () => boolean }
export interface PortalAssets { ready: Promise<void>; save: (input: AssetSave) => Promise<PortalAsset>; pick: (options: { kinds: string[]; multiple?: boolean; source: string }) => Promise<SelectedAsset[]>; open: () => void; register: (adapter: AssetAdapter) => () => void }

export function validateAssetSelection(items: SelectedAsset[], available: Record<string, number>) {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const kind = item.asset.kind
    if (!(kind in available)) throw new Error('当前创作不支持该素材类型')
    if (kind !== 'text' && (!item.blob?.size || !item.blob.type.startsWith(`${kind}/`))) throw new Error('素材文件类型与内容不符')
    counts[kind] = (counts[kind] || 0) + 1
    if (counts[kind] > available[kind]) throw new Error('所选素材数量超出当前创作上限')
  }
}

export function localAssetRows(rows: Array<LocalAsset & Record<string, unknown>>): LocalAsset[] {
  return rows.map(({ id, title, kind, load }) => ({ id, title, kind, load }))
}

export interface ArchiveRecord { id: string; owner: number; title: string; source: string; sourceRef: string; status: 'pending' | 'failed'; assetId?: string }
function archiveTitle(title: string) { return Array.from(title.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 200).join('') || '未命名素材' }
export function createArchiveQueue(deps: {
  owner: () => number | undefined;
  persist: (value: string) => void;
  load: (record: ArchiveRecord) => Promise<{ blob?: Blob; text?: string }>;
  save: (input: AssetSave) => Promise<{ id: string }>;
  changed?: () => void;
}, initial: ArchiveRecord[] = []) {
  let records: ArchiveRecord[] = initial.map(({ id, owner, title, source, sourceRef }) => ({ id, owner, title: archiveTitle(title), source, sourceRef, status: 'failed' }))
  const busy = new Set<string>()
  const publish = () => { try { deps.persist(JSON.stringify(records)) } catch { /* Native storage remains the recovery source. */ } deps.changed?.() }
  const sync = async (record: ArchiveRecord) => {
    if (record.owner !== deps.owner() || busy.has(record.id)) return
    busy.add(record.id)
    record.status = 'pending'; publish()
    try {
      const content = await deps.load(record)
      if (record.owner !== deps.owner()) { record.status = 'failed'; return }
      await deps.save({ ...content, title: record.title, source: record.source, sourceRef: record.sourceRef })
      records = records.filter(row => row !== record)
    } catch { record.status = 'failed' }
    finally { busy.delete(record.id); publish() }
  }
  return {
    records: () => records.filter(row => row.owner === deps.owner()).map(row => ({ ...row })),
    add: async (input: Pick<ArchiveRecord, 'id' | 'title' | 'source' | 'sourceRef'>) => {
      const owner = deps.owner()
      if (!owner || records.some(row => row.id === input.id && row.owner === owner)) return
      const record: ArchiveRecord = { id: input.id, title: archiveTitle(input.title), source: input.source, sourceRef: input.sourceRef, owner, status: 'pending' }
      records.push(record); publish(); await sync(record)
    },
    retry: async () => { for (const record of [...records]) await sync(record) },
  }
}
