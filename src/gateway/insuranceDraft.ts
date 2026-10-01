import type { ManagerReply, ManagerIntent } from './managerCommunications';

export type InsuranceDraftIntent={kind:'insurance_draft';contractor:string;coverageType:'wc'|'gl'};
type Request={requestId:string;requestText:string;contractor:string;coverageType:'wc'|'gl'};
type Saved={request:Request;status:'pending'|'completed'|'review'};
const KEY='justiceos.insurance.draft.requests.v1';
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(text:string,intent:InsuranceDraftIntent):ManagerReply=>({intent,text});
export function draftIntent(raw:unknown):InsuranceDraftIntent{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid draft action');
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='contractor,coverageType,kind'||v.kind!=='insurance_draft'||
    typeof v.contractor!=='string'||!v.contractor.trim()||v.contractor.length>200||/[\x00-\x1f]/.test(v.contractor)||
    (v.coverageType!=='wc'&&v.coverageType!=='gl'))throw Error('Invalid draft action');
  return {kind:'insurance_draft',contractor:v.contractor.trim(),coverageType:v.coverageType};
}
function readSaved():Saved[]{
  const raw=JSON.parse(sessionStorage.getItem(KEY)??'[]') as unknown;
  if(!Array.isArray(raw)||raw.length>50)throw Error('Invalid saved requests');
  return raw.map(value=>{
    if(!value||typeof value!=='object')throw Error('Invalid saved request');
    const v=value as Saved;const r=v.request;
    draftIntent({kind:'insurance_draft',contractor:r?.contractor,coverageType:r?.coverageType});
    if(!id.test(r.requestId)||typeof r.requestText!=='string'||!r.requestText||r.requestText.length>2000||!['pending','completed','review'].includes(v.status))throw Error('Invalid saved request');
    return v;
  });
}
function formatDraft(d:Record<string,unknown>,intent:InsuranceDraftIntent):string{
  const recipient=d.recipient as Record<string,unknown>|null;
  if(!recipient||typeof recipient.email!=='string'||typeof d.subject!=='string'||typeof d.body!=='string')throw Error('Invalid draft result');
  const name=typeof recipient.name==='string'&&recipient.name?`${recipient.name} `:'';
  const source=typeof d.sourceFileName==='string'&&d.sourceFileName?`\nSource certificate: ${d.sourceFileName}.`:'';
  return `Saved a review-only ${intent.coverageType==='gl'?'General Liability':'Workers’ Compensation'} email draft. It was not sent.\n\nTo: ${name}<${recipient.email}>\nSubject: ${d.subject}\n\n${d.body}${source}`;
}
async function submit(saved:Saved,statusOnly=false):Promise<ManagerReply>{
  const intent=draftIntent({kind:'insurance_draft',contractor:saved.request.contractor,coverageType:saved.request.coverageType});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),190_000);
  try{
    const response=await fetch('/api/insurance/draft'+(statusOnly?'/status':''),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},signal:controller.signal,body:JSON.stringify(saved.request)});
    if(!response.ok)return reply('I couldn’t confirm the saved draft status. Nothing was sent. Retry with the same request.',intent);
    const result=await response.json() as Record<string,unknown>;
    if(result.requestId!==saved.request.requestId||result.sent!==false||!['not_started','completed','needs_review'].includes(String(result.status)))return reply('I couldn’t confirm the saved draft status. Nothing was sent.',intent);
    const records=readSaved(),record=records.find(r=>r.request.requestId===saved.request.requestId);
    if(record){record.status=result.status==='completed'?'completed':result.status==='not_started'?'review':'review';sessionStorage.setItem(KEY,JSON.stringify(records));}
    if(result.status==='not_started')return reply('That draft request was not recorded. Nothing was sent.',intent);
    if(result.status==='completed')return reply(formatDraft(result.draft as Record<string,unknown>,intent),intent);
    return reply('The draft request needs review before it can be confirmed. Nothing was sent.',intent);
  }catch{return reply('I couldn’t confirm the saved draft status. Nothing was sent. Retry with the same request.',intent);}finally{clearTimeout(timer);}
}
export async function requestInsuranceDraft(intent:InsuranceDraftIntent,question:string):Promise<ManagerReply>{
  try{
    draftIntent(intent);if(!question.trim()||question.length>2000)throw Error('Invalid request');
    const records=readSaved();
    const prior=[...records].reverse().find(r=>r.status!=='completed'&&r.request.requestText===question.trim()&&r.request.contractor===intent.contractor&&r.request.coverageType===intent.coverageType);
    const saved=prior??{request:{requestId:crypto.randomUUID(),requestText:question.trim(),contractor:intent.contractor,coverageType:intent.coverageType},status:'pending' as const};
    if(!prior){if(records.length>=50)throw Error('Saved draft limit reached');records.push(saved);sessionStorage.setItem(KEY,JSON.stringify(records));}
    return submit(saved);
  }catch{return reply('I couldn’t save this draft request for safe status checking, so I haven’t started it. Nothing was sent.',intent);}
}
export function checkInsuranceDraft():Promise<ManagerReply>{
  try{const saved=readSaved().at(-1);if(saved)return submit(saved,true);}catch{/* no action without a saved request */}
  return Promise.resolve({intent:{kind:'help'},text:'There is no saved insurance email draft request in this tab.'});
}
