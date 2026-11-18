const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
let data,locked=false,flushed=false,mails=0;
const range=(r,c,n=1,m=1)=>({getValue:()=>data[r-1][c-1],getValues:()=>data.slice(r-1,r-1+n).map(v=>v.slice(c-1,c-1+m)),setValue:v=>{data[r-1][c-1]=v;flushed=false;}});
const sh={getDataRange:()=>({getValues:()=>data.map(r=>r.slice())}),getRange:range,getLastColumn:()=>18,getLastRow:()=>data.length};
const lock={waitLock(){assert(!locked);locked=true;},tryLock(){if(locked)return false;locked=true;return true;},releaseLock(){assert(flushed);locked=false;}};
const ctx=vm.createContext({console,Date,LockService:{getScriptLock:()=>lock},SpreadsheetApp:{flush(){assert(locked);flushed=true;}},HtmlService:{createHtmlOutput:s=>({s,setTitle(){return this;}})},GmailApp:{getAliases:()=>['hello@gardenerandson.com'],sendEmail(){assert(locked);assert(flushed);mails++;}},Logger:{log(){}}});
for(const f of ['Code','Fulfil'])vm.runInContext(fs.readFileSync(`apps-script/${f}.gs`,'utf8'),ctx);
ctx.sheet_=()=>sh;ctx.fetchList_=()=>null;
const row=(email,token,status='CONFIRMED',code='55')=>{let r=Array(18).fill('');Object.assign(r,{0:new Date(),1:email,2:status,3:token,6:'EVC',7:code});return r;};
data=[Array.from(ctx.HEADERS),row('reader@example.invalid','test-a'),row(' READER@example.invalid ','test-b')];
assert.equal(ctx.listKey_('EVC',55),'EVC-55');
const before=JSON.stringify(data);assert.match(ctx.doGet({parameter:{action:'unsubscribe',token:'test-a'}}).s,/method="post"/);assert.equal(JSON.stringify(data),before);
ctx.fulfil_(2);ctx.processQueue();assert.equal(mails,1);assert(data[1][17]&&data[2][17]);
// A later resubmit for the same community inherits the existing claim.
data.push(row('reader@example.invalid','test-c'));ctx.fulfil_(4);assert.equal(mails,1);assert(data[3][17]);
// A different subscriber needs their own alert, even for the same EVC.
data.push(row('other@example.invalid','test-d'));ctx.processQueue();assert.equal(mails,2);
ctx.doPost({parameter:{action:'unsubscribe',token:'test-b'}});assert(data.slice(1,4).every(r=>r[2]==='UNSUBSCRIBED'));
data.push(row('reader@example.invalid','test-e'));ctx.fulfil_(6);ctx.confirm_('test-e');assert.equal(mails,2);assert.equal(data[5][2],'CONFIRMED'); // blocked by sibling, never served
assert.match(ctx.unsubscribeUrl('test-a'),/AKfycbwQAufeg1z8/);
console.log('PASS scanner GET, address suppression, POST, alert claim/flush and EVC list key');
