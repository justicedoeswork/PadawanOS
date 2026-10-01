import type { ManagerReply } from './managerCommunications';

export type InsuranceReportIntent={kind:'insurance_report';search:string;activeOnly:boolean;email:boolean};
type Request={requestId:string;requestText:string;search:string;activeOnly:boolean;email:boolean};
type Saved={request:Request;status:'pending'|'completed'|'review'};
const KEY='justiceos.insurance.report.requests.v1';
const reply=(text:string,intent:InsuranceReportIntent):ManagerReply=>({intent,text});
export function reportIntent(raw:unknown):InsuranceReportIntent {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid report action');
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='activeOnly,email,kind,search'||v.kind!=='insurance_report'||
    typeof v.search!=='string'||v.search.length>200||/[\x00-\x1f]/.test(v.search)||
    typeof v.email!=='boolean'||typeof v.activeOnly!=='boolean')throw Error('Invalid report action');
  return {kind:'insurance_report',search:v.search.trim(),email:v.email,activeOnly:v.activeOnly};
}
function readSaved():Saved[] {
  const raw=JSON.parse(sessionStorage.getItem(KEY)??'[]') as unknown;
  if(!Array.isArray(raw)||raw.length>50)throw Error('Invalid saved requests');
  return raw.map(value=>{
    if(!value||typeof value!=='object')throw Error('Invalid saved request');
    const v=value as Saved;
    reportIntent({kind:'insurance_report',search:v.request?.search,email:v.request?.email,activeOnly:v.request?.activeOnly});
    if(!['pending','completed','review'].includes(v.status)||typeof v.request.requestId!=='string'||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.request.requestId)||
      typeof v.request.requestText!=='string'||!v.request.requestText||v.request.requestText.length>2000)throw Error('Invalid saved request');
    return v;
  });
}
async function submit(saved:Saved):Promise<ManagerReply> {
  const intent=reportIntent({kind:'insurance_report',search:saved.request.search,activeOnly:saved.request.activeOnly,email:saved.request.email});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),190_000);
  const unknown=`I couldn’t confirm this report’s status. Say “check report status” to check the same request without creating or emailing another copy. Request: ${saved.request.requestId}.`;
  try{
    const response=await fetch('/api/insurance/report',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},signal:controller.signal,body:JSON.stringify(saved.request)});
    if(!response.ok)return reply(unknown,intent);
    const result=await response.json() as Record<string,unknown>;
    if(!result||result.requestId!==saved.request.requestId||!['working','completed','partially_completed','failed','needs_review'].includes(String(result.status)))return reply(unknown,intent);
    const records=readSaved(),record=records.find(r=>r.request.requestId===saved.request.requestId);
    if(record){record.status=result.status==='completed'?'completed':result.status==='working'?'pending':'review';sessionStorage.setItem(KEY,JSON.stringify(records));}
    const report=result.report as Record<string,unknown>|null,delivery=result.delivery as Record<string,unknown>|null;
    let document='';
    if(report&&typeof report.driveFileName==='string'&&typeof report.driveFileId==='string'){
      document=`Saved ${report.driveFileName}.`;
      if(typeof report.driveLink==='string'){
        try{const u=new URL(report.driveLink);if(u.protocol==='https:'&&u.hostname==='drive.google.com')document+=`\n${u.toString()}`;}catch{/* no untrusted links */}
      }
    }
    if(result.status==='working')return reply(`${document?document+'\n\n':''}This request is still in progress or awaiting review. Say “check report status” to check it again; I won’t restart it.`,intent);
    if(result.status==='completed'){
      if(!document)return reply(unknown,intent);
      return reply(`${document}${saved.request.email?(delivery?.sent===true?'\n\nOutlook accepted the email with your PDF attached.':'\n\nEmail delivery could not be confirmed. Please check the saved task before requesting another copy.'):''}`,intent);
    }
    return reply(`${document?document+'\n\n':''}${delivery?.sent===true?'Outlook accepted the email, but the final task status needs review. Do not resend it.':delivery?.outcomeUnknown===true?'Email delivery is uncertain. The request is held for review and will not be resent automatically.':'The request could not finish. Its saved task needs review before another attempt.'}`,intent);
  }catch{return reply(unknown,intent);}finally{clearTimeout(timer);}
}
export async function requestInsuranceReport(intent:InsuranceReportIntent,question:string):Promise<ManagerReply> {
  let saved:Saved;
  try{
    reportIntent(intent);
    if(!question.trim()||question.length>2000)throw Error('Invalid request');
    const records=readSaved();
    const prior=[...records].reverse().find(r=>r.status!=='completed'&&r.request.requestText===question.trim()&&
      r.request.search===intent.search&&r.request.activeOnly===intent.activeOnly&&r.request.email===intent.email);
    if(prior)saved=prior;
    else{
      // Save BEFORE posting. If local persistence is blocked, do not start an
      // action whose request ID would be lost when the page reloads.
      if(records.length>=50)throw Error('Saved report limit reached');
      saved={request:{requestId:crypto.randomUUID(),requestText:question.trim(),search:intent.search,activeOnly:intent.activeOnly,email:intent.email},status:'pending'};
      records.push(saved);sessionStorage.setItem(KEY,JSON.stringify(records));
    }
  }catch{return reply('I couldn’t save this report request for safe status checking, so I haven’t started it. Please keep this tab open and check your browser’s storage settings.',intent);}
  return submit(saved);
}
export async function checkInsuranceReport():Promise<ManagerReply> {
  try{const saved=readSaved().at(-1);if(saved)return submit(saved);}catch{/* no action without a saved request */}
  return {intent:{kind:'help'},text:'There is no saved report request in this tab. You can ask me to create a new current insurance summary PDF.'};
}
