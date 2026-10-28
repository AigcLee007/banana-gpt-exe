import { describe, expect, it } from 'vitest'
import { ecommerceStorageKey, loadEcommerceWorkspace, saveEcommerceWorkspace, clearEcommerceWorkspaces, collectEcommerceOutputs, createEcommerceWorkspace } from './agentEcommerceWorkspace'

function storage() {
  const data = new Map<string,string>()
  return { getItem: (key:string) => data.get(key) ?? null, setItem: (key:string,value:string) => { data.set(key,value) }, removeItem: (key:string) => { data.delete(key) }, key: (index:number) => [...data.keys()][index] ?? null, get length() { return data.size } }
}
describe('managed ecommerce workspace isolation', () => {
  it('fails closed without a valid Portal owner or conversation', () => {
    expect(ecommerceStorageKey(undefined,'conversation')).toBeNull()
    expect(ecommerceStorageKey(0,'conversation')).toBeNull()
    expect(ecommerceStorageKey(8,'')).toBeNull()
  })
  it('persists one conversation without sharing across owners or conversations', () => {
    const db=storage(), value=createEcommerceWorkspace()
    value.brief.productName='冲锋衣'; value.copy='用户文案'
    saveEcommerceWorkspace(db,8,'a',value)
    expect(loadEcommerceWorkspace(db,8,'a').brief.productName).toBe('冲锋衣')
    expect(loadEcommerceWorkspace(db,9,'a').brief.productName).toBe('')
    expect(loadEcommerceWorkspace(db,8,'b').copy).toBe('')
  })
  it('drops unsafe assignments and secrets in stored payloads', () => {
    const db=storage()
    db.setItem(ecommerceStorageKey(8,'a')!,JSON.stringify({version:1,brief:{productName:'衣服',apiKey:'PRIVATE'},assignments:{'../unsafe':{imageId:'x'},'MAIN-01':{imageId:'image',fit:'cover',syntheticPerson:true}},sampleImageId:'image',sampleConfirmed:true,copy:'描述',apiKey:'PRIVATE'}))
    const loaded=loadEcommerceWorkspace(db,8,'a')
    expect(loaded.assignments).toEqual({'MAIN-01':{imageId:'image',fit:'cover',syntheticPerson:true}})
    expect(JSON.stringify(loaded)).not.toContain('PRIVATE')
  })
  it('clears only the selected owner auxiliary records', () => {
    const db=storage(), value=createEcommerceWorkspace()
    saveEcommerceWorkspace(db,8,'a',value); saveEcommerceWorkspace(db,9,'a',value)
    clearEcommerceWorkspaces(db,8)
    expect(db.getItem(ecommerceStorageKey(8,'a')!)).toBeNull()
    expect(db.getItem(ecommerceStorageKey(9,'a')!)).not.toBeNull()
  })
  it('exposes current conversation outputs only, deduplicated and in round order', () => {
    const tasks=[{id:'t1',agentConversationId:'a',outputImages:['one','two'],createdAt:20},{id:'t2',agentConversationId:'b',outputImages:['private'],createdAt:10},{id:'t3',agentConversationId:'a',outputImages:['two','three'],createdAt:30}]
    expect(collectEcommerceOutputs(tasks,'a').map(item=>item.imageId)).toEqual(['one','two','three'])
  })
  it('preserves validated custom export dimensions and drops invalid overrides', () => {
    const db=storage(), value=createEcommerceWorkspace()
    value.assignments={'MAIN-01':{imageId:'one',fit:'contain',syntheticPerson:false,width:3000,height:2000},'DETAIL-01':{imageId:'two',fit:'contain',syntheticPerson:false,width:99999,height:0}}
    saveEcommerceWorkspace(db,8,'a',value)
    expect(loadEcommerceWorkspace(db,8,'a').assignments['MAIN-01']).toMatchObject({width:3000,height:2000})
    expect(loadEcommerceWorkspace(db,8,'a').assignments['DETAIL-01']).not.toHaveProperty('width')
  })
})
