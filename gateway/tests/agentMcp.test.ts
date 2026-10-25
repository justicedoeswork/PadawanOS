import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startTestGateway, loginForTestCookie, TEST_ORIGIN } from './helpers/testGateway.js';
import { agentTools, toolsForRole } from '../src/agentTools.js';
import { parseMcpClients } from '../src/agentMcp.js';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
async function connect(headers:Record<string,string>,port:number){
 const client=new Client({name:'synthetic-test',version:'1'});
 await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`),{requestInit:{headers}}));cleanup.push(()=>client.close());return client;
}
describe('shared MCP',()=>{
 it('uses a real SDK client for discovery and reads through the existing finance route',async()=>{
  let reads=0;
  const gw=await startTestGateway({mcpClients:null,financeAgentBaseUrl:'http://justice-finance-agent.internal:8790',financeReadKey:'f'.repeat(40),financeFetch:async(input,init)=>{reads++;expect(String(input)).toBe('http://justice-finance-agent.internal:8790/v1/forecast');expect(init?.method).toBe('GET');return Response.json({available:true,missingBudgetCount:2,totalProfit:null});}});cleanup.push(gw.close);
  const cookie=await loginForTestCookie(gw.port), client=await connect({cookie,origin:TEST_ORIGIN},gw.port);
  const list=await client.listTools();expect(list.tools.map(t=>t.name)).toContain('insurance_question');expect(list.tools.every(t=>t.annotations?.readOnlyHint)).toBe(true);
  const result=await client.callTool({name:'finance_forecast',arguments:{}});
  expect(JSON.parse((result.content as Array<{text:string}>)[0]!.text).totalProfit).toBeNull();expect(reads).toBe(1);
  expect((await client.callTool({name:'finance_forecast',arguments:{url:'https://evil.example'}})).isError).toBe(true);expect(reads).toBe(1);
  expect((await client.callTool({name:'refresh',arguments:{}})).isError).toBe(true);expect(reads).toBe(1);
 });
 it('enforces service scopes on discovery AND calls; cookies cannot escalate an invalid bearer',async()=>{
  const token='m'.repeat(48),hash=createHash('sha256').update(token).digest('hex');
  const gw=await startTestGateway({mcpClients:JSON.stringify([{role:'marketing',sha256:hash}])});cleanup.push(gw.close);
  const client=await connect({authorization:`Bearer ${token}`},gw.port);
  const tools=await client.listTools();expect(tools.tools.map(t=>t.name).sort()).toEqual(['job_context','jobs_search']);
  expect((await client.callTool({name:'finance_balances',arguments:{}})).isError).toBe(true);
  const cookie=await loginForTestCookie(gw.port);
  const r=await fetch(`http://127.0.0.1:${gw.port}/api/mcp`,{method:'POST',headers:{cookie,origin:TEST_ORIGIN,authorization:'Bearer bad','content-type':'application/json'},body:'{}'});expect(r.status).toBe(401);
 });
 it('rejects missing auth, foreign origins, cookie POST without origin and unsupported methods',async()=>{
  const gw=await startTestGateway({mcpClients:null});cleanup.push(gw.close);const url=`http://127.0.0.1:${gw.port}/api/mcp`;
  expect((await fetch(url)).status).toBe(401);const cookie=await loginForTestCookie(gw.port);
  expect((await fetch(url,{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'})).status).toBe(403);
  expect((await fetch(url,{method:'POST',headers:{cookie,origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status).toBe(403);
  expect((await fetch(url,{headers:{cookie}})).status).toBe(405);
  expect((await fetch(url+'?token=bad',{headers:{cookie}})).status).toBe(400);
 });
 it('returns a sanitized unavailable result, never zero or the underlying error body',async()=>{
  const gw=await startTestGateway({mcpClients:null,financeAgentBaseUrl:'http://justice-finance-agent.internal:8790',financeReadKey:'f'.repeat(40),financeFetch:async()=>Response.json({secret:'do-not-return'},{status:500})});cleanup.push(gw.close);
  const client=await connect({cookie:await loginForTestCookie(gw.port),origin:TEST_ORIGIN},gw.port);
  const result=await client.callTool({name:'finance_forecast',arguments:{}});expect(result.isError).toBe(true);expect(JSON.stringify(result)).not.toContain('do-not-return');
 });
 it('denies recursive delegation and writes for every native identity',()=>{
  const tools=agentTools(async()=>({}),async()=>({}));
  for(const role of ['finance','communications','marketing','insurance'] as const){
   expect(toolsForRole(role,tools).map(t=>t.name)).toEqual(role==='finance'?['job_context','jobs_page']:['job_context','jobs_search']);
  }
 });
 it('fails closed on malformed scope configuration',()=>{
  expect(()=>parseMcpClients('[{"role":"admin","sha256":"bad"}]')).toThrow('INVALID_MCP_CLIENT_CONFIGURATION');
 });
 it('preserves structured finance queries and job pagination, rejects write operations',async()=>{
  const requests:unknown[]=[];const tools=agentTools(async(r)=>{requests.push(r);return {unknown:null};});
  const query=tools.find(t=>t.name==='finance_query')!;await query.run({operation:'supplier_job',period:'all_time',jobSearch:'Synthetic Job',attention:'all'});
  await tools.find(t=>t.name==='jobs_page')!.run({offset:25});expect(requests[1]).toEqual({path:'/api/acculynx/jobs?recordStartIndex=25'});
  await tools.find(t=>t.name==='jobs_search')!.run({query:'Synthetic Job'});expect(requests[2]).toEqual({path:'/api/finance/suppliers/jobs?q=Synthetic+Job'});
  expect(()=>query.run({operation:'refresh',period:'all_time',jobSearch:'',attention:'all'})).toThrow();
  expect(toolsForRole('communications',tools).map(t=>t.name)).toEqual(['job_context','jobs_search']);
 });
});
