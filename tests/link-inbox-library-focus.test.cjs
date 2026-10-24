const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {BoothWorkspace}=require('../dist/main/main/booth-workspace');
const hash=s=>createHash('sha256').update(s).digest('hex'),account='booth-user:123',accountKey=hash('booth\0'+hash('booth\0'+account));
function fixture(){let focused=0;const w=Object.create(BoothWorkspace.prototype);w.deps={canNetwork:()=>true};w.open=async()=>{};w.status=()=>{};w.entry={loaded:true,loading:false,closed:false,view:{webContents:{isDestroyed:()=>false,getURL:()=> 'https://accounts.booth.pm/library',executeJavaScript:async code=>{if(code.includes('scrollIntoView')){focused++;assert(!/\.click\(|downloadURL|\.submit\(/.test(code));return true}return {url:'https://accounts.booth.pm/library',account,supported:true,rows:[{key:'item-456',kind:'purchase',text:'',libraryItem:'456'}]}}}}};return {w,focused:()=>focused}}
test('explicit library selection locates the owned card without downloading and rechecks account identity',async()=>{
 const f=fixture();await f.w.openInboxLibraryItem('456',accountKey);assert.equal(f.focused(),1);
 const other=fixture();await assert.rejects(()=>other.w.openInboxLibraryItem('456',hash('other-account')),/当前账号/);assert.equal(other.focused(),0);
 const absent=fixture();await assert.rejects(()=>absent.w.openInboxLibraryItem('999',accountKey),/当前账号/);assert.equal(absent.focused(),0);
});
