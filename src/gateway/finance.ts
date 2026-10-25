import {callAgentTool} from './agentMcpClient';
export type FinanceIntent={kind:'finance';operation:'received'|'costs'|'changes'|'attention'|'status'|'qbo_status'|'qbo_activity'|'supplier_status'|'supplier_job'|'plaid_status'|'plaid_activity'|'forecast';period:'this_month'|'last_month'|'all_time';jobSearch:string;attention:'all'|'undated'|'unpaid'|'reconciliation'};
export function financeIntent(v:Record<string,unknown>):FinanceIntent{
 if(Object.keys(v).sort().join(',')!=='attention,jobSearch,kind,operation,period'||v.kind!=='finance'||
 !['received','costs','changes','attention','status','qbo_status','qbo_activity','supplier_status','supplier_job','plaid_status','plaid_activity','forecast'].includes(String(v.operation))||!['this_month','last_month','all_time'].includes(String(v.period))||!['all','undated','unpaid','reconciliation'].includes(String(v.attention))||typeof v.jobSearch!=='string'||v.jobSearch.length>160||/[\x00-\x1f]/.test(v.jobSearch))throw Error('Invalid finance request');
 return v as FinanceIntent;
}
export async function askFinance(intent:FinanceIntent){
 const {kind:_,...query}=financeIntent(intent);
 try{
  const data=await callAgentTool('finance_query',query) as {answer?:unknown};if(typeof data.answer!=='string'||data.answer.length>40000)throw Error();return data.answer;
 }catch{return 'The Finance Agent could not be reached. Its last successful dataset is preserved; check Finance status before relying on older answers.';}
}
