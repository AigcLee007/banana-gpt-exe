import { DEFAULT_ECOMMERCE_BRIEF, normalizeEcommerceBrief, type EcommerceBrief } from './agentEcommerce'

export const ECOMMERCE_OPEN_EVENT = 'aap:agent-ecommerce-open'
export type EcommerceAssignment = { imageId: string; fit: 'contain' | 'cover'; syntheticPerson: boolean; width?: number; height?: number }
export interface EcommerceWorkspaceState {
  version: 1
  brief: EcommerceBrief
  sampleImageId: string | null
  sampleConfirmed: boolean
  assignments: Record<string,EcommerceAssignment>
  copy: string
  reviewed: boolean
}
type LocalStorage = Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>
export function requestEcommerceWorkspace() { window.dispatchEvent(new Event(ECOMMERCE_OPEN_EVENT)) }
export function ecommerceStorageKey(owner: number | undefined, conversationId: string) {
  return Number.isSafeInteger(owner) && owner! > 0 && /^[\w-]{1,128}$/.test(conversationId) ? `aap:ecommerce:v1:${owner}:${conversationId}` : null
}
export function createEcommerceWorkspace(): EcommerceWorkspaceState {
  return {version:1,brief:{...DEFAULT_ECOMMERCE_BRIEF},sampleImageId:null,sampleConfirmed:false,assignments:{},copy:'',reviewed:false}
}
function normalized(value: unknown): EcommerceWorkspaceState {
  const result=createEcommerceWorkspace()
  if (!value || typeof value !== 'object' || (value as {version?:unknown}).version!==1) return result
  const data=value as Partial<EcommerceWorkspaceState>
  result.brief=normalizeEcommerceBrief(data.brief)
  result.sampleImageId=typeof data.sampleImageId==='string' && data.sampleImageId.length<=256 ? data.sampleImageId : null
  result.sampleConfirmed=data.sampleConfirmed===true && !!result.sampleImageId
  result.copy=typeof data.copy==='string' ? data.copy.slice(0,40000) : ''
  result.reviewed=data.reviewed===true
  if(data.assignments && typeof data.assignments==='object') for(const [id,entry] of Object.entries(data.assignments).slice(0,20)) {
    if(!/^(MAIN|SECONDARY|DETAIL)-\d{2}$/.test(id) || !entry || typeof entry!=='object' || typeof entry.imageId!=='string' || entry.imageId.length>256) continue
    result.assignments[id]={imageId:entry.imageId,fit:entry.fit==='cover'?'cover':'contain',syntheticPerson:entry.syntheticPerson===true}
    if(Number.isInteger(entry.width) && Number.isInteger(entry.height) && entry.width!>=64 && entry.height!>=64 && entry.width!<=4096 && entry.height!<=4096 && entry.width!*entry.height!<=16000000) {
      result.assignments[id].width=entry.width;result.assignments[id].height=entry.height
    }
  }
  return result
}
export function loadEcommerceWorkspace(storage: LocalStorage, owner: number | undefined, conversationId: string) {
  const key=ecommerceStorageKey(owner,conversationId)
  if(!key) return createEcommerceWorkspace()
  try { return normalized(JSON.parse(storage.getItem(key)??'null')) } catch { return createEcommerceWorkspace() }
}
export function saveEcommerceWorkspace(storage: LocalStorage, owner: number | undefined, conversationId: string, value: EcommerceWorkspaceState) {
  const key=ecommerceStorageKey(owner,conversationId)
  if(!key) throw Error('账户或会话尚未就绪')
  storage.setItem(key,JSON.stringify(normalized(value)))
}
export function deleteEcommerceWorkspace(storage: LocalStorage, owner: number | undefined, conversationId: string) {
  const key=ecommerceStorageKey(owner,conversationId)
  if(key) storage.removeItem(key)
}
export function clearEcommerceWorkspaces(storage: LocalStorage, owner: number | undefined) {
  if(!Number.isSafeInteger(owner)||owner!<=0) return
  const prefix=`aap:ecommerce:v1:${owner}:`
  const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((key):key is string=>!!key?.startsWith(prefix))
  keys.forEach(key=>storage.removeItem(key))
}
export function collectEcommerceOutputs(tasks: Array<{id:string;agentConversationId?:string;outputImages?:string[];createdAt:number}>, conversationId: string) {
  const seen=new Set<string>(), result:Array<{imageId:string;taskId:string;label:string}>=[]
  for(const task of tasks.filter(item=>item.agentConversationId===conversationId).sort((a,b)=>a.createdAt-b.createdAt)) for(const imageId of task.outputImages??[]) {
    if(seen.has(imageId)) continue
    seen.add(imageId);result.push({imageId,taskId:task.id,label:`成图 ${result.length+1}`})
  }
  return result
}
