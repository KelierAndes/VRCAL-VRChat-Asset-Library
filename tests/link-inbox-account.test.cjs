const {test}=require('node:test'),assert=require('node:assert/strict');
const Module=require('node:module');
let probe;
try{probe=require('../dist/main/main/link-inbox-account').inboxAccountStatus}catch{}
test('account diagnostics recognize the official BOOTH login redirect without retaining URL tokens',()=>{
 assert.equal(typeof probe,'function');const state=probe('booth',['https://accounts.booth.pm/users/sign_in?return_to=PRIVATE'],'foreground');assert.equal(state.state,'login');assert.equal(state.observations.length,0);assert(!JSON.stringify(state).includes('PRIVATE'));
});
test('an open unverified chat or purchase page is never reported ready and cannot produce links',()=>{
 assert.equal(typeof probe,'function');for(const platform of ['booth','xianyu']){const state=probe(platform,[platform==='booth'?'https://accounts.booth.pm/library':'https://www.goofish.com/im'],'foreground');assert.equal(state.state,'unsupported');assert.deepEqual(state.observations,[])}
});
test('closed pages and background checks do not create a browser or pretend a saved account is logged out',()=>{
 assert.equal(typeof probe,'function');assert.equal(probe('booth',[],'foreground').state,'paused');assert.equal(probe('xianyu',[],'background').state,'unsupported');assert.notEqual(probe('booth',['https://accounts.booth.pm.evil.invalid/users/sign_in'],'foreground').state,'login');
});
