export type FinanceIntent={kind:'finance';operation:'received'|'costs'|'changes'|'attention'|'status'|'qbo_status'|'qbo_activity'|'supplier_status'|'supplier_job';period:'this_month'|'last_month'|'all_time';jobSearch:string;attention:'all'|'undated'|'unpaid'|'reconciliation'};
export function financeIntent(v:Record<string,unknown>):FinanceIntent{
 if(Object.keys(v).sort().join(',')!=='attention,jobSearch,kind,operation,period'||v.kind!=='finance'||
 !['received','costs','changes','attention','status','qbo_status','qbo_activity','supplier_status','supplier_job'].includes(String(v.operation))||!['this_month','last_month','all_time'].includes(String(v.period))||!['all','undated','unpaid','reconciliation'].includes(String(v.attention))||typeof v.jobSearch!=='string'||v.jobSearch.length>160||/[\x00-\x1f]/.test(v.jobSearch))throw Error('Invalid finance request');
 return v as FinanceIntent;
}
export async function askFinance(intent:FinanceIntent){
 const {kind:_,...query}=financeIntent(intent);
 try{
  const r=await fetch('/api/finance/query',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(query),signal:AbortSignal.timeout(25000)});
  if(!r.ok)return 'Finance data is unavailable right now. Open Finance status to check the last successful refresh and retry later.';
  const data=await r.json();if(typeof data.answer!=='string'||data.answer.length>40000)throw Error();return data.answer;
 }catch{return 'The Finance Agent could not be reached. Its last successful dataset is preserved; check Finance status before relying on older answers.';}
}
