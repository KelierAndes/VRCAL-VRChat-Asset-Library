// Only explicitly marked application chrome is translated. Product data and page content never enter this lookup.
window.localChrome=(()=>{
 let language='zh-CN',messages=Object.create(null);
 const normalize=value=>['zh-CN','ja','en'].includes(value)?value:'zh-CN';
 function text(source,values={}){const translated=language==='zh-CN'?source:messages[source]??source;return translated.replace(/\{([A-Za-z0-9_]+)\}/g,(whole,key)=>Object.hasOwn(values,key)?String(values[key]):whole)}
 function update(next,mapping){language=normalize(next);messages=mapping&&typeof mapping==='object'?mapping:Object.create(null);document.documentElement.lang=language;
  for(const element of document.querySelectorAll('[data-i18n]'))element.textContent=text(element.dataset.i18n);
  for(const attribute of ['title','placeholder','aria-label','alt'])for(const element of document.querySelectorAll('[data-i18n-'+attribute+']'))element.setAttribute(attribute,text(element.getAttribute('data-i18n-'+attribute)));
 }
 return {text,update};
})();
