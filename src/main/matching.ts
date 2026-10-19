import type { ProductCandidate } from '../shared/contracts';

export interface SearchClue {query:string;author?:string;requiresConfirmation?:boolean}
export type MatchingCandidate=ProductCandidate&{authorAliases?:string[]};
export const MATCH_RULE_VERSION='1.9.0';

const AVATARS=new Set(['airi','chiffon','chocolat','chocolate','eku','kaguya','misaki','shinano','shiano','shano','shinra','manuka','moe','kikyo','lime','maya','selestia','rindo','sio','mayo','milltina','lumina','kumaly','mizuki','ramune','milfy','rurune','lasyusha','minase','sakura','plum','愛莉','爱莉','シフォン','ショコラ','巧克力','エク','艾可','カグヤ','輝夜','辉夜','ミサキ','美咲','しなの','信濃','信浓','しあの','森羅','森罗','マヌカ','萌香','萌','桔梗','ライム','舞夜','マヤ','セレスティア','赛莉丝蒂娅','竜胆','龙胆','しお','まよ','ミルティナ','米露缇娜','ルミナ','クマリ','瑞希','ラムネ','ミルフィ','ルルネ','ラシューシャ','水瀬','水濑','ミナセ','桜','櫻','プラム','萌奈','キプフェル']);
const GENERIC=new Set(['dress','hair','outfit','clothes','clothing','model','avatar','asset','assets','material','materials','pack','all','fullset','texture','textures','download','downloads','newfolder','衣装','服装','素材','模型','アバター','饰品','装飾','鞋子','头发','髪型','髪','贴图']);
const compact=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const unique=(values:string[])=>[...new Set(values.filter(Boolean))];
export function boothProductId(raw:string|undefined):string|undefined {
  try{const url=new URL(raw??'');return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&/(?:^|\.)booth\.pm$/i.test(url.hostname.replace(/\.$/,''))?url.pathname.match(/\/items\/([1-9]\d{0,11})(?:\/|$)/)?.[1]:undefined;}catch{return undefined;}
}
export function canonicalSourceKey(raw:string):string {
  const id=boothProductId(raw);if(id)return 'booth:'+id;
  try{const url=new URL(raw);url.hash='';return url.href;}catch{return raw;}
}
export function canonicalCreator(value:string):string {return compact(value);}
export function packageClue(name:string):{name:string;version?:string;author?:string}|undefined {
  const stem=bareStem(name);
  const scoped=stem.match(/^((?:com|net|org|io|dev|jp|me)\.[a-z0-9._-]+?)@(\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.-]+)?)(?:@([\p{L}\p{N}._-]+))?$/iu);
  if(scoped)return {name:scoped[1],version:scoped[2],author:scoped[3]};
  return undefined;
}
export function fileVersion(name:string):string|undefined {
  const packaged=packageClue(name);if(packaged?.version)return packaged.version;
  const stem=bareStem(name);return stem.match(/(?:^|[\s_.-])(?:v\.?|ver(?:sion)?\.?)\s*(\d+(?:\.\d+)*[a-z]?)(?=$|[\s_@()-])/i)?.[1]??stem.match(/[_\s-](\d+(?:\.\d+)+)[a-z]?\s*$/i)?.[1];
}

function isDate(value:string):boolean {
  if(!/^\d{8}$/.test(value))return false;
  const year=Number(value.slice(0,4)),month=Number(value.slice(4,6)),day=Number(value.slice(6,8));
  if(year<1900||year>2099||month<1||month>12||day<1||day>31)return false;
  const date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}

/** Filename IDs remain conservative; a short number needs an explicit BOOTH/item label. */
export function extractBoothIds(name:string):string[] {
  const value=name.normalize('NFKC');
  const labelled=[...value.matchAll(/(?<![\p{L}\p{N}])(?:booth(?:[\s_:/#-]*(?:items?|id))?|items?|商品(?:番号|\s*id))[\s_:/#=-]*(\d{1,12})(?!\d)/giu)].map(match=>match[1]);
  const unlabelled=[...value.matchAll(/(?<![\p{L}\p{N}])(\d{6,12})(?!\d)/gu)].filter(match=>{
    if(isDate(match[1]))return false;
    if(/(?:^|[\s_-])(?:v\.?|ver(?:sion)?\.?)?\d+(?:\.\d+)*\.$/i.test(value.slice(0,match.index)))return false;
    const month=match[1].match(/^(19\d{2}|20\d{2})(0[1-9]|1[0-2])$/);
    return !(month&&(match.index??0)>0&&/^(?:\.(?:zip|rar|7z|unitypackage))?$/.test(value.slice((match.index??0)+match[1].length)));
  }).map(match=>match[1]);
  return unique([...labelled,...unlabelled]);
}

function bareStem(name:string):string {
  return name.normalize('NFKC').replace(/\.(?:zip|rar|7z|unitypackage)$/i,'').replace(/\s*\(\d+\)\s*$/,'').trim();
}
function authorSuffix(value:string):string {
  // @Shop_v1.2 and @Shop_1234567 contain download suffixes, not shop aliases.
  let author=value;
  for(;;){const next=author.replace(/[_-](?:v\.?|ver(?:sion)?\.?)\s*\d+(?:\.\d+)*[a-z]?$/i,'').replace(/[_-]\d{6,12}(?:[_-].*)?$/,'').replace(/[_-](?:full[_-]?set|unitypackage)$/i,'').replace(/[_-]+$/,'');if(next===author)return author;author=next;}
}
export function creatorClue(name:string):string|undefined {
  const packaged=packageClue(name);if(packaged)return packaged.author;
  const raw=bareStem(name).match(/@([\p{L}\p{N}._-]+)/u)?.[1];return raw?authorSuffix(raw)||undefined:undefined;
}

function bracketNoise(content:string):boolean {
  const plain=content.normalize('NFKC').trim().toLowerCase();
  if(/^(?:free\s*[/／]\s*無料|無料\s*[/／]\s*free|free|無料|無償)$/i.test(plain))return true;
  // Match whole labels, never substrings: Fallen Angel and Backpack are names.
  if(/^(?:full\s*set|all|all\s*(?:avatars?|models?)|pack|全アバター|全対応|セール|sale|\d+\s*%\s*off|(?:v\.?|ver(?:sion)?\.?)\s*\d+(?:\.\d+)*)$/i.test(plain))return true;
  if(/^(?:\d+\s*(?:アバター|モデル|avatars?|models?)\s*(?:対応|supported)?|(?:全|複数)(?:アバター|モデル)対応)$/i.test(plain))return true;
  const avatarWords=plain.replace(/(?:対応|専用|用|supported|avatars?|models?)/gi,' ').split(/[\s,/|+&・_-]+/).filter(Boolean);
  return avatarWords.length>0&&avatarWords.every(word=>AVATARS.has(word));
}
function deduplicate(value:string):string {
  const parts=value.split(/\s+/).filter(Boolean),keys=parts.map(compact);
  for(let period=2;period<=Math.floor(parts.length/2);period++){
    if(parts.length%period||keys.slice(0,period).join('').length<8)continue;
    if(keys.every((key,index)=>key===keys[index%period]))return parts.slice(0,period).join(' ');
  }
  return value;
}
function withoutAvatarListPrefix(value:string):string {
  let remaining=value.trim(),count=0,separators='';
  for(;;){
    const token=remaining.match(/^([\p{L}\p{N}]+)([\s,/_+&|・:=-]+)(.+)$/u);
    if(!token||!AVATARS.has(token[1].toLowerCase()))break;
    count++;separators+=token[2];remaining=token[3].trim();
  }
  // A list such as Kaguya,Mizuki,Rurune_ describes local variants. An ordinary
  // title beginning with "Airi Dress" or "Maya Moe" remains significant.
  return count>=2&&/[,/_+&|・-]/.test(separators)&&remaining&&!AVATARS.has(remaining.toLowerCase())?remaining:value;
}
function clean(name:string):string {
  let value=bareStem(name).replace(/@([\p{L}\p{N}._-]+)/gu,' ');
  value=value.replace(/\bFREE\s*[/／]\s*無料|無料\s*[/／]\s*FREE\b/gi,' ');
  value=value.replace(/[\[【「『]([^\]】」』]*)[\]】」』]/gu,(_whole,content:string)=>bracketNoise(content)?' ':' '+content+' ');
  value=withoutAvatarListPrefix(value);
  value=value.replace(/(?:セール開催中|セール中|期間限定セール|キャンペーン中)[!！]*/g,' ').replace(/\b\d+\s*%\s*OFF\b/gi,' ');
  // Break filename separators before word-boundary filters so _Airi_v1.2 works.
  value=value.replace(/[_()[\]{}【】「」『』]/g,' ').replace(/[^\p{L}\p{N}\s.%-]/gu,' ');
  value=value.replace(/\b(?:v\.?|ver(?:sion)?\.?)\s*\d+(?:\.\d+)*[a-z]?\b/gi,' ').replace(/(?<![\p{L}\p{N}])\d+(?:\.\d+)+(?![\p{L}\p{N}])/gu,' ');
  value=value.replace(/(?:\bbooth\b(?:\s*(?:items?|id))?|\bitems?\b|商品(?:番号|\s*id))\s*\d{1,12}\b/giu,' ');
  value=value.replace(/(?<![\p{L}\p{N}])\d{6,12}(?!\d)/gu,' ');
  value=value.replace(/\b(?:full\s*set|unitypackage|unity|vrc|vrchat|download|booth)\b/gi,' ').replace(/\.(?!\d)/g,' ').replace(/\s+/g,' ').trim();
  const parts=value.split(/\s+/).filter(Boolean);
  // Avatar-only suffixes and "for Airi" describe a local variant. Product words
  // such as Summer/Winter or 萌え remain significant.
  while(parts.length>1&&AVATARS.has(parts.at(-1)!.toLowerCase())){parts.pop();if(parts.at(-1)?.toLowerCase()==='for')parts.pop();}
  value=parts.join(' ').replace(/\s+/g,' ').trim();
  return deduplicate(value).slice(0,140);
}

export function searchClue(name:string):SearchClue {const packaged=packageClue(name);return packaged?{query:packaged.name.slice(0,100),author:packaged.author}:{query:clean(name).slice(0,100),author:creatorClue(name)};}

/** The author-prefix alternative is only evidence after a candidate verifies it. */
export function searchClues(name:string):SearchClue[] {
  const primary=searchClue(name),result=[primary];
  if(!primary.author){
    const stem=bareStem(name),prefix=stem.match(/^([^_\s]{2,50})(?:_|\s+-\s+)(.+)$/u)??stem.match(/^([^_\s]{1,24}-[^_\s]{1,24})\s+(.+)$/u);
    if(prefix&&!AVATARS.has(prefix[1].toLowerCase())&&!/^\d+$/.test(prefix[1])&&!GENERIC.has(compact(prefix[1]))){
      const alternative=searchClue(prefix[2]);
      if(alternative.query&&compact(alternative.query)!==compact(primary.query))result.push({query:alternative.query,author:prefix[1]});
    }
  }
  // A material-only companion package can reveal the product name for search,
  // but dropping its content suffix never proves it is the complete product.
  for(const clue of [...result]){
    const query=clue.query.replace(/\s+materials?\s*pack$/i,'').trim();
    if(query!==clue.query&&meaningful(query))result.push({...clue,query,requiresConfirmation:true});
  }
  return result;
}

/** Three bounded public searches. Prefixes remain hypotheses until a product verifies its shop. */
export function searchQueries(name:string):string[] {
  const clues=searchClues(name),prefix=clues.find(clue=>clue.author&&!clue.requiresConfirmation),primary=clues[0];
  const companion=clues.find(clue=>clue.requiresConfirmation&&!clue.author);if(companion)return unique([primary.query,companion.query]).slice(0,3);
  return unique([...(prefix?[prefix.query+' '+prefix.author,prefix.query]:[primary.author?primary.query+' '+primary.author:primary.query]),primary.query,...clues.map(clue=>clue.query)].filter(query=>compact(query).length>=4)).slice(0,3);
}

function meaningful(value:string):boolean {const key=compact(value);return key.length>=4&&!GENERIC.has(key);}
function wordTokens(value:string):string[] {return unique(value.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>1));}

function japaneseNoteIdentity(value:string):{main:string;note:string}|undefined {
  // Download/version wrappers are not explanatory notes. Remove only recognized
  // whole labels and this exact shared category label, preserving other Japanese
  // qualifiers (for example a color or a different product classification).
  const stem=bareStem(value).replace(/\(([^()]*)\)/gu,(whole,content:string)=>bracketNoise(content)?' ':whole).replace(/【テクスチャ素材】/g,' ');
  const notes=[...stem.matchAll(/\(([^()]*)\)/gu)];
  // A single explanatory note can differ; option lists and multiple notes cannot.
  if(notes.length!==1)return;
  const note=notes[0][1].trim();
  if(!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヵヶ・\s]+$/u.test(note)||!/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(note))return;
  // Keep editions, model/size/color labels and seasonal options significant.
  if(/型|式|タイプ|モデル|サイズ|版|バージョン|バリエーション|仕様|専用|対応|限定|色|カラー|白|黒|赤|青|緑|黄|灰|紫|茶|金|銀|紅|翠|蒼|桃|ピンク|オレンジ|ホワイト|ブラック|レッド|ブルー|グリーン|シルバー|ゴールド|冬|夏|春|秋/u.test(note))return;
  const index=notes[0].index??0,main=clean(stem.slice(0,index)+' '+stem.slice(index+notes[0][0].length));
  if(!/^[A-Za-z0-9\s-]+$/.test(main)||(main.match(/[A-Za-z]/g)?.length??0)<8||!meaningful(main))return;
  return {main:compact(main),note:compact(note)};
}
function compatibleItemNote(name:string,candidate:MatchingCandidate):boolean {
  const ids=extractBoothIds(name);if(ids.length!==1)return false;
  try{
    const url=new URL(candidate.url);
    if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!/(?:^|\.)booth\.pm$/i.test(url.hostname.replace(/\.$/,'')))return false;
    if(url.pathname.match(/\/items\/([1-9]\d{0,11})(?:\/|$)/)?.[1]!==ids[0])return false;
  }catch{return false;}
  const local=japaneseNoteIdentity(name),remote=japaneseNoteIdentity(candidate.title);
  return !!local&&!!remote&&local.main===remote.main&&(local.note.includes(remote.note)||remote.note.includes(local.note));
}

export function candidateScore(name:string,candidate:MatchingCandidate):number {
  const clues=searchClues(name),primary=clues[0];
  const authors=unique([candidate.author??'',...(candidate.authorAliases??[])].map(compact));
  if(primary.author&&!authors.includes(compact(primary.author)))return 0;
  const allowed=clues.filter((clue,index)=>(index===0||clue.requiresConfirmation||!!clue.author&&authors.includes(compact(clue.author)))&&(!clue.author||authors.includes(compact(clue.author))));
  // Concatenated author/title names can only split against verified aliases.
  const original=clean(name),alias=authors.filter(author=>author.length>=2&&compact(original).startsWith(author)&&compact(original).length>author.length).sort((a,b)=>b.length-a.length)[0];
  if(alias){let end=0,key='';for(const character of original){end+=character.length;key+=compact(character);if(key===alias)break;}allowed.push({query:original.slice(end).replace(/^[\s_-]+/,'')});}
  const titles=unique([candidate.title,...(candidate.titleAliases??[])]).map(clean).filter(meaningful);
  if(!titles.length)return 0;
  // Only an already corresponding filename item ID permits a small explanatory
  // Japanese-note difference. This never raises ordinary partial-name scores.
  let best=compatibleItemNote(name,candidate) ? .97 : 0;
  for(const title of titles)for(const clue of allowed){
    const b=compact(title);
    const a=compact(clue.query);if(!meaningful(clue.query))continue;
    if(a===b){if(!clue.requiresConfirmation)return 1;best=Math.max(best,.89);continue;}
    // A substring can be a different edition. Keep partial similarity below
    // the queue's .95 automatic-match threshold, even for a verified author.
    if(Math.min(a.length,b.length)>=6&&(a.includes(b)||b.includes(a)))best=Math.max(best,.89);
    const aa=wordTokens(clue.query),bb=wordTokens(title);
    if(aa.length&&bb.length){const overlap=aa.filter(token=>bb.includes(token)).length;best=Math.max(best,Math.min(.89,2*overlap/(aa.length+bb.length)));}
  }
  return best;
}

/** Identity IDs do not require transliterated title agreement, but contradictions still need review. */
export function filenameIdentityConflict(name:string,candidate:MatchingCandidate):boolean {
  const authors=unique([candidate.author??'',...(candidate.authorAliases??[])].map(compact));
  const author=creatorClue(name);if(author&&authors.length&&!authors.includes(compact(author)))return true;
  const clues=searchClues(name),prefix=clues.find(clue=>clue.author&&!clue.requiresConfirmation);
  if(prefix&&authors.length&&!authors.includes(compact(prefix.author!))&&candidateScore(prefix.query,candidate)>=.95)return true;
  return meaningful(clues[0].query)&&candidateScore(name,candidate)===0;
}
