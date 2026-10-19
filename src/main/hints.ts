import {CATEGORIES,Category} from '../shared/contracts';

export function normalizeName(value:string):string {
  return value.normalize('NFKC').toLowerCase().replace(/\.(zip|rar|7z|unitypackage)$/i,'')
    .replace(/\bfull\s*set\b/gi,' ').replace(/(?:ver(?:sion)?|\bv)\s*[\d.]+/gi,' ').replace(/\b\d{6,9}\b/g,' ')
    .replace(/[\[\]【】（）()_@#|.,!~～\-]/g,' ').replace(/\s+/g,' ').trim();
}
const CLOTHING=/\b(?:outfits?|clothes|clothing|costumes?|dress(?:es)?|shirts?|t\s*shirts?|lingerie|pajamas?|pyjamas?|hoodies?|jackets?|coats?|skirts?|pants?|trousers?|shorts?|sweaters?|cardigans?|blouses?|corsets?|bodysuits?|jumpsuits?|swimwear|swimsuits?|bikinis?|underwear|panties|bras?|uniforms?|sailor|lolita|yukata|kimonos?|cheongsams?|qipao|shoes?|boots?|sneakers?|heels?|stockings?|socks?)\b|衣装|衣裝|服装|服裝|衣服|洋服|水着|泳装|泳裝|连衣裙|連衣裙|裙|礼服|禮服|衬衫|襯衫|卫衣|衛衣|外套|夹克|夾克|制服|和服|浴衣|旗袍|内衣|內衣|连体|連體|靴|鞋|袜|襪|黑丝|黑絲|パーカー|ブラウス|ジャケット|コート|トップス|ボトムス|タイツ|セーラー|セーター|スカート|ワンピース|ドレス|ランジェリー|コスチューム|ストッキング|ビキニ|ロリ(?:ー|ィ)?タ|ゴスロリ|甘ロリ|クラロリ|衣類|의상|옷|후드|드레스/;
const TEXTURE=/\btextures?\b|\bmake\s*up\b|\btattoos?\b|\bbody\s*paint\b|\bskin\b|アイテクスチャ|テクスチャ|贴图|貼圖|纹身|紋身|妆容|メイク/;
const HAIR=/\bhair(?:styles?)?\b|\bpigtails?\b|twintail|twin[ _-]?tail|ponytail|ヘア|髪型|髪|发型|髮型|头发|頭髮|頭髪/;
const ACCESSORY=/\b(?:accessor(?:y|ies)|earrings?|nails?|rings?|halo|weapons?|swords?|masks?|glasses|goggles|bracelets?|necklaces?|chokers?|piercings?|crowns?)\b|hair[ _-]*(?:clips?|pins?|ornaments?|accessor)|ヘアピン|髪飾り|发夹|髮夾|发饰|髮飾|アクセサリ|装飾品|裝飾品|ネイル|指輪|眼镜|眼鏡|美甲|手链|手鏈|项链|項鏈|ピアス|武器|刀|鎌|饰品|飾品|口罩|光环|光環/;
const TOOL=/\b(?:toolkit|tools?|shaders?|optimizers?|editor|exporters?|obfuscator|converters?|light\s*controller|baker|patcher|face\s*tracking)\b|スクリプト|ツール|工具|优化器|編輯器|编辑器|密码锁|蓝图锁/;
function categoryText(value:string):string {
 return value.normalize('NFKC').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_./\\-]/g,' ').toLowerCase()
  .replace(/(?:衣装|衣裝|服装|服裝|衣服)(?:専用|专用|專用|用|向け|対応)(?:の)?/g,' ')
  .replace(/(?:适用于|適用於|用于|用於|对应|對應)(?:衣装|衣裝|服装|服裝|衣服)/g,' ')
  .replace(/\b(?:compatible\s+with|(?:works?|used|use)\s+with|for)\s+(?:any\s+|your\s+|the\s+|[a-z]+\s+){0,4}(?:outfits?|clothes|clothing|dress(?:es)?|costumes?)\b/g,' ');
}
/** Clothing names describe the whole outfit before subsidiary ears, ribbons or accessories. */
export function inferCategory(value:string):Category {
 const name=categoryText(value);if(isAvatarName(value))return '模型';
 if(/\b(?:manual\s*baker|editor\s*patcher|hierarchy\s*decorator|av3\s*emulator|ma2bt|vrm\s*phy\s*b\s*to\s*spring\s*b)\b/.test(name)||TOOL.test(name))return '工具';
 if(CLOTHING.test(name))return '服装';
 if(TEXTURE.test(name))return '贴图';
 if(ACCESSORY.test(name))return '饰品';
 if(HAIR.test(name))return '头发';
 if(/\b(?:maid|pajamas?)\b|女仆|女僕|睡衣|修女|メイド服/.test(name))return '服装';
 if(/\b(?:motions?|animations?|go\s*go\s*loco|afk|posing)\b|ポーズ|モーション|动作|姿势/.test(name))return '动作';
 if(/\b(?:lil\s*toon|modular\s*avatar|vrc\s*fury)\b/.test(name))return '工具';
 if(/\b(?:particles?|gimmicks?|effects?|nade|kiss\s*system)\b|キス|ギミック|パーティクル|特效|音效|撫で|魔法/.test(name))return '特效';
 if(/\b(?:ears?|tails?|ribbons?)\b|耳朵|尻尾|尾巴|リボン/.test(name))return '饰品';
 if(/\boriginal\s*3d\b|\b3d\s*models?\b|3d\s*モデル|オリジナル.*モデル|\bavatar\s*models?\b|アバター.*本体|角色模型/.test(name))return '模型';
 return '未分类';
}
/** Legacy category compatibility never changes another deliberate manual category. */
export function normalizeCategory(value:unknown):Category|undefined {const normalized=value==='鞋子'?'服装':value;return typeof normalized==='string'&&CATEGORIES.includes(normalized as Category)?normalized as Category:undefined}
/** Shallow child names help opaque wrappers only when their product categories agree. */
export function inferLocalCategory(name:string,localNameHints:readonly string[]=[]):Category {
 const own=inferCategory(name);if(own!=='未分类')return own;const categories=new Set<Category>();
 for(const hint of localNameHints){const normalized=categoryText(hint);if(/\b(?:materials?|materialpack|textures?|tex|psd|uv|readme|licenses?|lil\s*toon|shaders?)\b|マテリアル|材质|材質|贴图|貼圖|说明|說明/.test(normalized))continue;const category=inferCategory(hint);if(category!=='未分类')categories.add(category)}
 return categories.size===1?[...categories][0]:'未分类';
}
export interface ProductCategoryHints {title?:string;tags?:readonly string[];description?:string;categories?:readonly string[]}
/** Product identity precedes its long descriptions, which also list avatars, shaders and other goods. */
export function inferProductCategory(hints:ProductCategoryHints):Category {
 const official=officialProductCategory(hints.categories||[]);if(official)return official.category;
 const title=hints.title||'',titleCategory=inferCategory(title),weakTitle=titleCategory==='饰品'&&!ACCESSORY.test(categoryText(title));
 if(titleCategory!=='未分类'&&!weakTitle)return titleCategory;
 let description=(hints.description||'').normalize('NFKC').replace(/https?:\/\/\S+/g,'');
 const titleIdentity=normalizeName(title);
 const namedGarmentNotice=/(?:『([^』\n]{2,80})』|「([^」\n]{2,80})」|["“]([^"”\n]{2,80})["”])\s*(?:衣装|衣裝|服装|服裝|의상)\s*(?:に関する注意事項|について|使用上の注意|相关说明|相關說明|相关注意事项|相關注意事項|관련\s*주의사항)/g;
 const garmentNotices=[...description.matchAll(namedGarmentNotice)];
 // A notice explicitly naming another item starts reference information, not this product's identity.
 const otherProductNotice=garmentNotices.find(match=>{const named=normalizeName(match[1]||match[2]||match[3]);return titleIdentity&&named&&!titleIdentity.includes(named)});
 if(otherProductNotice)description=description.slice(0,otherProductNotice.index);
 const ownTypes:[Category,RegExp][]=[
  ['头发',/\bthis\s+(?:hair(?:style)?|hairstyle)\b|この(?:髪型|ヘア)|本商品は[^\n。]{0,80}(?:髪型|ヘア)(?:です|になります)/i],
  ['饰品',/\bthis\s+(?:accessory|necklace|choker|earrings?)\b|本商品は[^\n。]{0,80}アクセサリ(?:です|になります)/i],
  ['贴图',/\bthis\s+(?:texture|makeup|tattoo)\b|このテクスチャ|本商品は[^\n。]{0,80}テクスチャ(?:です|になります)/i],
  ['服装',/\bthis\s+(?:outfit|costume|clothing|dress)\b|この(?:衣装|衣裝|コスチューム)|本衣装|本衣裝|衣装の他には含まれて|(?:本商品|本製品)[^\n。]{0,80}(?:衣装|衣裝)(?:です|になります)|(?:this product|this item)\s+(?:is\s+|includes?\s+|contains?\s+)[^\n.]{0,80}\b(?:clothing|outfit|costume|dress)\b/i]
 ];
 const ownType=ownTypes.find(([,pattern])=>pattern.test(description));if(ownType)return ownType[0];
 // A named garment notice identifies this product, unlike a list of clothes used in photos.
 // Several BOOTH shops put the avatar list before all of their garment instructions.
 for(const match of garmentNotices.filter(match=>match.index<description.length)){
  const named=normalizeName(match[1]||match[2]||match[3]);if(named&&titleIdentity.includes(named))return '服装';
 }
 // Require two independent wearing instructions; a lone compatible garment or sample credit is insufficient.
 const instructionLines=description.split(/\n|。/).filter(line=>!/(?:サンプル|撮影|参考|他の商品|対応衣装|sample|photo|credits?|recommended\s+outfits?)/i.test(line));
 const wearingInstruction=instructionLines.some(line=>/(?:コート|上着|シャツ|ジャケット|セーター|パーカー)を(?:着る|着用)[^\n。]{0,80}シェイプキー/.test(line));
 const outfitFitInstruction=instructionLines.some(line=>/トップスとボトムス[^\n。]{0,80}(?:服がタイト|衣装|シェイプキー)/.test(line));
 if(wearingInstruction&&outfitFitInstruction)return '服装';
 // The opening introduction may name the garment, but requirements/compatibility prose does not.
 const introduction=description.slice(0,800).split(/(?:対応アバター|supported\s+avatars?|compatible\s+avatars?|対応モデル|使用(?:した|している)シェーダ|requirements?|利用規約|利用ガイドライン|撮影(?:参考|に使用)|サンプル(?:画像|で使用)|credits?|参考(?:衣装|素材))/i)[0];
 const lead=categoryText(introduction),concreteGarment=lead.replace(/\b(?:outfits?|clothes|clothing|costumes?)\b|衣装|衣裝|服装|服裝|衣服|洋服|衣類/g,'');
 if(CLOTHING.test(lead)&&(CLOTHING.test(concreteGarment)||!ACCESSORY.test(lead)&&!HAIR.test(lead)&&!TEXTURE.test(lead))&&!/衣装(?:に|と|へ)(?:合わせ|合う|対応)|衣装と組み合わせ|衣装(?:や|及び|および).*髪|(?:衣装|服装|衣服)に?(?:適用|适用)|(?:衣装|服装)(?:と|に).*互換/i.test(lead))return '服装';
 const tagged=new Set((hints.tags||[]).map(inferCategory).filter(category=>category!=='未分类'&&category!=='模型'));if(tagged.size===1)return [...tagged][0];
 return titleCategory;
}
/** Breadcrumbs run broad to narrow; a recognized leaf is stronger than local naming. */
export function officialProductCategory(categories:readonly string[]):{category:Category;rawCategory:string}|undefined {
 const leaves:[Category,readonly string[]][]=[
  ['服装',['clothing','clothes','outfit','outfits','costume','costumes','衣装','衣裝','服装','服裝','衣類','衣服','shoes','socks']],
  ['模型',['character','characters','avatar','avatars','キャラクター','キャラクターモデル','アバター','角色','人物']],
  ['头发',['hair','hairstyle','hairstyles','ヘア','髪型','頭髪','头发','髮型']],
  ['饰品',['accessory','accessories','アクセサリ','アクセサリー','小物','小道具','装飾','装飾品','饰品','飾品']],
  ['贴图',['texture','textures','テクスチャ','テクスチャー','贴图','貼圖']],
  ['动作',['motion','motions','animation','animations','モーション','アニメーション','动作','動作']],
  ['特效',['effect','effects','particle','particles','エフェクト','パーティクル','特效']],
  ['工具',['tool','tools','shader','shaders','ツール','シェーダ','シェーダー','工具']]
 ];
 // The parent "3D Models" also contains clothes, hair and props. Only a known
 // leaf establishes strong evidence; broad parents and unknown leaves defer to product identity.
 for(const rawCategory of [...categories].reverse()){
  const key=rawCategory.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g,'').replace(/^3d/,'');
  const category=leaves.find(([,aliases])=>aliases.includes(key))?.[0];if(category)return {category,rawCategory:rawCategory.trim()};
 }return undefined;
}
const AVATARS:[string,RegExp][]=[
  ['Airi',/(?:\bairi\b|[._-]airi[._-]|愛莉|爱莉)/i],['Chiffon',/chiffon|シフォン/i],
  ['Chocolate',/chocolat(?:e)?|ショコラ|巧克力/i],['Eku',/(?:\beku\b|エク|艾可)/i],
  ['Kaguya',/kaguya|カグヤ|辉夜|輝夜/i],['Misaki',/misaki|ミサキ|美咲/i],
  ['Shinano',/shinano|しなの|信濃|信浓/i],['Shiano',/shiano|しあの/i],['Shano',/shano/i],['Shinra',/(?:\bshinra\b|森羅|森罗)/i],
  ['Manuka',/manuka|マヌカ|萌香/i],['Moe',/(?:\bmoe\b|萌(?!香))/i],['Kikyo',/kikyo|桔梗/i],
  ['Lime',/(?:\blime\b|ライム)/i],['Maya',/(?:\bmaya\b|舞夜)/i],['Selestia',/selestia|セレスティア|赛莉丝蒂娅/i],
  ['Rindo',/rindo|竜胆|龙胆/i],['Sio',/(?:\bsio\b|しお)/i],['Mayo',/(?:\bmayo\b|まよ)/i],
  ['Milltina',/milltina|ミルティナ|米露缇娜/i],['Lumina',/lumina|ルミナ/i],['Kumaly',/kumaly|クマリ/i],['Mizuki',/mizuki|瑞希/i],
  ['Ramune',/ramune|ラムネ/i],['Milfy',/milfy|ミルフィ/i],['Rurune',/rurune|ルルネ/i],['Lasyusha',/lasyusha|ラシューシャ/i],
  ['Minase',/minase|水瀬|水濑/i],['Sakura',/sakura|桜|櫻/i],['Plum',/plum|プラム/i]
];
// Latin aliases must be complete tokens: "ring" and "Airiness" are not avatars.
// Separators commonly used by downloaded packages (including camel case) count
// as token boundaries; the Chinese/Japanese aliases retain their own spelling.
export function inferAvatars(value:string):string[]{
  const text=value.normalize('NFKC').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_./\\-]/g,' ');
  return AVATARS.filter(([name,regex])=>{
    const alias=name==='Chocolate'?'chocolat(?:e)?':name;
    if(new RegExp(`(?<![A-Za-z])${alias}(?![A-Za-z])`,'i').test(text))return true;
    const nonLatin=text.replace(/[A-Za-z]+/g,'');return regex.test(nonLatin);
  }).map(([name])=>name);
}
const MODEL_ALIASES=new Set('airi|愛莉|爱莉|chiffon|シフォン|chocolat|chocolate|ショコラ|eku|エク|kaguya|カグヤ|輝夜|辉夜|misaki|ミサキ|shinano|しなの|信濃|信浓|shiano|しあの|shano|shinra|森羅|森罗|manuka|マヌカ|moe|萌|kikyo|桔梗|lime|ライム|maya|舞夜|selestia|セレスティア|rindo|竜胆|sio|しお|mayo|まよ|milltina|ミルティナ|lumina|ルミナ|kumaly|クマリ|mizuki|瑞希|ramune|ラムネ|milfy|ミルフィ|rurune|ルルネ|lasyusha|ラシューシャ|minase|水瀬|sakura|桜|plum|プラム'.split('|'));
/** Exact avatar names, optional versions, or bilingual names of the same avatar. */
export function isAvatarName(value:string):boolean {
  let name=value.normalize('NFKC').toLowerCase().replace(/\.(?:zip|rar|7z|unitypackage|fbx|blend|vrm|obj)$/i,'').replace(/[_-]+/g,' ').trim();
  for(;;){const stripped=name.replace(/\s*(?:(?:ver(?:sion)?\.?|v)\s*\d+(?:\.\d+)*|20\d{6}|\(\d+\))$/i,'').trim();if(stripped===name)break;name=stripped}
  if(MODEL_ALIASES.has(name))return true;
  const tokens=name.split(/\s+/);return tokens.length>1&&tokens.every(token=>MODEL_ALIASES.has(token))&&inferAvatars(name).length===1;
}
export function extractUrls(text:string):string[]{
  return [...new Set((text.match(/https?:\/\/[^\s<>"'\x00-\x1f]+/gi)??[]).map(url=>url.replace(/[)）\]】,，。;；]+$/g,'')))].filter(url=>{try{return ['https:','http:'].includes(new URL(url).protocol)}catch{return false}}).slice(0,20);
}
