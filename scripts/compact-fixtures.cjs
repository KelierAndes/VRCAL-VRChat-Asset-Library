// Keep only the observed metadata shape and factual fields in distributable tests.
const fs=require('node:fs');const path=require('node:path');const {parseProduct,parseSearch}=require('../dist/main/main/online.js');
const folder=path.join(__dirname,'..','tests','fixtures');
for(const [filename,id] of [['cherimel-live',8492723],['rho-live',8399277]]){
 const file=path.join(folder,filename+'.html');const product=parseProduct(fs.readFileSync(file,'utf8'),`https://booth.pm/ja/items/${id}`);
 const description=`Compatible avatars: ${product.avatars.join(', ')}`;
 const data={'@context':'https://schema.org','@type':'Product',name:product.title,brand:{name:product.author},url:product.url,image:product.coverUrl,description};
 const body=`<!doctype html><html><head><meta property="og:title" content="${product.title} - ${product.author} - BOOTH"><script type="application/ld+json">${JSON.stringify(data)}</script></head><body><article class="market-item-detail-article"><a href="/ja/browse/3D%20Clothing">衣装</a></article></body></html>`;
 fs.writeFileSync(file,body);
}
const file=path.join(folder,'rho-search-live.html');const candidates=parseSearch(fs.readFileSync(file,'utf8'),'https://booth.pm/ja/search/BCP-17%20Rho');
fs.writeFileSync(file,`<!doctype html><html><head><title>Search</title></head><body>${candidates.map(p=>`<div class="item-card"><a class="item-card__title" href="${p.url}">${p.title}</a><span class="item-card__shop-name">${p.author}</span></div>`).join('')}</body></html>`);
console.log('Test fixtures contain compact metadata and observed HTML structure.');
