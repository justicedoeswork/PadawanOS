import {afterEach,expect,it,vi} from 'vitest';
import {askFinance,financeIntent} from './finance';
afterEach(()=>vi.unstubAllGlobals());
const intent={kind:'finance' as const,operation:'received' as const,period:'this_month' as const,jobSearch:'',attention:'all' as const};
it('queries through the authenticated gateway and retains the service limitations',async()=>{
 const fetcher=vi.fn(async()=>Response.json({answer:'Period: October. Provisional CRM entries; not bank verified.'}));vi.stubGlobal('fetch',fetcher);
 expect(await askFinance(intent)).toContain('not bank verified');
 expect(fetcher).toHaveBeenCalledWith('/api/finance/query',expect.objectContaining({credentials:'same-origin',method:'POST',body:JSON.stringify({operation:'received',period:'this_month',jobSearch:'',attention:'all'})}));
});
it('rejects write-like or extra fields and returns an honest outage message',async()=>{
 expect(()=>financeIntent({...intent,operation:'refresh'})).toThrow();expect(()=>financeIntent({...intent,url:'https://elsewhere.example'})).toThrow();
 vi.stubGlobal('fetch',async()=>Response.json({}, {status:503}));expect(await askFinance(intent)).toContain('unavailable');
});
