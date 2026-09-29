import {afterEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import {createServer,type Server} from 'node:http';
import {createManagerLanguageRouter} from '../src/managerLanguageRoutes.js';
import {createSessionToken} from '../src/session.js';
import {SESSION_COOKIE_NAME} from '../src/cookies.js';
const secret='synthetic-language-session-secret';
const servers:Server[]=[];
afterEach(async()=>{for(const server of servers.splice(0))await new Promise<void>((resolve,reject)=>{server.closeAllConnections();server.close(e=>e?reject(e):resolve());});});
async function setup(fetchImpl:typeof fetch,configured=true){
 const app=express();app.use(express.json());app.use(createManagerLanguageRouter({sessionSecret:secret,apiKey:configured?'synthetic-private-key':null,model:configured?'test-model':null,allowedOrigins:['https://app.example.test'],fetchImpl}));
 const server=createServer(app);servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw Error('address');
 const url=`http://127.0.0.1:${address.port}/api/manager/interpret`;
 const headers={'content-type':'application/json',cookie:`${SESSION_COOKIE_NAME}=${createSessionToken(secret)}`,origin:'https://app.example.test'};
 return {url,headers};
}
const body=JSON.stringify({question:'What needs my attention?',turns:[]});
const ok=()=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({decision:{action:'greeting',question:null,intents:[]}})}]}]}));
describe('authenticated language route',()=>{
 it('requires a session and approved origin before calling the provider',async()=>{
  const provider=vi.fn(async()=>ok()),{url,headers}=await setup(provider);
  expect((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body})).status).toBe(401);
  expect((await fetch(url,{method:'POST',headers:{...headers,origin:'https://other.example.test'},body})).status).toBe(403);
  expect(provider).not.toHaveBeenCalled();
  const response=await fetch(url,{method:'POST',headers,body});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
 });
 it('rejects bad input and missing configuration without provider spend',async()=>{
  const provider=vi.fn(async()=>ok()),{url,headers}=await setup(provider);
  expect((await fetch(url,{method:'POST',headers,body:JSON.stringify({question:'x',turns:[],tools:['send']})})).status).toBe(400);
  const off=await setup(provider,false);
  expect((await fetch(off.url,{method:'POST',headers:off.headers,body})).status).toBe(503);expect(provider).not.toHaveBeenCalled();
 });
 it('sanitizes provider failures',async()=>{
  const {url,headers}=await setup(vi.fn(async()=>{throw Error('synthetic-private-key');}));
  const response=await fetch(url,{method:'POST',headers,body});expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('synthetic-private-key');
 });
 it('bounds provider requests per gateway minute',async()=>{
  const provider=vi.fn(async()=>ok()),{url,headers}=await setup(provider);
  for(let i=0;i<20;i++)expect((await fetch(url,{method:'POST',headers,body})).status).toBe(200);
  expect((await fetch(url,{method:'POST',headers,body})).status).toBe(429);expect(provider).toHaveBeenCalledTimes(20);
 });
});
