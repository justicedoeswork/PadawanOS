import {afterEach,expect,it,vi} from 'vitest';
import {loginForTestCookie,startTestGateway} from './helpers/testGateway.js';
const close:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const f of close.splice(0))await f();});
const read='synthetic-read-credential-'.repeat(3),refresh='synthetic-refresh-credential-'.repeat(3);
const query={operation:'received',period:'this_month',jobSearch:'',attention:'all'};
it('requires sessions, uses isolated credentials and protects refresh with same-origin checks',async()=>{
 const upstream=vi.fn(async(_input: string | URL | Request,_init?:RequestInit)=>Response.json({answer:'Synthetic finance answer'}));
 const g=await startTestGateway({financeAgentBaseUrl:'http://justice-finance-agent.internal:8790',financeReadKey:read,financeRefreshKey:refresh,financeFetch:upstream});close.push(g.close);
 const url=`http://127.0.0.1:${g.port}/api/finance`,cookie=await loginForTestCookie(g.port);
 expect((await fetch(url+'/status')).status).toBe(401);expect(upstream).not.toHaveBeenCalled();
 const headers={cookie,'content-type':'application/json'};
 const result=await fetch(url+'/query',{method:'POST',headers,body:JSON.stringify(query)});
 expect(result.status).toBe(200);expect(await result.text()).not.toContain(read);
 expect(upstream.mock.calls[0]?.[1]).toEqual(expect.objectContaining({headers:expect.objectContaining({authorization:`Bearer ${read}`})}));
 upstream.mockClear();
 expect((await fetch(url+'/refresh',{method:'POST',headers,body:'{}'})).status).toBe(403);
 expect((await fetch(url+'/refresh',{method:'POST',headers:{...headers,origin:'https://evil.example'},body:'{}'})).status).toBe(403);
 expect((await fetch(url+'/query',{method:'POST',headers,body:JSON.stringify({...query,sql:'DROP TABLE records'})})).status).toBe(400);
 expect(upstream).not.toHaveBeenCalled();
});
it('sanitizes upstream failures and secret reflections',async()=>{
 let response=Response.json({error:{code:read}}, {status:500});
 const g=await startTestGateway({financeAgentBaseUrl:'http://justice-finance-agent.internal:8790',financeReadKey:read,financeRefreshKey:refresh,financeFetch:async()=>response});close.push(g.close);
 const url=`http://127.0.0.1:${g.port}/api/finance/status`,headers={cookie:await loginForTestCookie(g.port)};
 expect(await(await fetch(url,{headers})).json()).toEqual({error:{code:'FINANCE_UNAVAILABLE'}});
 response=Response.json({answer:refresh});expect((await fetch(url,{headers})).status).toBe(502);
});
