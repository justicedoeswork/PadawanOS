import {afterEach,expect,it,vi} from 'vitest';
import express from 'express';
import {createCallOwnerRouter,type OwnerRouteOptions} from '../src/callOwnerRoutes.js';
import {createSessionToken} from '../src/session.js';
import {SESSION_COOKIE_NAME} from '../src/cookies.js';
const secret='owner-test-session-secret-not-real',origin='https://justiceos.test';
const id='00000000-0000-4000-8000-000000000001',callId='00000000-0000-4000-8000-000000000002';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
async function setup(overrides:Partial<OwnerRouteOptions>={}){
 let item:Record<string,unknown>={id,originMessageId:callId,title:'Clarify: Get stone pricing',createdBy:'call-commitments',status:'inbox',version:1,responsibleParty:null};
 const get=vi.fn(async()=>({kind:'response' as const,status:200,body:{data:{item:{...item}}}}));
 const write=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const data=JSON.parse(String(init?.body));
  if(data.expectedVersion!==item.version)return new Response('{}',{status:409});
  item={...item,...data.changes,version:Number(item.version)+1};
  return new Response(JSON.stringify({data:item}));
 });
 const app=express();app.use(express.json());
 app.use(createCallOwnerRouter({sessionSecret:secret,allowedOrigins:[origin],baseUrl:'https://communications.test',readKey:'read-key',writeKey:'write-key',client:{get,probe:async()=> 'REACHABLE'},fetchImpl:write as typeof fetch,...overrides}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 cleanups.push(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
 const address=server.address();if(!address||typeof address==='string')throw Error('port');
 const cookie=SESSION_COOKIE_NAME+'='+createSessionToken(secret);
 const post=(route:string,body:unknown,headers:Record<string,string>={})=>fetch('http://127.0.0.1:'+address.port+'/api/call-followup-owner/'+route,{method:'POST',headers:{cookie,origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 return {post,get,write,set:(changes:Record<string,unknown>)=>{item={...item,...changes};},item:()=>item};
}
const selection={items:[{id,version:1}],owner:'me'};
it('requires login, allowed origin and optional write configuration before touching records',async()=>{
 const s=await setup();
 expect((await s.post('preview',selection,{cookie:''})).status).toBe(401);
 expect((await s.post('preview',selection,{origin:'https://evil.test'})).status).toBe(403);
 expect((await s.post('preview',selection,{origin:''})).status).toBe(403);
 expect(s.get).not.toHaveBeenCalled();expect(s.write).not.toHaveBeenCalled();
 const disabled=await setup({writeKey:null});expect((await disabled.post('preview',selection)).status).toBe(503);
});
it('previews without writing, saves only the owner, and safely retries without another write',async()=>{
 const s=await setup();const preview=await s.post('preview',selection);expect(preview.status).toBe(200);
 const body=await preview.json();expect(body.review.owner).toBe('austin');expect(s.write).not.toHaveBeenCalled();
 expect((await s.post('confirm',{token:body.token})).status).toBe(200);
 expect(s.item().responsibleParty).toBe('austin');
 const [url,init]=s.write.mock.calls[0]!;
 expect(url).toBe('https://communications.test/api/v1/ledger/items/'+id);
 expect(JSON.parse(String(init?.body))).toEqual({expectedVersion:1,changes:{responsibleParty:'austin'},reason:expect.stringContaining('not transcript speaker identity')});
 expect(init?.headers).toEqual({authorization:'Bearer write-key','content-type':'application/json'});
 expect((await s.post('confirm',{token:body.token})).status).toBe(200);expect(s.write).toHaveBeenCalledTimes(1);
});
it('rejects forged, expired and other-session reviews',async()=>{
 let clock=0;const s=await setup({now:()=>clock});const {token}=await (await s.post('preview',selection)).json();
 expect((await s.post('confirm',{token:token+'a'})).status).toBe(400);
 expect((await s.post('confirm',{token},{cookie:SESSION_COOKIE_NAME+'='+createSessionToken(secret)})).status).toBe(400);
 clock=600001;expect((await s.post('confirm',{token})).status).toBe(409);expect(s.write).not.toHaveBeenCalled();
});
it('rejects unrelated items, stale versions, extra fields and duplicate selections',async()=>{
 const s=await setup();
 expect((await s.post('preview',{...selection,send:true})).status).toBe(400);
 expect((await s.post('preview',{...selection,items:[...selection.items,...selection.items]})).status).toBe(400);
 s.set({createdBy:'email'});expect((await s.post('preview',selection)).status).toBe(502);
 s.set({createdBy:'call-commitments',version:2});expect((await s.post('preview',selection)).status).toBe(409);
 s.set({version:1});const {token}=await (await s.post('preview',selection)).json();
 s.set({version:2,responsibleParty:'Someone else'});expect((await s.post('confirm',{token})).status).toBe(409);expect(s.write).not.toHaveBeenCalled();
});
it('reports uncertain writes without claiming success',async()=>{
 const s=await setup({fetchImpl:async()=>{throw Error('connection lost');}});
 const {token}=await (await s.post('preview',selection)).json();
 const result=await s.post('confirm',{token});expect(result.status).toBe(502);
 expect(await result.json()).toEqual({error:{code:'OWNER_SAVE_UNCERTAIN'},saved:[]});
});
