const {test}=require('node:test'),assert=require('node:assert/strict');
const {LinkInboxMonitor}=require('../dist/main/main/link-inbox-monitor');
function fixture(){let enabled=true;const saved=[],statuses=[],prefs={enabled:true,background:true,hours:24};const deps={settings:()=>prefs,canNetwork:()=>enabled,ingest:o=>saved.push(o),changed:()=>{},readers:[]};return {deps,saved,prefs,offline:()=>{enabled=false}}}
test('polling is serial and overlap cannot start another read',async()=>{const f=fixture();let release,calls=0;f.deps.readers=[{platform:'booth',read:async()=>{calls++;await new Promise(r=>release=r);return {observations:[{platform:'booth',test:true}],state:'ready',message:'ok'}}}];const monitor=new LinkInboxMonitor(f.deps);const first=monitor.check('background');await monitor.check('background');assert.equal(calls,1);release();await first;assert.equal(f.saved.length,1);monitor.stop()});
test('pause/offline invalidates pending reads; foreground still works with background disabled',async()=>{const f=fixture();let release;f.deps.readers=[{platform:'xianyu',read:async()=>{await new Promise(r=>release=r);return {observations:[{}],state:'ready',message:'ok'}}}];const monitor=new LinkInboxMonitor(f.deps);const pending=monitor.check('background');monitor.pause();release();await pending;assert.equal(f.saved.length,0);f.prefs.background=false;await monitor.check('background');assert.equal(f.saved.length,0);const foreground=monitor.check('foreground');f.offline();release();await foreground;assert.equal(f.saved.length,0);monitor.stop()});
test('reader failures back off and show a status without importing anything',async()=>{const f=fixture();let calls=0;f.deps.readers=[{platform:'booth',read:async()=>{calls++;throw new Error('private token must not leak')}}];const monitor=new LinkInboxMonitor(f.deps);await monitor.check('background');await monitor.check('background');assert.equal(calls,1);assert.equal(f.saved.length,0);assert(!JSON.stringify(monitor.statuses()).includes('private token'));assert.equal(monitor.statuses()[0].state,'error');monitor.stop()});

test('pause immediately releases an unresponsive reader and a later result cannot enter the next run',async()=>{
 const f=fixture();let release,calls=0;f.deps.readers=[{platform:'booth',read:async()=>{calls++;if(calls===1)await new Promise(r=>release=r);return {observations:[{platform:'booth',sourceKey:String(calls)}],state:'ready',message:'ok'}}}];
 const monitor=new LinkInboxMonitor(f.deps);const first=monitor.check('foreground');monitor.pause();
 const result=await Promise.race([first.then(()=>true),new Promise(r=>setTimeout(()=>r(false),30))]);
 try{assert.equal(result,true);await monitor.check('foreground');assert.equal(calls,2);assert.equal(f.saved.length,1);release();await new Promise(r=>setImmediate(r));assert.equal(f.saved.length,1)}finally{release();monitor.stop()}
});

test('one platform timeout does not prevent checking the other account',async()=>{
 const f=fixture();let release;f.deps.readTimeoutMs=10;f.deps.readers=[{platform:'xianyu',read:async()=>new Promise(r=>release=r)},{platform:'booth',read:async()=>({observations:[{platform:'booth'}],state:'ready',message:'ok'})}];
 const monitor=new LinkInboxMonitor(f.deps),pending=monitor.check('foreground');try{const finished=await Promise.race([pending.then(()=>true),new Promise(r=>setTimeout(()=>r(false),100))]);assert.equal(finished,true);assert.equal(f.saved.length,1);assert.equal(monitor.statuses().find(x=>x.platform==='xianyu').state,'error');assert.equal(monitor.statuses().find(x=>x.platform==='booth').state,'ready')}finally{monitor.stop();release({state:'ready',observations:[],message:''});await pending}
});

test('disabled accounts have a visible paused status and manual refresh does not imply background consent',async()=>{
 const f=fixture();f.prefs.enabled=false;let calls=0;f.deps.readers=[{platform:'booth',read:async()=>{calls++;return {state:'ready',observations:[],message:'ok'}}}];const monitor=new LinkInboxMonitor(f.deps);
 assert.equal(monitor.statuses()[0]?.state,'paused');await monitor.check('foreground');assert.equal(calls,0);f.prefs.enabled=true;f.prefs.background=false;await monitor.check('background');assert.equal(calls,0);await monitor.check('foreground');assert.equal(calls,1);monitor.stop();
});

test('an adapter cannot ingest observations labelled as the other platform',async()=>{
 const f=fixture();f.deps.readers=[{platform:'booth',read:async()=>({state:'ready',observations:[{platform:'xianyu'}],message:'ok'})}];const monitor=new LinkInboxMonitor(f.deps);await monitor.check('foreground');assert.equal(f.saved.length,0);assert.equal(monitor.statuses()[0].state,'error');monitor.stop();
});

test('scheduled foreground observation and background visits have different cadence and require live consent',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:1800000});const f=fixture(),calls=[];f.deps.readers=[{platform:'booth',read:async(mode,_signal,context)=>{calls.push({mode,at:context.now});return {state:'ready',observations:[],message:'ok'}}}];
 const monitor=new LinkInboxMonitor(f.deps);monitor.start();const tick=async()=>{t.mock.timers.tick(30000);await new Promise(r=>setImmediate(r))};
 try{for(let i=0;i<8;i++)await tick();const background=calls.filter(c=>c.mode==='background');assert.equal(background.length,2);assert(background[1].at-background[0].at>=180000);assert(calls.some(c=>c.mode==='foreground'));
  f.prefs.enabled=false;const before=calls.length;await tick();assert.equal(calls.length,before);f.prefs.enabled=true;f.prefs.background=false;await tick();assert.equal(calls.at(-1).mode,'foreground');monitor.stop();const stopped=calls.length;await tick();assert.equal(calls.length,stopped);
 }finally{monitor.stop()}
});
