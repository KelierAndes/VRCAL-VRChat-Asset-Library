import {AssetRecord} from '../shared/contracts';
import {projectAssets,projectionKeys} from './grouping';

interface ProjectedCard {record:AssetRecord;first:AssetRecord}

/** Incremental display projection. Identity and aggregation remain in grouping. */
export class ProjectionIndex {
  private readonly raw=new Map<string,AssetRecord>();
  private readonly order=new Map<string,number>();
  private readonly keys=new Map<string,string[]>();
  private readonly buckets=new Map<string,Set<string>>();
  private readonly byRaw=new Map<string,ProjectedCard>();
  private cards:ProjectedCard[]=[];
  private projected:AssetRecord[]=[];
  private nextOrder=0;

  constructor(records:AssetRecord[]) {
    for(const record of records){this.raw.set(record.id,record);this.order.set(record.id,this.nextOrder++);this.addKeys(record)}
    this.cards=projectAssets(records).map(record=>this.register(record));
    this.projected=this.cards.map(card=>card.record);
  }

  update(previous:AssetRecord|undefined,next:AssetRecord):void {
    const old=this.raw.get(next.id)??previous;
    const touched=new Set<string>([next.id,...(old?[old.id]:[])]);
    const affectedCards=new Set<ProjectedCard>();
    const seenKeys=new Set<string>();
    const pending=[...(old?(this.keys.get(old.id)??projectionKeys(old)):[]),...projectionKeys(next)];
    const ids=[...touched];
    let keyCursor=0,idCursor=0;
    const touch=(id:string)=>{if(!touched.has(id)){touched.add(id);ids.push(id)}};
    // Use both old and new buckets before replacing the raw row. A group may
    // bridge several keys; include every member and continue through its keys.
    while(keyCursor<pending.length||idCursor<ids.length){
      while(keyCursor<pending.length){
        const key=pending[keyCursor++];if(seenKeys.has(key))continue;seenKeys.add(key);
        for(const id of this.buckets.get(key)??[])touch(id);
      }
      while(idCursor<ids.length){
        const id=ids[idCursor++],card=this.byRaw.get(id);
        if(card&&!affectedCards.has(card)){
          affectedCards.add(card);
          for(const member of card.record.members??[card.record])touch(member.id);
        }
        pending.push(...(this.keys.get(id)??[]));
      }
    }

    if(old){this.removeKeys(old.id);if(old.id!==next.id){this.raw.delete(old.id);this.order.delete(old.id)}}
    if(!this.order.has(next.id))this.order.set(next.id,this.nextOrder++);
    this.raw.set(next.id,next);this.addKeys(next);

    for(const card of affectedCards)for(const member of card.record.members??[card.record])this.byRaw.delete(member.id);
    const records=[...touched].map(id=>this.raw.get(id)).filter((record):record is AssetRecord=>record!==undefined).sort((a,b)=>this.compare(a,b));
    const replacements=projectAssets(records).map(record=>this.register(record));
    this.cards=this.cards.filter(card=>!affectedCards.has(card));
    // Unchanged cards retain their objects. Insert only rebuilt cards at their
    // first raw path, the same order in which projectAssets creates groups.
    for(const replacement of replacements){
      let low=0,high=this.cards.length;
      while(low<high){const mid=(low+high)>>>1;if(this.compare(this.cards[mid].first,replacement.first)<=0)low=mid+1;else high=mid}
      this.cards.splice(low,0,replacement);
    }
    this.projected=this.cards.map(card=>card.record);
  }

  values():AssetRecord[] {return this.projected}
  get(id:string):AssetRecord|undefined {return this.byRaw.get(id)?.record}

  private compare(a:AssetRecord,b:AssetRecord):number {
    return a.path.localeCompare(b.path,'zh-CN')||(this.order.get(a.id)??0)-(this.order.get(b.id)??0);
  }

  private register(record:AssetRecord):ProjectedCard {
    const members=record.members??[record];
    let first=this.raw.get(members[0].id)!;
    for(const member of members){const raw=this.raw.get(member.id)!;if(this.compare(raw,first)<0)first=raw}
    const card={record,first};
    for(const member of members)this.byRaw.set(member.id,card);
    return card;
  }

  private addKeys(record:AssetRecord):void {
    const keys=projectionKeys(record);this.keys.set(record.id,keys);
    for(const key of keys){let ids=this.buckets.get(key);if(!ids){ids=new Set();this.buckets.set(key,ids)}ids.add(record.id)}
  }

  private removeKeys(id:string):void {
    for(const key of this.keys.get(id)??[]){const ids=this.buckets.get(key);ids?.delete(id);if(!ids?.size)this.buckets.delete(key)}
    this.keys.delete(id);
  }
}
