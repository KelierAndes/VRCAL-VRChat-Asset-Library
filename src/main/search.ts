import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {AssetRecord,AssetQuery,AssetPage,SearchEvidence,TagSummary,displayTitle,displayCategory,displayTags,displayAvatars} from '../shared/contracts';
import {extractBoothIds} from './matching';
import {isOrganizationalAsset} from './organization';

const normalized=new Map<string,string>();
export const normalizeSearch=(value:string)=>{const cached=normalized.get(value);if(cached!==undefined)return cached;const result=value.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();if(value.length<=1000&&normalized.size<20000)normalized.set(value,result);return result};
const collator=new Intl.Collator('zh-CN',{numeric:true});
type Field={field:SearchEvidence['field'];text:string;norm:string};
type Document={asset:AssetRecord;fields:Field[];text:string;groups:Set<string>;tags:string[];avatars:Set<string>;itemIds:Set<string>;hasCover:boolean;modified:number};
const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
function shortTokens(text:string):string {const result=new Set<string>();for(const match of text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu)){const chars=[...match[0]];for(let i=0;i<chars.length;i++){result.add(chars[i]);if(i+1<chars.length)result.add(chars[i]+chars[i+1])}}return [...result].join(' ')}
function quote(value:string):string{return '"'+value.replace(/"/g,'""')+'"'}
function trigrams(term:string):string[]{const chars=[...term];return chars.length>=3?[...new Set(chars.slice(0,-2).map((_char,index)=>chars.slice(index,index+3).join('')))]:[]}
function terms(search:string):string[]{const result=[...search.matchAll(/"([^"]+)"|(\S+)/g)].map(match=>normalizeSearch(match[1]||match[2])).filter(Boolean);if(result.length>100)throw new Error('搜索词过多，请减少到 100 个以内。');return result}
function sourceIds(value:string):string[]{try{const url=new URL(value);return /(?:^|\.)booth\.pm$/.test(url.hostname)?[...(url.pathname.match(/\/items\/(\d{1,12})(?:\/|$)/)?.slice(1)??[])]:[]}catch{return []}}

/** Rebuildable search data is separate from authoritative annotations. */
export class SearchIndex {
  private docs:Document[]=[];private byId=new Map<string,Document>();private sorted=new Map<string,Document[]>();private aliases:Record<string,string[]>={};
  private signature='';private available=true;private indexed=new Map<string,string>();private indexedShort=new Map<string,string>();private aliasKey='';private hashes=new Map<string,Buffer>();private rowIds=new Map<string,number|bigint>();
  private building=false;private pending?:NodeJS.Immediate;private closed=false;private idleWaiters:(()=>void)[]=[];
  constructor(private db:DatabaseSync){this.ensure();}
  get mode():'fts5'|'fallback'{return this.available?'fts5':'fallback'}
  async waitIdle():Promise<void>{while(this.building)await new Promise<void>(resolve=>this.idleWaiters.push(resolve))}
  close():void{this.closed=true;this.cancelBuild()}
  private cancelBuild():void {if(this.pending)clearImmediate(this.pending);this.pending=undefined;this.building=false;for(const resolve of this.idleWaiters.splice(0))resolve()}
  private ensure():void {try{const existing=this.db.prepare("SELECT sql FROM sqlite_master WHERE name='derived_search_fts'").get() as {sql:string}|undefined;if(existing&&!existing.sql.toLowerCase().includes('trigram'))this.db.exec('DROP TABLE IF EXISTS derived_search_fts;DROP TABLE IF EXISTS derived_search_state;DROP TABLE IF EXISTS derived_search_documents;DROP TABLE IF EXISTS derived_search_short');this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS derived_search_fts USING fts5(asset_id UNINDEXED,body,tokenize='trigram',detail=none,columnsize=0);CREATE VIRTUAL TABLE IF NOT EXISTS derived_search_short USING fts5(asset_id UNINDEXED,terms,tokenize='unicode61',detail=none,columnsize=0);CREATE TABLE IF NOT EXISTS derived_search_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);");}catch{this.available=false}}
  private recreate():void {try{this.db.exec('DROP TABLE IF EXISTS derived_search_fts;DROP TABLE IF EXISTS derived_search_short;DROP TABLE IF EXISTS derived_search_state;DROP TABLE IF EXISTS derived_search_documents;');this.available=true;this.ensure();this.signature='';}catch{this.available=false}}
  rebuild(records:AssetRecord[],aliases:Record<string,string[]>,memberGroups:ReadonlyMap<string,string>):void {
    records=records.filter(record=>!isOrganizationalAsset(record));
    const oldDocs=this.byId,aliasKey=JSON.stringify(aliases),reuseAliases=aliasKey===this.aliasKey;this.aliasKey=aliasKey;this.aliases=aliases;this.byId=new Map();const canonical=new Map<string,string>();for(const [name,values] of Object.entries(aliases))for(const value of [name,...values])canonical.set(normalizeSearch(value),name);
    this.docs=records.map(asset=>{
      const old=oldDocs.get(asset.id);if(old&&reuseAliases&&old.asset===asset){this.byId.set(asset.id,old);return old;}
      const fields:Field[]=[];const add=(field:Field['field'],text:string|undefined)=>{if(text)fields.push({field,text,norm:normalizeSearch(text)})};
      add('name',displayTitle(asset));add('name',asset.name);if(asset.online.title!==displayTitle(asset))add('name',asset.online.title);
      for(const member of asset.members??[])if(member.name!==asset.name&&member.name!==displayTitle(asset))add('member',member.name);for(const name of asset.localNameHints??[])add('member',name);
      add('author',asset.online.author);add('category',displayCategory(asset));
      const tags=[...new Set(displayTags(asset).map(tag=>canonical.get(normalizeSearch(tag))??tag))];for(const tag of displayTags(asset))add('tag',tag);for(const tag of tags){add('tag',tag);for(const alias of Array.isArray(aliases[tag])?aliases[tag]:[])add('tag',alias)}
      const avatars=new Set([...asset.localAvatars,...(asset.manual.avatars??[])]);for(const avatar of new Set([...avatars,...displayAvatars(asset)]))add('avatar',avatar);
      add('notes',asset.manual.notes);add('description',asset.online.description);
      for(const source of [asset.manual.sourceUrl,asset.online.url])if(source)add('description','来源 '+source);
      const itemIds=new Set([...extractBoothIds(asset.name),...sourceIds(asset.manual.sourceUrl??''),...sourceIds(asset.online.url??'')]);for(const id of itemIds)add('item-id',id);
      const groups=new Set([asset.group,...(asset.members??[]).map(member=>memberGroups.get(member.id)||asset.group)]),modified=Math.max(0,...[asset.mtimeMs,...(asset.members??[]).map(member=>member.mtimeMs)].filter((value):value is number=>typeof value==='number'&&Number.isFinite(value))),doc={asset,fields,text:[...new Set(fields.map(field=>field.norm))].join('\n'),groups,tags,avatars,itemIds,hasCover:!!(asset.manual.coverFile||asset.online.coverFile||asset.previewFile),modified};
      this.byId.set(asset.id,doc);return doc;
    });
    const rows=this.docs.map(doc=>[doc.asset.id,doc.text,this.indexed.get(doc.asset.id)===doc.text?this.indexedShort.get(doc.asset.id)??'':shortTokens(doc.text)] as const);
    const combined=Buffer.alloc(32),nextHashes=new Map<string,Buffer>();for(const [id,body,short] of rows){const digest=this.indexed.get(id)===body&&this.indexedShort.get(id)===short?this.hashes.get(id):undefined;const hash=digest??createHash('sha256').update(id).update('\0').update(body).update('\0').update(short).digest();nextHashes.set(id,hash);for(let i=0;i<32;i++)combined[i]^=hash[i]}const signature='native-v2:'+rows.length+':'+combined.toString('hex');this.hashes=nextHashes;
    if(this.available)try{if(this.building)this.fullWrite(rows,signature);else if(this.indexed.size)this.write(rows,signature,false);else{const saved=this.db.prepare("SELECT value FROM derived_search_state WHERE key='signature'").get() as {value:string}|undefined,count=(this.db.prepare('SELECT count(*) AS count FROM derived_search_fts').get() as {count:number}).count,shortCount=(this.db.prepare('SELECT count(*) AS count FROM derived_search_short').get() as {count:number}).count;if(saved?.value===signature&&count===rows.length&&shortCount===rows.filter(row=>!!row[2]).length){this.signature=signature;this.rowIds=new Map((this.db.prepare('SELECT rowid,asset_id FROM derived_search_fts').all() as {rowid:number;asset_id:string}[]).map(row=>[row.asset_id,row.rowid]));}else this.fullWrite(rows,signature);}}
    catch{this.recreate();if(this.available)try{this.fullWrite(rows,signature)}catch{this.available=false}}
    const membershipChanged=this.docs.length!==oldDocs.size||this.docs.some(doc=>!oldDocs.has(doc.asset.id)),nameChanged=membershipChanged||this.docs.some(doc=>{const old=oldDocs.get(doc.asset.id);return old&&old!==doc&&displayTitle(old.asset)!==displayTitle(doc.asset)});for(const [sort,order] of this.sorted){if(nameChanged||sort!=='name')this.sorted.delete(sort);else this.sorted.set(sort,order.map(doc=>this.byId.get(doc.asset.id)!));}this.indexed=new Map(rows.map(row=>[row[0],row[1]]));this.indexedShort=new Map(rows.map(row=>[row[0],row[2]]));
  }
  private fullWrite(rows:readonly (readonly [string,string,string])[],signature:string):void {
    if(rows.length<=1000){this.cancelBuild();this.write(rows,signature,true);return}this.cancelBuild();this.building=true;this.rowIds.clear();this.db.exec("DELETE FROM derived_search_fts;DELETE FROM derived_search_short;DELETE FROM derived_search_state WHERE key='signature';");let cursor=0;
    const insert=this.db.prepare('INSERT INTO derived_search_fts(asset_id,body) VALUES(?,?)'),insertShort=this.db.prepare('INSERT INTO derived_search_short(rowid,asset_id,terms) VALUES(?,?,?)');
    const next=()=>{this.pending=undefined;if(this.closed){this.cancelBuild();return}try{const until=performance.now()+15;this.db.exec('BEGIN');let batch=0;while(cursor<rows.length&&batch++<500){const row=rows[cursor++],result=insert.run(row[0],row[1]);this.rowIds.set(row[0],result.lastInsertRowid);if(row[2])insertShort.run(result.lastInsertRowid,row[0],row[2]);if(performance.now()>=until)break}if(cursor===rows.length)this.db.prepare("INSERT INTO derived_search_state(key,value) VALUES('signature',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(signature);this.db.exec('COMMIT');if(cursor===rows.length){this.signature=signature;this.cancelBuild()}else this.pending=setImmediate(next);}catch{if(this.db.isTransaction)this.db.exec('ROLLBACK');this.available=false;this.cancelBuild()}};
    this.pending=setImmediate(next);
  }
  private write(rows:readonly (readonly [string,string,string])[],signature:string,full=false):void {
    const own=!this.db.isTransaction;if(own)this.db.exec('BEGIN');
    try{const insert=this.db.prepare('INSERT INTO derived_search_fts(asset_id,body) VALUES(?,?)'),insertShort=this.db.prepare('INSERT INTO derived_search_short(rowid,asset_id,terms) VALUES(?,?,?)');const add=(row:readonly [string,string,string])=>{const result=insert.run(row[0],row[1]);this.rowIds.set(row[0],result.lastInsertRowid);if(row[2])insertShort.run(result.lastInsertRowid,row[0],row[2])};if(full){this.db.exec('DELETE FROM derived_search_fts;DELETE FROM derived_search_short');this.rowIds.clear();for(const row of rows)add(row)}else{const next=new Map(rows.map(row=>[row[0],row])),remove=this.db.prepare('DELETE FROM derived_search_fts WHERE rowid=?'),removeShort=this.db.prepare('DELETE FROM derived_search_short WHERE rowid=?');for(const [id,old] of this.indexed)if(next.get(id)?.[1]!==old||next.get(id)?.[2]!==this.indexedShort.get(id)){if(this.rowIds.has(id)){remove.run(this.rowIds.get(id)!);removeShort.run(this.rowIds.get(id)!);this.rowIds.delete(id)}}for(const row of rows)if(this.indexed.get(row[0])!==row[1]||this.indexedShort.get(row[0])!==row[2]||!this.rowIds.has(row[0]))add(row)}this.db.prepare("INSERT INTO derived_search_state(key,value) VALUES('signature',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(signature);if(own)this.db.exec('COMMIT');this.signature=signature;}
    catch(error){if(own)this.db.exec('ROLLBACK');throw error}
  }
  private candidates(searchTerms:string[]):Set<string>|undefined {
    if(!this.available||this.building)return undefined;const long=[...new Set(searchTerms.flatMap(trigrams))],short=searchTerms.filter(term=>[...term].length<3&&[...term].every(char=>cjk.test(char)));if(!long.length&&!short.length)return undefined;
    const lookup=()=>{let result:Set<string>|undefined;for(const [table,values] of [['derived_search_fts',long],['derived_search_short',short]] as const){if(!values.length)continue;const rows=this.db.prepare('SELECT asset_id FROM '+table+' WHERE '+table+' MATCH ?').all(values.map(quote).join(' AND ')) as {asset_id:string}[],ids=new Set(rows.map(row=>row.asset_id));result=result?new Set([...result].filter(id=>ids.has(id))):ids;}return result;};
    try{return lookup()}catch{const signature=this.signature;this.recreate();if(this.available)try{this.fullWrite([...this.indexed].map(([id,body])=>[id,body,this.indexedShort.get(id)??''] as const),signature);return this.building?undefined:lookup()}catch{this.available=false}return undefined}
  }
  private compare(sort:string):(a:Document,b:Document)=>number{return (a,b)=>(sort==='recent'?b.asset.updatedAt.localeCompare(a.asset.updatedAt):sort==='added'?b.asset.createdAt.localeCompare(a.asset.createdAt):sort==='added-asc'?a.asset.createdAt.localeCompare(b.asset.createdAt):sort==='modified'?b.modified-a.modified:sort==='modified-asc'?a.modified-b.modified:sort==='size'?b.asset.size-a.asset.size:0)||collator.compare(displayTitle(a.asset),displayTitle(b.asset))||a.asset.id.localeCompare(b.asset.id)}
  private order(sort:string):Document[]{let list=this.sorted.get(sort);if(list)return list;list=[...this.docs].sort(this.compare(sort));this.sorted.set(sort,list);return list}
  list(query:AssetQuery={},allowedIds?:ReadonlySet<string>):AssetPage {
    const searchTerms=terms(query.search??''),candidateIds=this.candidates(searchTerms),tag=normalizeSearch(query.tag??''),author=normalizeSearch(query.author??'');
    const tagMatches=(doc:Document)=>doc.tags.some(name=>normalizeSearch(name)===tag||(Array.isArray(this.aliases[name])?this.aliases[name]:[]).some(alias=>normalizeSearch(alias)===tag));
    const hits:Document[]=[];const scores=new Map<string,number>();
    const sort=query.sort??'name',ordered=this.order(sort==='relevance'?'name':sort),source=candidateIds?candidateIds.size<this.docs.length/4?[...candidateIds].map(id=>this.byId.get(id)).filter((doc):doc is Document=>!!doc):ordered.filter(doc=>candidateIds.has(doc.asset.id)):ordered;
    for(const doc of source){const asset=doc.asset;
      if(allowedIds&&!allowedIds.has(asset.id)&&!asset.members?.some(member=>allowedIds.has(member.id)))continue;
      if(query.view==='materials'&&asset.kind==='unity-project'||query.view==='projects'&&asset.kind!=='unity-project')continue;
      if(query.view==='manual'&&(asset.kind==='unity-project'||asset.manual.matchingMode!=='manual'))continue;
      if(query.view!=='manual'&&['pending','review','not-found','failed','blocked'].includes(query.status??'')&&asset.manual.matchingMode==='manual')continue;
      if(query.category&&displayCategory(asset)!==query.category||query.group&&!doc.groups.has(query.group)||query.avatar&&!doc.avatars.has(query.avatar))continue;
      if(query.favorite&&!asset.manual.favorite||query.status==='missing'&&!asset.missing||query.status&&query.status!=='missing'&&asset.online.status!==query.status&&asset.manual.projectStatus!==query.status)continue;
      if(tag&&!tagMatches(doc)||author&&!normalizeSearch(asset.online.author??'').includes(author)||query.hasCover!==undefined&&doc.hasCover!==query.hasCover||query.untagged&&doc.tags.length)continue;
      if(query.addedAfter&&asset.createdAt<query.addedAfter||query.addedBefore&&asset.createdAt>query.addedBefore)continue;
      let matched=true,score=0;
      for(const term of searchTerms){const field=doc.fields.find(entry=>entry.norm.includes(term));if(!field){matched=false;break}score+=field.field==='item-id'?100:field.field==='name'?20:field.field==='tag'?12:5;if(doc.itemIds.has(term))score+=1000}
      if(!matched)continue;hits.push(doc);if(searchTerms.length)scores.set(asset.id,score);
    }
    if(sort==='relevance'||candidateIds&&candidateIds.size<this.docs.length/4)hits.sort(sort==='relevance'?(a,b)=>(scores.get(b.asset.id)??0)-(scores.get(a.asset.id)??0)||this.compare('name')(a,b):this.compare(sort));
    if(searchTerms.some(term=>/^\d+$/.test(term)))hits.sort((a,b)=>Number(searchTerms.some(term=>b.itemIds.has(term)))-Number(searchTerms.some(term=>a.itemIds.has(term))));
    const offset=Math.max(0,Number(query.offset)||0),limit=Math.max(1,Math.min(5000,Number(query.limit)||1000));
    return {items:hits.slice(offset,offset+limit).map(doc=>{const reasons:SearchEvidence[]=[];for(const term of searchTerms){const field=doc.fields.find(entry=>entry.norm.includes(term));if(!field)continue;const start=Math.max(0,field.norm.indexOf(term)-35);reasons.push({field:field.field,text:field.text.slice(start,start+180)});if(doc.itemIds.has(term))reasons.unshift({field:'item-id',text:term})}return {...doc.asset,searchEvidence:reasons.length?reasons.slice(0,6):undefined}}),total:hits.length};
  }
  tags():TagSummary[]{const counts=new Map<string,number>();for(const doc of this.docs)for(const tag of new Set(doc.tags))counts.set(tag,(counts.get(tag)||0)+1);return [...counts].map(([name,count])=>({name,count,aliases:this.aliases[name]??[]})).sort((a,b)=>collator.compare(a.name,b.name))}
}
