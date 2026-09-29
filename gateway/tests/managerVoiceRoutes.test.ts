import {afterEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import {createServer,type Server} from 'node:http';
import {createManagerVoiceRouter} from '../src/managerVoiceRoutes.js';
import {createSessionToken} from '../src/session.js';
import {SESSION_COOKIE_NAME} from '../src/cookies.js';
const secret='synthetic-voice-session-secret',servers:Server[]=[];
afterEach(async()=>{for(const server of servers.splice(0))await new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());});});
async function setup(provider:typeof fetch,key:string|null='synthetic-key'){
  const app=express();app.use(express.json());app.use(createManagerVoiceRouter({sessionSecret:secret,apiKey:key,allowedOrigins:['https://app.example.test'],fetchImpl:provider}));
  const server=createServer(app);servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('address');
  return {url:`http://127.0.0.1:${address.port}/api/manager/transcribe`,headers:{'content-type':'audio/webm;codecs=opus',origin:'https://app.example.test',cookie:`${SESSION_COOKIE_NAME}=${createSessionToken(secret)}`}};
}
describe('voice transcription boundary',()=>{
 it('requires authentication, explicit trusted origin and audio format before spending',async()=>{
   const provider=vi.fn(async()=>new Response('{}')),{url,headers}=await setup(provider);
   expect((await fetch(url,{method:'POST',headers:{'content-type':'audio/webm'},body:'audio'})).status).toBe(401);
   expect((await fetch(url,{method:'POST',headers:{...headers,origin:'https://outside.example'},body:'audio'})).status).toBe(403);
   expect((await fetch(url,{method:'POST',headers:{...headers,origin:''},body:'audio'})).status).toBe(403);
   expect((await fetch(url,{method:'POST',headers:{...headers,'content-type':'text/plain'},body:'audio'})).status).toBe(415);
   expect(provider).not.toHaveBeenCalled();
 });
 it('sends bounded audio with a server key and returns only text, without executing a request',async()=>{
   const provider=vi.fn(async(_url:unknown,init?:RequestInit)=>{
     expect(init?.headers).toEqual({authorization:'Bearer synthetic-key'});
     const body=init?.body as FormData;expect(body.get('model')).toBe('gpt-transcribe');
     const file=body.get('file') as File;expect(file.name).toBe('question.webm');expect(await file.text()).toBe('synthetic audio');
     return new Response(JSON.stringify({text:'  Show my last call with Morgan  ',languages:[{code:'en'}]}));
   });
   const {url,headers}=await setup(provider);const response=await fetch(url,{method:'POST',headers,body:'synthetic audio'});
   expect(response.status).toBe(200);expect(await response.json()).toEqual({text:'Show my last call with Morgan'});
   expect(response.headers.get('cache-control')).toBe('no-store');expect(provider).toHaveBeenCalledTimes(1);
 });
 it('rejects empty and oversized uploads and absent configuration',async()=>{
   const provider=vi.fn(async()=>new Response('{}')),{url,headers}=await setup(provider);
   expect((await fetch(url,{method:'POST',headers,body:''})).status).toBe(400);
   expect((await fetch(url,{method:'POST',headers,body:'x'.repeat(2_000_001)})).status).toBe(413);
   const off=await setup(provider,null);expect((await fetch(off.url,{method:'POST',headers:off.headers,body:'audio'})).status).toBe(503);
   expect(provider).not.toHaveBeenCalled();
 });
 it.each([
   [new Response('private error',{status:401}),502],
   [new Response(JSON.stringify({text:''})),422],
   [new Response(JSON.stringify({text:'x'.repeat(2001)})),422],
   [new Response('x'.repeat(32001)),502]
 ])('does not expose provider errors or accept unusable transcripts',async(providerResponse,status)=>{
   const {url,headers}=await setup(async()=>providerResponse as Response);
   const response=await fetch(url,{method:'POST',headers,body:'audio'});
   expect(response.status).toBe(status);expect(await response.text()).not.toContain('private error');
 });
 it('limits transcription requests per minute',async()=>{
   const provider=vi.fn(async()=>new Response(JSON.stringify({text:'Hello'}))),{url,headers}=await setup(provider);
   for(let i=0;i<20;i++)expect((await fetch(url,{method:'POST',headers,body:'audio'})).status).toBe(200);
   expect((await fetch(url,{method:'POST',headers,body:'audio'})).status).toBe(429);expect(provider).toHaveBeenCalledTimes(20);
 });
});
