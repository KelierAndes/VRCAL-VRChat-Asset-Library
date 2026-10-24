const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const build=process.env.VRCAL_INBOX_TEST_BUILD||path.join(__dirname,'../dist/main');
let relativeInboxTime;try{({relativeInboxTime}=require(path.join(build,'main/inbox-relative-time')))}catch{}
const {recency}=require(path.join(build,'shared/link-inbox'));
const now=1800000000000;

test('relative inbox times use the oldest instant in the displayed bucket, never an invented exact instant',()=>{
 assert.equal(typeof relativeInboxTime,'function');
 for(const [raw,want] of [['刚刚',1799999940000],['2分钟前',1799999820000],['5小时前',1799978400000],['11小时前',1799956800000],['23小时前',1799913600000],['1天前',1799827200000],['3天前',1799654400000],[' 2分钟前 ',1799999820000]])assert.equal(relativeInboxTime(raw,now),want,raw);
});
test('six, twelve and twenty-four hour notifications reject buckets extending beyond the selected window',()=>{
 assert.equal(typeof relativeInboxTime,'function');
 for(const [hours,edge,outside] of [[6,'5小时前','6小时前'],[12,'11小时前','12小时前'],[24,'23小时前','24小时前']]){
  assert.equal(recency(relativeInboxTime(edge,now),now,hours),'recent');
  assert.equal(recency(relativeInboxTime(outside,now),now,hours),'old');
 }
 assert.equal(recency(relativeInboxTime('359分钟前',now),now,6),'recent');
 assert.equal(recency(relativeInboxTime('360分钟前',now),now,6),'old');
 assert.equal(recency(relativeInboxTime('1天前',now),now,24),'old');
 assert.equal(recency(relativeInboxTime('3天前',now),now,24),'old');
});
test('only bounded whole-number official relative labels with positive safe timestamps qualify',()=>{
 assert.equal(typeof relativeInboxTime,'function');
 for(const raw of [undefined,null,3,{},'', '12:34','昨天 12:34','刚刚有人发来','1.5小时前','-1分钟前','+2分钟前','01分钟前','1e2分钟前','Infinity小时前','1 小时前','9007199254740991分钟前','1'.repeat(101)+'分钟前'])assert.equal(relativeInboxTime(raw,now),undefined,String(raw));
 for(const invalidNow of [undefined,null,'1800000000000',NaN,Infinity,-Infinity,0,-1,now+0.5,Number.MAX_SAFE_INTEGER+1])assert.equal(relativeInboxTime('刚刚',invalidNow),undefined,String(invalidNow));
 assert.equal(relativeInboxTime('刚刚',60000),undefined);
 assert.equal(relativeInboxTime('2分钟前',120000),undefined);
});
