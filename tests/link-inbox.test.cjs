const {test}=require('node:test'),assert=require('node:assert/strict');
const {extractShareLinks,sourceTime,recency}=require('../dist/main/shared/link-inbox');
const now=Date.parse('2026-10-24T12:00:00+08:00');
test('inbox uses source time, never detection time, at the exact rolling boundary',()=>{
 assert.equal(recency(undefined,now,24),'unknown');assert.equal(recency(now-86400000,now,24),'recent');assert.equal(recency(now-86400001,now,24),'old');assert.equal(recency(now+60000,now,24),'unknown');assert.equal(recency(NaN,now,24),'unknown');
});
test('source timestamps require explicit date or reliable date context; future or invalid dates are unknown',()=>{
 assert.equal(sourceTime('2026-10-24 11:40',now,480),now-20*60000);
 assert.equal(sourceTime('昨天 18:00',now,480),now-18*3600000);
 assert.equal(sourceTime('11:40',now,480),undefined);
 assert.equal(sourceTime('11:40',now,480,'2026-10-24'),now-20*60000);
 assert.equal(sourceTime('2026-02-30 12:00',now,480),undefined);
 assert.equal(sourceTime('刚刚',now,480),undefined);
 assert.equal(sourceTime('2026-10-25 00:00',now,480),undefined);
});
test('extracts multiple complete shares without applying one message code to every link',()=>{
 const result=extractShareLinks('链接 https://pan.baidu.com/s/1ExampleAAA 提取码：abcd\n链接 https://pan.baidu.com/s/1ExampleBBB?pwd=efgh');
 assert.deepEqual(result,[{url:'https://pan.baidu.com/s/1ExampleAAA',code:'abcd',codeConflict:false},{url:'https://pan.baidu.com/s/1ExampleBBB',code:'efgh',codeConflict:false}]);
 assert.deepEqual(extractShareLinks('https://pan.baidu.com/s/1ExampleAAA?pwd=abcd 提取码 efgh'),[{url:'https://pan.baidu.com/s/1ExampleAAA',code:'',codeConflict:true}]);
 assert.equal(extractShareLinks('https://pan.baidu.com.evil.test/s/1ExampleAAA?pwd=abcd file:///secret http://pan.baidu.com/s/1ExampleAAA').length,0);
 assert.equal(extractShareLinks('https://pan.baidu.com/s/1ExampleAAA?token=secret').length,0);
});
