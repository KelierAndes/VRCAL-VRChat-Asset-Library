const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {inferCategory,inferProductCategory}=require('../dist/main/main/hints'),{displayCategory}=require('../dist/main/shared/contracts'),{Store}=require('../dist/main/main/store');

// These excerpts reproduce two real records whose avatar/dependency sections precede garment information.
const cozy={title:'【Plum update】【PB】『Cozy Cutie』【13 Avatars】',tags:['VRChat'],description:'「対応アバター / 대응 아바타」\nPlum\nChocolat\n[支援シェーダー]\nLil Toon Shader\n●使用方法●\nコートを着る時は上着のwith_puffシェイプキーをご使用ください\nトップスとボトムスは服がタイトなので少し開くことがあります\n[動作確認したツール]\nModular Avatar'};
const meira={title:'✨【18アバター対応／50%OFF】Meira｜Lumina対応＆前面PBアップデート✨',tags:['VRChat'],description:'OPEN BIG SALE\n最新 Modular Avatarを使用して着せてください。\n♣ 『Meira』 衣装に関する注意事項 ♣\nKipfelは全身タイツに対応しておりません。\n♣ 対応アバター ♣\nMilltina\n♣ 使用したシェーダー ♣\nlilToon'};

test('real BOOTH clothing usage sections classify apparel after avatar and shader lists',()=>{
 assert.equal(inferProductCategory(cozy),'服装');
 assert.equal(inferProductCategory(meira),'服装');
 assert.equal(inferProductCategory({title:'Neon_Dive',description:'♣ 『Neon_Dive』 衣装に関する注意事項 ♣'}),'服装');
 for(const name of ['コート','トップス','ボトムス','全身タイツ','Shinano_Cozy_Sweater_Ribbon.zip'])assert.equal(inferCategory(name),'服装',name);
});

test('clothing references cannot turn a hair clip, hair style, texture or tool into clothing',()=>{
 for(const [title,expected] of [['Y2K Hair Clips','饰品'],['Braided Hair','头发'],['Skin Texture','贴图'],['Outfit Fit Editor','工具']])assert.equal(inferProductCategory({...cozy,title}),expected,title);
 assert.equal(inferProductCategory({...meira,title:'Mysterious Gem'}),'未分类','a different product garment notice is not this product');
 assert.equal(inferProductCategory({title:'Mysterious Gem',description:'衣装に合わせた改変に使えます。\n対応衣装: Meira\n使用したシェーダー: lilToon'}),'未分类');
 assert.equal(inferProductCategory({title:'Mysterious Gem',description:'対応アバター\nAiri\nコートを着る時は上着のwith_puffシェイプキーをご使用ください'}),'未分类','one isolated late wearing instruction is insufficient');
 assert.equal(inferProductCategory({title:'Mysterious Gem',description:'撮影参考: コートを着る時は上着のwith_puffシェイプキーをご使用ください\n撮影参考: トップスとボトムスは服がタイトなので少し開くことがあります'}),'未分类');
});

test('an automatic unclassified result falls back to local clothing while deliberate manual choices retain priority',()=>{
 const asset={manual:{},online:{status:'matched',category:'未分类'},localCategory:'服装'};
 assert.equal(displayCategory(asset),'服装');
 assert.equal(displayCategory({...asset,manual:{category:'未分类'}}),'未分类');
 assert.equal(displayCategory({...asset,manual:{category:'饰品'}}),'饰品');
 assert.equal(displayCategory({...asset,localCategory:'未分类',online:{status:'matched',category:'头发'}}),'头发');
});

test('existing wrong automatic categories are corrected from own-product evidence on restart without touching manual choices',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-category-v17-')),root=path.join(base,'素材'),data=path.join(base,'资料库');fs.mkdirSync(root);const stores=[];t.after(()=>{for(const store of stores)try{store.close()}catch{}fs.rmSync(base,{recursive:true,force:true})});
 let store=new Store(data,[root]);stores.push(store);const file=path.join(root,'cozy cutie.zip');fs.writeFileSync(file,'original source bytes');
 const asset=store.upsertScan({path:file,name:'cozy cutie.zip',group:'Airi',kind:'archive',size:21,mtimeMs:0,localCategory:'未分类',localAvatars:[],hintUrls:[]});
 store.updateOnline(asset.id,{status:'matched',...cozy,category:'工具'});assert.equal(store.getRaw(asset.id).online.category,'服装');
 store.updateManual([asset.id],{category:'饰品',notes:'用户决定保留在这里'});store.close();
 store=new Store(data,[root]);stores.push(store);assert.equal(store.getRaw(asset.id).online.category,'服装');assert.equal(displayCategory(store.get(asset.id)),'饰品');assert.equal(store.get(asset.id).manual.notes,'用户决定保留在这里');assert.equal(fs.readFileSync(file,'utf8'),'original source bytes');
});
