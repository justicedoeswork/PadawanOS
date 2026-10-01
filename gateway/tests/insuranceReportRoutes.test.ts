import {afterEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {createInsuranceReportRouter,parseReportRequest,reportUpstream} from '../src/insuranceReportRoutes.js';
import {createSessionToken} from '../src/session.js';
const servers:http.Server[]=[];
afterEach(async()=>{for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(resolve=>s.close(()=>resolve()));}});
const request={requestId:'00000000-0000-4000-8000-000000000001',requestText:'Create a PDF and email it to me',search:'',email:true,activeOnly:false};
async function setup(fetchImpl:typeof fetch){
 const app=express();app.use(express.json());app.use(createInsuranceReportRouter({sessionSecret:'session-test-secret',allowedOrigins:['https://manager.example.invalid'],
  acpUrl:'ws://insurance-audit-agent.internal:3001/acp',serviceKey:'private-service-key',userId:'austin',realmId:'realm',fetchImpl}));
 const server=http.createServer(app);servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/insurance/report`,headers:{cookie:`justiceos_session=${createSessionToken('session-test-secret')}`,
  origin:'https://manager.example.invalid','content-type':'application/json'}};
}
describe('authenticated insurance report gateway',()=>{
 it('derives only the fixed private route and rejects public or credential-bearing URLs',()=>{
  expect(reportUpstream('ws://insurance-audit-agent.internal:3001/acp')).toBe('http://insurance-audit-agent.internal:3001/manager/insurance/report');
  for(const u of ['https://public.example/acp','ws://other.internal/acp','ws://user:password@insurance-audit-agent.internal/acp','ws://insurance-audit-agent.internal/acp?x=1'])expect(reportUpstream(u)).toBeNull();
  expect(()=>parseReportRequest({...request,realmId:'other'})).toThrow();
 });
 it('requires the signed session and same-origin JSON before any upstream request',async()=>{
  const fake=vi.fn(async()=>new Response('{}'));const {url,headers}=await setup(fake);
  const send=(h:Record<string,string>,body:unknown=request)=>fetch(url,{method:'POST',headers:h,body:JSON.stringify(body)});
  expect((await send({'content-type':'application/json'})).status).toBe(401);
  expect((await send({...headers,origin:''})).status).toBe(403);
  expect((await send({...headers,origin:'https://untrusted.example'})).status).toBe(403);
  expect((await send({...headers,'content-type':'text/plain'})).status).toBe(415);
  expect((await send(headers,{...request,to:'another@example.invalid'})).status).toBe(400);
  expect(fake).not.toHaveBeenCalled();
 });
 it('forwards server-owned credentials and scope to the fixed endpoint without browser secrets',async()=>{
  const fake=vi.fn(async(_input:unknown,init?:RequestInit)=>new Response(JSON.stringify({requestId:JSON.parse(String(init?.body)).requestId,status:'working'}),{status:202}));
  const {url,headers}=await setup(fake);const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(request)});
  expect(response.status).toBe(202);expect(await response.text()).not.toContain('private-service-key');
  expect(fake.mock.calls[0]?.[0]).toBe('http://insurance-audit-agent.internal:3001/manager/insurance/report');
  expect(fake.mock.calls[0]?.[1]).toMatchObject({redirect:'error',headers:{authorization:'Bearer private-service-key','x-acp-user-id':'austin','x-acp-realm-id':'realm'}});
 });
 it('does not leak provider failures or accept a mismatched request response',async()=>{
  for(const output of [new Response('secret provider diagnostic',{status:500}),new Response(JSON.stringify({requestId:'other',status:'completed'})),new Response('x'.repeat(33_000))]){
   const {url,headers}=await setup(async()=>output);const result=await fetch(url,{method:'POST',headers,body:JSON.stringify(request)});
   expect(result.status).toBe(502);expect(await result.text()).not.toContain('secret provider');
  }
 });
});
