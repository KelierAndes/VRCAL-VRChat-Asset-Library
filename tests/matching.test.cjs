const test=require('node:test');
const assert=require('node:assert/strict');
const {searchClue,searchClues,candidateScore,extractBoothIds}=require('../dist/main/main/matching');
const candidate=(title,author='Shop',authorAliases)=>({title,author,url:'https://booth.pm/ja/items/1234567',authorAliases});

test('filename separators precede avatar/version cleanup and product versions are symmetric',()=>{
  assert.equal(searchClue('MoonDress_Airi_v1.2.zip').query,'MoonDress');
  assert.equal(candidateScore('MoonDress_Airi_v1.2.zip',candidate('Moon Dress Ver.1.2')),1);
  assert.equal(candidateScore('Moon Dress for Airi v1.2.zip',candidate('Moon Dress')),1);
  assert.equal(candidateScore('MoonDress_1234567.zip',candidate('【11アバター対応】MoonDress')),1);
});
test('at-author excludes trailing version/item id and verifies exact known aliases',()=>{
  assert.equal(searchClue('MoonDress@Shop_v1.2.zip').author,'Shop');
  assert.equal(searchClue('CheriMeL@LOVACE_8492723.zip').author,'LOVACE');
  assert.equal(candidateScore('MoonDress@Shop_v1.2.zip',candidate('MoonDress')),1);
  assert.equal(candidateScore('MoonDress@Shop.zip',candidate('MoonDress','ショップ',['shop'])),1);
  assert.equal(candidateScore('MoonDress@Other.zip',candidate('MoonDress','Shop',['shop'])),0);
  assert.equal(candidateScore('MoonDress@Shop.zip',candidate('MoonDress','ShopExtra')),0);
});
test('bracketed product names do not disappear because they contain all or pack',()=>{
  for(const title of ['Fallen Angel','Backpack','Wallflower']){
    assert.equal(searchClue('['+title+'].zip').query,title);
    assert.equal(candidateScore('['+title+']_Airi_v1.2.zip',candidate(title)),1);
  }
  assert.equal(searchClue('[FULLSET]MoonDress.zip').query,'MoonDress');
});
test('actual repeated HYPER title and promotional punctuation become one meaningful identity',()=>{
  const name='💜HYPER TECH EVO -IGNITE-💜セール中！！💜HYPER TECH EVO -IGNITE-💜セール中！！FULLSET';
  assert.equal(searchClue(name).query,'HYPER TECH EVO -IGNITE-');
  assert.equal(candidateScore(name,candidate('🔧HYPER TECH EVO -IGNITE-🔧')),1);
  assert(candidateScore(name,candidate('HYPER TECH EVO -FROST-'))<.95);
});
test('real Windows duplicate/author-prefix filename has an alternative, accepted only with verified shop alias',()=>{
  const name='ZAICRIFICE_Y2K_Hair_Clips (1)';
  assert.deepEqual(searchClues(name),[{query:'ZAICRIFICE Y2K Hair Clips',author:undefined},{query:'Y2K Hair Clips',author:'ZAICRIFICE'}]);
  assert.equal(candidateScore(name,candidate('Y2K Hair Clips','別の表示名',['zaicrifice'])),1);
  assert(candidateScore(name,candidate('Y2K Hair Clips','Another Shop'))<.95);
  assert.equal(candidateScore('ZAICRIFICE_Y2K_Hair_Clips (1).zip',candidate('Y2K Hair Clips','ZAICRIFICE')),1);
  assert.equal(searchClues('Airi_MoonDress.zip').length,1);
  assert.equal(candidateScore(name,candidate('✩FREE/無料✩ 「複数アバター対応」 Y2K Hair Clips','ZAICRIFICE')),1);
  assert.equal(require('../dist/main/main/hints').inferCategory('Y2K Hair Clips'),'饰品');
});
test('meaningful editions and product modifiers remain distinct even for a shared author',()=>{
  for(const [local,remote] of [['MoonDress Summer','MoonDress Winter'],['MoonDress Summer','MoonDress'],['LILY_MoonDress','MoonDress'],['HYPER TECH EVO IGNITE','HYPER TECH EVO'],['Hair Clips','Hair Clip Extensions']])assert(candidateScore(local+'.zip',candidate(remote))<.95,local+' must not auto-match '+remote);
  assert.equal(candidateScore('LILY_MoonDress.zip',candidate('LILY MoonDress','Another Shop')),1,'an underscore does not globally make the first word an author');
});
test('generic/short words and item ID alone never establish a product match',()=>{
  for(const title of ['Dress','Hair','素材','服装','Moe','Ab'])assert(candidateScore(title+'.zip',candidate(title))<.95);
  assert.equal(candidateScore('8492723.zip',candidate('CheriMeL')),0);
});
test('Japanese avatar substring is preserved inside a genuine name',()=>{
  assert.equal(searchClue('萌えもえ Dress.zip').query,'萌えもえ Dress');
  assert.equal(candidateScore('萌えもえ Dress.zip',candidate('萌えもえ Dress')),1);
});
test('Booth IDs normalize Unicode and exclude real dates, but accept explicit item labels',()=>{
  assert.deepEqual(extractBoothIds('MoonDress_１２３４５６７.zip'),['1234567']);
  assert.deepEqual(extractBoothIds('6097412 【11アバター対応】Succubus Tattoo.zip'),['6097412']);
  assert.deepEqual(extractBoothIds('MoonDress_20261014_20240229_20230228_1234567.zip'),['1234567']);
  assert.deepEqual(extractBoothIds('MoonDress_20260230.zip'),['20260230'],'invalid calendar dates are not discarded as dates');
  assert.deepEqual(extractBoothIds('MoonDress_BOOTH id 12345.zip'),['12345']);
  assert.deepEqual(extractBoothIds('MoonDress_item:1234.zip'),['1234']);
  assert.deepEqual(extractBoothIds('MoonDress_BOOTH item 20261014.zip'),['20261014'],'explicit BOOTH product labels override an accidental date-like numeric value');
  assert.deepEqual(extractBoothIds('BCP-17 Rho 12345.zip'),[],'short unlabelled numbers may be product codes');
  assert.deepEqual(extractBoothIds('AB1234567.zip'),[],'embedded model/SKU numbers are not standalone item IDs');
});
test('promo labels remove decoration while independent title qualifiers remain visible',()=>{
  assert.equal(candidateScore('【11アバター対応】Succubus Tattoo_6097412.zip',candidate('Succubus Tattoo')),1);
  assert.equal(candidateScore('[Backpack] Summer.zip',candidate('Backpack Winter')),0.5);
  assert.equal(candidateScore('MoonDress.zip',candidate('MoonDress Summer')),0.89);
});
