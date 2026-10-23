const test=require('node:test'),assert=require('node:assert/strict'),{parseBaiduShare}=require('../dist/main/shared/baidu-download');
test('share text accepts a single official link and keeps extraction code out of the canonical source',()=>{
 assert.deepEqual(parseBaiduShare('通过百度网盘分享的文件：测试\n链接:https://pan.baidu.com/s/1Synthetic?pwd=Ab12\u00a0\n复制这段内容'),{url:'https://pan.baidu.com/s/1Synthetic',code:'Ab12'});
 assert.equal(parseBaiduShare('https://pan.baidu.com/s/1Synthetic 提取码：abcd').code,'abcd');
});
test('share input rejects conflicting codes, credentials, redirects and ambiguous targets',()=>{
 for(const value of ['https://pan.baidu.com.evil.org/s/1Synthetic','http://pan.baidu.com/s/1Synthetic','https://user@pan.baidu.com/s/1Synthetic','https://pan.baidu.com/s/1Synthetic?redirect=https://example.org','https://pan.baidu.com/s/1Synthetic#token','https://pan.baidu.com/s/1Synthetic https://pan.baidu.com/s/1Other','https://pan.baidu.com/s/1Synthetic?pwd=abcd&pwd=abcd'])assert.throws(()=>parseBaiduShare(value));
 assert.throws(()=>parseBaiduShare('https://pan.baidu.com/s/1Synthetic?pwd=abcd','efgh'));
 assert.throws(()=>parseBaiduShare('https://pan.baidu.com/s/1Synthetic','12345'));
});
