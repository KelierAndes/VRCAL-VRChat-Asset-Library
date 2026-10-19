const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {translate} = require('../dist/main/shared/i18n');

test('matching explanations and evidence switch to English and Japanese', () => {
  const examples = [
    ['名称存在部分对应；型号、版本说明或作者仍需核对', 'The names partially match; check the model, version notes and creator.', '名前は一部一致しています。モデル、バージョンの説明、作者を確認してください。'],
    ['移除压缩、版本及适配包装后，完整商品名称一致', 'The full product names match after removing archive, version and compatibility labels.', '圧縮形式、バージョン、対応モデルの表記を除くと、商品名全体が一致します。'],
    ['商品名称已对应，但还有相似商品或多个本地包，需由你确认', 'The product name matches, but similar products or multiple local packages need your confirmation.', '商品名は一致していますが、類似商品または複数のローカルパッケージがあるため、確認が必要です。'],
    ['作者线索与商品作者或商店标识一致', 'The creator clue matches the product creator or shop identifier.', '作者の手がかりが商品の作者またはショップ識別子と一致します。'],
  ];
  for (const [source, en, ja] of examples) {
    assert.equal(translate(source, 'en'), en);
    assert.equal(translate(source, 'ja'), ja);
    assert.equal(translate(source, 'zh-CN'), source);
  }
});

test('declared engine templates retain IDs and literal names without translating embedded values', () => {
  for (const [language, id, label] of [['en', 'The filename product ID matches BOOTH 1234567.', 'Child package clue: '], ['ja', 'ファイル名の商品番号が BOOTH 1234567 と一致します。', '内部パッケージの手がかり：']]) {
    assert.equal(translate('文件名商品编号与 BOOTH 1234567 一致', language), id);
    const name = '全部素材_日本語 ${value} {page} $&.zip';
    assert.equal(translate('子包线索：' + name, language, {page: 99}), label + name);
    assert.equal(translate('子包线索：{name}', language, {name}), label + name);
    assert.equal(translate('子包线索：Cute Dress', language), label + 'Cute Dress');
  }
});

test('unknown metadata and near-matching user prose stay unchanged', () => {
  const values = ['我的作者名字', '名称存在部分对应；我的备注', '说明：子包线索：Cute Dress', '文件名商品编号与 BOOTH ABC 一致', '文件名商品编号与 BOOTH 01234567 一致', '文件名商品编号与 BOOTH 1234567890123 一致', '文件名商品编号与 BOOTH 1234567 一致\n', '子包线索：' + 'x'.repeat(161), '子包线索：Cute Dress\n第二行', 'C:/商品名称已对应/原文件.zip', '我的备注 · 封面图片 · Cute Dress', '封面图片 · ' + 'x'.repeat(1025), 'constructor', 'toString', '__proto__'];
  for (const language of ['en', 'ja']) for (const source of values) assert.equal(translate(source, language), source);
});

test('transfer labels translate exactly the app prefix and preserve the entire filename payload',()=>{
  for(const [language,labels] of [['en',['Product search','Product page','Cover image']],['ja',['商品検索','商品ページ','表紙画像']]])for(const [index,prefix] of ['商品检索','商品页面','封面图片'].entries()){
    const name='全部素材 · {page} $&.zip';assert.equal(translate(prefix+' · '+name,language,{page:99}),labels[index]+' · '+name);
  }
  for(const language of ['en','ja'])assert.notEqual(translate('此素材已转入手动归类',language),'此素材已转入手动归类');
});

test('known read failures localize their wrapper and app detail while retaining foreign error detail', () => {
  assert.equal(translate('候选预览图读取失败，可稍后重试：网页读取超时，可稍后重试', 'en'), 'Candidate preview images could not be loaded. Try again later: The webpage request timed out. Try again later.');
  assert.equal(translate('商品已确认；封面读取失败：自定义错误 {page} $&', 'ja', {page: 99}), '商品を確定しました。表紙の読み込みに失敗しました：自定义错误 {page} $&');
  assert.equal(translate('网页暂时无法读取（503），可稍后重试', 'en'), 'The webpage is temporarily unavailable (503). Try again later.');
  assert.equal(translate('已连接 BOOTH，但网站访问受限（HTTP 403）；不能据此判断代理失联', 'ja'), 'BOOTH に接続しましたが、アクセスが制限されています（HTTP 403）。これだけではプロキシの切断とは判断できません。');
});

test('metadata retention and category warnings compose using only the declared app grammar', () => {
  const source = '商品已确认；封面读取失败：网络不可用；本次未获取完整资料或封面，部分内容沿用上次记录；官方分类读取未完成，保留上次分类并稍后重试';
  const translated = translate(source, 'en');
  assert.equal(translated, 'Product confirmed; the cover could not be loaded: Network unavailable. Some metadata or the cover could not be retrieved; previous values were retained. The official category could not be read; the previous category was retained and will be retried.');
  assert.equal(translate('我的备注；本次未获取完整资料或封面，部分内容沿用上次记录', 'en'), '我的备注；本次未获取完整资料或封面，部分内容沿用上次记录');
});

test('real matching results expose translated review and child-package evidence while metadata stays literal', async t => {
  process.env.NODE_ENV = 'test';
  const {EnrichmentQueue} = require('../dist/main/main/online');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vrc-engine-language-'));
  const base = {path:path.join(root, 'fixture.zip'),group:'我的分组',kind:'archive',size:1,mtimeMs:1,missing:false,localCategory:'服装',localAvatars:[],hintUrls:[],manual:{title:'我的标题',notes:'名称存在部分对应；型号、版本说明或作者仍需核对',tags:['全部素材']},online:{status:'pending'},createdAt:'2026-01-01',updatedAt:'2026-01-01'};
  const items = [
    {...structuredClone(base),id:'direct',name:'1234567 Cute Dress.zip'},
    {...structuredClone(base),id:'partial',name:'Cute Dress Black.zip'},
    {...structuredClone(base),id:'child',name:'Bundle',kind:'folder',localNameHints:['1234567 Cute Dress.zip']},
  ];
  const queue = new EnrichmentQueue({dataDir:path.join(root,'data'),roots:()=>[path.join(root,'source')],all:()=>items,get:id=>items.find(item=>item.id===id)||null,updateOnline:(id,patch)=>{const item=items.find(item=>item.id===id);item.online={...item.online,...patch};},fetch:async target=>{
    const html=target.includes('/search/')?'<div class="item-card"><a class="item-card__title" href="/ja/items/1234567">Cute Dress</a></div>':'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:'https://booth.pm/ja/items/1234567',name:'Cute Dress',brand:{name:'我的作者'},description:'我的商品介绍，保留原文。'})+'</script>';
    return new Response(html,{headers:{'content-type':'text/html'}});
  },testing:{intervalMs:0,lookup:async()=>['93.184.216.34'],timeoutMs:2000}});
  t.after(async()=>{queue.stop();await queue.waitIdle();fs.rmSync(root,{recursive:true,force:true});});
  await queue.enqueue();await queue.waitIdle();
  assert.deepEqual(items.map(item=>item.online.status),['matched','review','matched']);
  assert.equal(items[2].online.matchEvidence.method,'child-package');
  assert(items[2].online.matchEvidence.signals.includes('子包线索：1234567 Cute Dress.zip'));
  for(const item of items){
    const before=structuredClone(item);
    for(const language of ['en','ja']){
      for(const message of [item.online.message,...item.online.matchEvidence.signals,...(item.online.candidates??[]).map(candidate=>candidate.reason)].filter(Boolean))assert.notEqual(translate(message,language),message,`${language}: ${message}`);
      assert.equal(item.online.title??item.online.candidates[0].title,'Cute Dress');
      assert.equal(item.online.author??item.online.candidates[0].author,'我的作者');
    }
    assert.deepEqual(item,before);
  }
});

test('real collection, tag, root, safety and migration validation errors localize offline',async t=>{
  const {Store}=require('../dist/main/main/store'),{assertSafeWrite}=require('../dist/main/main/safety'),{copyLibraryData}=require('../dist/main/main/storage'),{assetLocation}=require('../dist/main/main/asset-location'),{TransferMeter}=require('../dist/main/main/transfer');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-engine-errors-')),data=path.join(root,'data'),store=new Store(data,[path.join(root,'source')]);
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const examples=[
    [()=>store.saveCollection({name:'',kind:'manual'}),'Invalid collection name or type.','コレクションの名前または種類が無効です。'],
    [()=>store.setTagAliases('',[]),'Invalid tag alias.','タグの別名が無効です。'],
    [()=>store.saveSettings({roots:['relative-path']}),'Invalid asset root path.','素材のルートフォルダーのパスが無効です。'],
    [()=>assertSafeWrite('relative',data,[]),'The write path must be absolute.','書き込み先は絶対パスで指定してください。'],
    [()=>copyLibraryData(data,path.join(data,'nested'),[],true),'The new and previous library locations cannot contain each other.','新旧のライブラリ保存先を互いの配下に指定することはできません。'],
    [()=>assetLocation({path:path.join(root,'fixture.zip')},'relative'),'Invalid file location.','ファイルの場所が無効です。'],
    [()=>assetLocation({path:path.join(root,'fixture.zip')},path.join(root,'unknown.zip')),'Only registered file locations for this asset can be opened.','この素材に登録済みのファイルの場所のみ開けます。'],
    [()=>new TransferMeter('https://booth.pm/','page','fixture').received(-1),'Invalid download byte count.','ダウンロードのバイト数が無効です。'],
  ];
  for(const [action,en,ja] of examples){let message;try{await action();assert.fail('Validation should reject the input');}catch(error){message=error.message;}assert.equal(translate(message,'en'),en);assert.equal(translate(message,'ja'),ja);}
});

test('recovery warnings retain opaque record kinds, keys and IDs exactly',()=>{
  const source='tag-alias 私有标签 {page} $& 的损坏记录已原样保全；有效资料保持可用。';
  assert.equal(translate(source,'en',{page:99}),'The damaged record tag-alias 私有标签 {page} $& was preserved unchanged; valid information remains available.');
  assert.equal(translate(source,'ja',{page:99}),'破損したレコード tag-alias 私有标签 {page} $& をそのまま保全しました。有効な情報は引き続き利用できます。');
  assert.equal(translate('素材记录 raw-id_123 无法读取；原数据保留，可从备份恢复。','en'),'Asset record raw-id_123 could not be read. The original data was retained and can be restored from a backup.');
  assert.equal(translate('unknown-kind key 的损坏记录已原样保全；有效资料保持可用。','en'),'unknown-kind key 的损坏记录已原样保全；有效资料保持可用。');
});

test('declared archive limits and missing-file warnings preserve counts and local filenames',()=>{
  const source='包内列表达到读取上限（最多 2,000 条、128 MB 数据或 15 秒）；展示已读取的路径，未解压到磁盘。';
  assert.equal(translate(source,'en'),'Package listing reached its read limit (up to 2,000 entries, 128 MB of data or 15 seconds). Showing the paths already read; nothing was extracted to disk.');
  assert.equal(translate(source,'ja'),'パッケージ一覧の読み取り上限に達しました（最大 2,000 件、128 MB、または 15 秒）。読み取り済みのパスのみを表示し、ディスクへの展開は行っていません。');
  assert.equal(translate('全部素材 {page}.zip：本地文件缺失。','en',{page:99}),'全部素材 {page}.zip: Local file missing.');
  assert.equal(translate('全部素材 {page}.zip：本地文件缺失。','ja',{page:99}),'全部素材 {page}.zip：ローカルファイルが見つかりません。');
  assert.equal(translate(source.replace('128','我的备注'),'en'),source.replace('128','我的备注'));
});
