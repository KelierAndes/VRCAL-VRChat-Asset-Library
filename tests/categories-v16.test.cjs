const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {inferCategory,inferLocalCategory,inferProductCategory,normalizeCategory}=require('../dist/main/main/hints'),{parseProduct}=require('../dist/main/main/online'),{Store}=require('../dist/main/main/store'),{CATEGORIES,displayCategory}=require('../dist/main/shared/contracts'),{Scanner}=require('../dist/main/main/scanner');
const source='https://booth.pm/ja/items/1234567';
function fixture(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-category-v16-')),root=path.join(base,'素材'),data=path.join(base,'资料库');fs.mkdirSync(root);const stores=[];t.after(()=>{for(const store of stores)try{store.close()}catch{}fs.rmSync(base,{recursive:true,force:true})});return {base,root,data,open(){const store=new Store(data,[root]);stores.push(store);return store}}}
function seed(store,root,name,extra={}){const file=path.join(root,name);fs.writeFileSync(file,'original fixture');return store.upsertScan({path:file,name,group:'测试角色',kind:'archive',size:16,mtimeMs:0,localCategory:'未分类',localAvatars:[],hintUrls:[],...extra})}
function page(title,description='',body=''){return '<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:source,name:title,description})+'</script><article class="market-item-detail-article">'+body+'</article>'}

test('clothes and shoes share one category with garment identity preceding outfit accessory components',()=>{
 assert.equal(CATEGORIES.includes('鞋子'),false);assert.equal(normalizeCategory('鞋子'),'服装');assert.equal(normalizeCategory('饰品'),'饰品');assert.equal(normalizeCategory('unexpected'),undefined);
 for(const name of ['Kyro Neko Hoodie [FULLSET v3 + PSD]','CityRunner Sneaker Shoes','Airi Dress with Earrings and Hair Clips','RibbonLingerie','GothicSwimwear_v1.zip','Winter Jacket','Sailor Blouse','Strawberry Lolita♡','いちごのスウィートロリィタ','オーバーサイズのパーカー','泳装','制服','白色长裙','丝袜','修女','Airi_Stockings.unitypackage'])assert.equal(inferCategory(name),'服装',name);
});

test('hair, hair clips, textures and tools remain distinct from contextual clothing words',()=>{
 const cases={'Y2K Hair Clips':'饰品','Hair Clips for Summer Dress':'饰品','衣装用ヘアピン':'饰品','Bunny Ears':'饰品','Ribbon Hair Pin':'饰品','Two Braided Pigtails':'头发','Maid Hair':'头发','女仆头发':'头发','Tattoo for a Dress':'贴图','Outfit Texture Pack':'服装','Wardrobe Outfit Editor':'工具','Modular Avatar':'工具','Airi ALL Ethereal Glow':'未分类'};
 for(const [name,category] of Object.entries(cases))assert.equal(inferCategory(name),category,name);
});

test('opaque wrappers use consistent shallow product hints while mixed independent products remain unclassified',()=>{
 assert.equal(inferLocalCategory('d1548',['Airi_Hoodie.zip','Chiffon_Hoodie.unitypackage','Hoodie_Materialpack.zip','PSD','Textures']),'服装');
 assert.equal(inferLocalCategory('a',['Chocolat_Stockings.zip','lilToon_FresnelAlphaEx.unitypackage']),'服装');
 assert.equal(inferLocalCategory('混合合集',['City Hoodie.zip','Star Hair.zip']),'未分类');
 assert.equal(inferLocalCategory('70+',['Shell_Earring.zip','GothicSwimwear.zip','kipfel贴图.zip']),'未分类');
 assert.equal(inferLocalCategory('未知',['Materials','PSD','Textures','Airi_Materialpack.zip']),'未分类');
 assert.equal(inferLocalCategory('Hair Clips',['Summer Dress.zip']),'饰品');
});

test('BOOTH titles and own-product descriptions identify clothes without promoting compatible hair or accessories',()=>{
 assert.equal(parseProduct(page('Kyro Neko Hoodie','This set contains stocking, earring, halo, lilToon and shaders.'),source).category,'服装');
 assert.equal(parseProduct(page('🎀Frilletta','発売記念セール中。\nこの衣装は、Modular Avatarの使用を推奨しています。\nHair : Cherish Twin'),source).category,'服装');
 assert.equal(parseProduct(page('Lop Ear Mine','オーバーサイズのうさみみパーカーとセーラーブラウスのコーデです。'),source).category,'服装');
 assert.equal(parseProduct(page('Lune Fluer','sale '.repeat(300)+'Except for Manuka, this outfit does not include a small breast shape key.'),source).category,'服装');
 assert.equal(parseProduct(page('Velvet Moon','This costume can use Modular Avatar.'),source).category,'服装');
 for(const [name,category] of [['Y2K Hair Clips','饰品'],['Two Braided Pigtails','头发'],['Gothic Halo','饰品'],['Scar Makeup','贴图']])assert.equal(parseProduct(page(name,'Compatible with outfits and dresses. 衣装に合わせた改変にも使えます。 This outfit is used only in the sample image.','<a href="/ja/tags/衣装">衣装</a>'),source).category,category,name);
 assert.equal(inferProductCategory({title:'Unidentified Gem',description:'Compatible with all outfits.'}),'未分类');
 assert.equal(inferProductCategory({title:'Unidentified Gem',description:'A hair accessory that works with clothing.'}),'未分类');
 assert.equal(inferProductCategory({title:'Unidentified Gem',description:'这个东西适用于服装。'}),'未分类');
 assert.equal(inferProductCategory({title:'Moonstone',description:'衣装に合わせた髪飾りです。'}),'未分类');
 assert.equal(parseProduct(page('Mystery','', '<div class="recommended-items"><a href="/browse/3D衣装">3D衣装</a></div>'),source).category,'未分类');
});

test('legacy shoe rows and saved smart filters load as clothing without damaging records or altering other manual classifications',t=>{
 const f=fixture(t);let store=f.open();const shoe=seed(store,f.root,'opaque-shoe.zip'),dress=seed(store,f.root,'QA Aurora Dress Outfit.zip'),manual=seed(store,f.root,'QA Manual Dress Outfit.zip');const oldCollection=store.saveCollection({name:'旧鞋子智能集合',kind:'smart',query:{category:'服装'}});store.close();
 const db=new DatabaseSync(path.join(f.data,'library.sqlite'));
 const replace=(item,patch)=>{const row=db.prepare('SELECT record FROM assets WHERE id=?').get(item.id);db.prepare('UPDATE assets SET record=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.record),...patch}),item.id)};
 replace(shoe,{localCategory:'鞋子',manual:{category:'鞋子',notes:'保留鞋子笔记'},online:{status:'matched',category:'鞋子',title:'CityRunner Sneaker Shoes'}});
 replace(dress,{localCategory:'饰品',manual:{notes:'自动错分类'},online:{status:'matched',category:'饰品',title:'QA Aurora Dress Outfit'}});
 replace(manual,{localCategory:'饰品',manual:{category:'饰品',notes:'人工决定不能覆盖'},online:{status:'matched',category:'饰品',title:'QA Manual Dress Outfit'}});
 db.prepare('UPDATE collections SET record=? WHERE id=?').run(JSON.stringify({...oldCollection,query:{category:'鞋子'}}),oldCollection.id);db.close();store=f.open();
 assert.equal(store.all().length,3);assert.equal(store.recoveryWarnings.length,0);assert.equal(store.getRaw(shoe.id).localCategory,'服装');assert.equal(store.getRaw(shoe.id).manual.category,'服装');assert.equal(store.getRaw(shoe.id).online.category,'服装');assert.equal(displayCategory(store.get(dress.id)),'服装');assert.equal(displayCategory(store.get(manual.id)),'饰品');assert.equal(store.get(manual.id).manual.notes,'人工决定不能覆盖');
 assert.equal(store.list({category:'鞋子'}).total,2);assert.equal(store.list({category:'服装'}).total,2);assert.equal(store.listCollections()[0].query.category,'服装');assert.equal(store.list({collectionId:oldCollection.id}).total,2);assert.equal(store.list({collectionId:oldCollection.id,category:'鞋子'}).total,2);assert.equal(Object.hasOwn(store.stats().categories,'鞋子'),false);
});

test('offline category correction and legacy values survive backup and restore while manual overrides keep priority',t=>{
 const f=fixture(t),store=f.open(),item=seed(store,f.root,'GardenHoodie.zip');store.updateOnline(item.id,{status:'matched',title:'Garden Hoodie',category:'饰品'});store.updateManual([item.id],{category:'饰品',notes:'人工覆盖'});const backup=path.join(f.base,'backup.json');store.exportData(backup);
 const exported=JSON.parse(fs.readFileSync(backup,'utf8'));assert.equal(exported.assets[0].online.category,'服装');assert.equal(exported.assets[0].manual.category,'饰品');
 exported.assets[0].manual.category='鞋子';exported.assets[0].localCategory='鞋子';exported.assets[0].online.category='鞋子';exported.metadataSha256=crypto.createHash('sha256').update(JSON.stringify({settings:exported.settings,assets:exported.assets,collections:exported.collections,tagAliases:exported.tagAliases,recoveryRecords:exported.recoveryRecords,...(exported.downloadPaths!==undefined?{downloadPaths:exported.downloadPaths}:{})})).digest('hex');fs.writeFileSync(backup,JSON.stringify(exported));const restoredData=path.join(f.base,'restored'),restored=new Store(restoredData,[f.root]);try{restored.importData(backup);assert.equal(restored.getRaw(item.id).localCategory,'服装');assert.equal(restored.getRaw(item.id).manual.category,'服装');assert.equal(restored.getRaw(item.id).online.category,'服装');assert.equal(restored.getRaw(item.id).manual.notes,'人工覆盖')}finally{restored.close()}
});

test('scanner derives clothing from opaque wrapper packages and leaves original file bytes unchanged',async t=>{
 const f=fixture(t),folder=path.join(f.root,'d1548');fs.mkdirSync(folder);for(const name of ['Airi_Winter_Hoodie.unitypackage','Chiffon_Winter_Hoodie.zip','Winter_Hoodie_Material.zip'])fs.writeFileSync(path.join(folder,name),'unreadable but unchanged');const before=fs.readdirSync(folder).map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,name))).digest('hex')]);const store=f.open();await new Scanner(store).scan();assert.equal(store.all()[0].localCategory,'服装');assert.deepEqual(fs.readdirSync(folder).map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,name))).digest('hex')]),before);
});
