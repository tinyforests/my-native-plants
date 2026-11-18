const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('app.js','utf8');let requests=[],responses=[];
const c=vm.createContext({URLSearchParams,AbortSignal,fetch:async url=>{requests.push(String(url));const result=responses.shift();if(result instanceof Error)throw result;return {ok:true,json:async()=>result};},characterFor:()=>'',resolveNVIS:async()=>({system:'MVS',code:'9'})});
vm.runInContext(source.slice(source.indexOf('async function resolveVIC'),source.indexOf('/* fire-and-forget')),c);
(async()=>{
 responses=[{features:[]},{features:[{properties:{evc:55,x_evcname:'Plains Grassy Woodland'}}]}];
 let v=await c.resolve({state:'VIC',lat:-37.8,lng:145});assert.equal(v.system,'EVC');assert.equal(v.code,'55');assert.equal(requests.length,2);assert.match(decodeURIComponent(requests[0]),/nv2005_evcbcs/);assert.notEqual(new URL(requests[0]).searchParams.get('bbox'),new URL(requests[1]).searchParams.get('bbox'));
 responses=[new Error('offline'),{features:[]}];v=await c.resolve({state:'VIC',lat:-37.8,lng:145});assert.equal(v.system,'MVS');
 for(const code of [55,132,175]){const l=JSON.parse(fs.readFileSync(`lists/EVC-${code}.json`));assert.equal(l.reviewed,false);assert(!/MVS|Brunswick|Derrinallum|Ivanhoe|Clifton Hill/.test(l.intro+l.vegSub));}
 console.log('PASS VIC routing, axis retry, MVS fallback and unreviewed neutral copy');
})().catch(e=>{console.error(e);process.exitCode=1;});
