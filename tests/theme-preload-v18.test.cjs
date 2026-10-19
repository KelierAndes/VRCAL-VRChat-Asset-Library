const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

// Execute the actual compiled sandbox preloads: arbitrary local-module requires are forbidden.
function loadPreload(file,globalName,args){let exposed;const calls=[];const context={exports:{},process:{argv:args},require:name=>{assert.equal(name,'electron','sandboxed preload must only require Electron');return {contextBridge:{exposeInMainWorld:(name,api)=>{assert.equal(name,globalName);exposed=api}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({})},on:()=>{},removeListener:()=>{}}}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main/main',file),'utf8'),context);return {api:exposed,calls}}

for(const [file,name,channel] of [['preload.js','library',undefined],['preview-preload.js','productPreview','--vrc-preview-channel=vrc-preview:11111111-1111-4111-8111-111111111111'],['booth-workspace-preload.js','boothWorkspace','--vrc-booth-channel=vrc-booth:11111111-1111-4111-8111-111111111111']]){
 test(name+' exposes only an allowlisted initial theme without IPC or sandbox module access',()=>{for(const [raw,want] of [['x','x'],['swiss','swiss'],['nasa','nasa'],['X','nasa'],['x;alert(1)','nasa'],['','nasa'],['../secret','nasa']]){const loaded=loadPreload(file,name,[...(channel?[channel]:[]),'--vrc-theme='+raw]);assert.equal(loaded.api.initialTheme,want);assert.deepEqual(loaded.calls,[])}assert.equal(loadPreload(file,name,channel?[channel]:[]).api.initialTheme,'nasa')});
}

for(const [file,apiName] of [['preview.html','productPreview'],['booth-workspace.html','boothWorkspace']]){
 test(file+' applies the trusted initial theme before loading styles, rejecting invalid toolbar themes',()=>{const html=fs.readFileSync(path.join(__dirname,'../assets',file),'utf8'),head=html.slice(0,html.indexOf('<link rel="stylesheet"')),scripts=[...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);assert(scripts.length,'an initial-theme script must run before the toolbar stylesheet');for(const [raw,want] of [['x','x'],['swiss','swiss'],['nasa','nasa'],['invalid','nasa'],[undefined,'nasa']]){const document={documentElement:{dataset:{theme:'nasa'}}};vm.runInNewContext(scripts.join('\n'),{document,window:{[apiName]:{initialTheme:raw}}});assert.equal(document.documentElement.dataset.theme,want)}});
}

test('renderer runs its external theme bootstrap in the head before modules or styles without relaxing script CSP',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/renderer/index.html'),'utf8');
 const bootstrap=/<script\b([^>]*\bsrc=["']\.\/theme-init\.js["'][^>]*)><\/script>/i.exec(html);
 assert(bootstrap,'main renderer needs a classic external pre-paint theme script');
 assert(bootstrap.index<html.indexOf('</head>'),'theme bootstrap must run while the head is being parsed');
 assert(!/\b(async|defer)\b|\btype\s*=\s*["']module["']/i.test(bootstrap[1]),'theme bootstrap must block parsing rather than wait for a module');
 const before=html.slice(0,bootstrap.index);
 assert(!/<script\b[^>]*\btype=["']module["']|<style\b|<link\b[^>]*\brel=["']stylesheet["']/i.test(before),'theme bootstrap must precede all renderer modules and styles');
 const policy=/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content="([^"]*)"/i.exec(before)?.[1];
 assert(policy,'CSP must be declared before the external bootstrap');
 assert.equal(policy.split(';').map(value=>value.trim()).find(value=>value.startsWith('script-src ')),"script-src 'self'",'script policy must remain self-only');
 assert(!/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html),'renderer must not introduce inline executable scripts');
});

test('renderer actual pre-paint bootstrap allowlists initial themes with no dependency on the deferred module',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/renderer/public/theme-init.js'),'utf8');
 for(const [raw,want] of [['x','x'],['swiss','swiss'],['nasa','nasa'],['X','nasa'],['x;alert(1)','nasa'],['../secret','nasa'],['','nasa'],[null,'nasa'],[{},'nasa'],[undefined,'nasa']]){
  const document={documentElement:{dataset:{theme:'nasa'}}};
  vm.runInNewContext(source,{document,window:{library:{initialTheme:raw}}});
  assert.equal(document.documentElement.dataset.theme,want);
 }
 const document={documentElement:{dataset:{theme:'x'}}};
 vm.runInNewContext(source,{document,window:{}});
 assert.equal(document.documentElement.dataset.theme,'nasa','missing preload must use the valid fallback');
});
