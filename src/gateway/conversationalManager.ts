import {previewCallOwner,confirmCallOwner} from './callOwnerCorrection';
import {reportIntent,requestInsuranceReport,checkInsuranceReport} from './insuranceReport';
import { askManager, executeManagerIntent, type ManagerContext, type ManagerIntent, type ManagerReply } from './managerCommunications';
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid interpretation');return value as Record<string,unknown>;}
/** Validate the read allowlist again at the UI boundary. No model-selected URLs. */
export function readIntent(value:unknown):ManagerIntent{
  const v=object(value),kind=String(v.kind);
  const fields:Record<string,string[]>={insurance:['question'],call_followup_owner:['items','owner'],call_followups:[],calls:['participant','topic','today','latest'],call_facts:['subject','topic'],ledger:['view','participant'],calendar:['range'],search:['phrase'],briefing:[],emails:[],approvals:[],notifications:[],explain:[],repeat:[]};
  if(!Object.hasOwn(fields,kind)||Object.keys(v).some(k=>k!=='kind'&&!fields[kind]!.includes(k)))throw Error('Invalid interpretation');
  for(const [key,value] of Object.entries(v)){
    if(key==='today'||key==='latest'){if(typeof value!=='boolean')throw Error('Invalid interpretation');}
    else if(typeof value!=='string'||!value.trim()||value.length>(key==='question'?2000:200))throw Error('Invalid interpretation');
  }
  if(kind==='call_followup_owner'&&(!/^[1-8]\.[1-8](?:,[1-8]\.[1-8]){0,7}$/.test(String(v.items))||!v.owner))throw Error('Invalid interpretation');
  if(kind==='calendar'&&!['today','tomorrow','week','next'].includes(String(v.range)))throw Error('Invalid interpretation');
  if(kind==='ledger'&&!['today','urgent','overdue','waiting','inbox','promises'].includes(String(v.view)))throw Error('Invalid interpretation');
  if(kind==='call_facts'&&!v.subject||kind==='search'&&!v.phrase)throw Error('Invalid interpretation');
  if(kind==='insurance'&&!v.question)throw Error('Invalid interpretation');
  if(kind==='ledger'){const {participant,...rest}=v;return {...rest,...(participant?{person:participant}:{})} as ManagerIntent;}
  return v as ManagerIntent;
}
const help=(text:string):ManagerReply=>({intent:{kind:'help'},text});
export async function askConversationalManager(question:string,context:ManagerContext={}):Promise<ManagerReply>{
  if(/^check (?:insurance )?report status[.!?]?$/i.test(question.trim()))return checkInsuranceReport();
  if(/^save correction[.!]?$/i.test(question.trim()))return confirmCallOwner(context);
  if(/^cancel correction[.!]?$/i.test(question.trim()))return {...help('Correction cancelled. Nothing was changed.'),followupSelection:context.followupSelection??[]};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25_000);
  let response:Response;
  try{
    response=await fetch('/api/manager/interpret',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},signal:controller.signal,
      body:JSON.stringify({question,turns:(context.turns??[]).slice(-8).map(t=>({role:t.role,text:t.text.slice(0,1500)}))})});
  }catch{return help('I couldn’t interpret that just now. Please try again.');}
  finally{clearTimeout(timer);}
  if(!response.ok){
    const error=await response.json().catch(()=>null);
    if(response.status===503&&error?.error?.code==='LANGUAGE_NOT_CONFIGURED'){
      const reply=await askManager(question,context);
      return reply.intent.kind==='help'?help('Conversational understanding is not enabled yet. I can still handle the existing call, email, calendar and task commands.'):reply;
    }
    return help(response.status===429?'I’m handling another request. Please try again in a moment.':'I couldn’t interpret that just now. Please try again.');
  }
  let plan:Record<string,unknown>,intents:ManagerIntent[];
  try{
    plan=object(await response.json());
    if(!Array.isArray(plan.intents)||plan.intents.length>3)throw Error('Invalid interpretation');
    if(plan.action==='report'){
      if(plan.question!==null||plan.intents.length!==1)throw Error('Invalid interpretation');
      return requestInsuranceReport(reportIntent(plan.intents[0]),question);
    }
    if(plan.action==='clarify'&&plan.intents.length===0&&typeof plan.question==='string'&&plan.question.length<=300&&plan.question.trim().endsWith('?'))return help(plan.question);
    if(plan.action==='unsupported'&&plan.intents.length===0)return help('I can’t carry out that request through this chat yet. Nothing was changed. I can check contractor insurance and COI requirements, and read your connected calls, messages, calendar and task queues; sending, approving or changing records needs the corresponding action workflow.');
    if(plan.action==='greeting'&&plan.intents.length===0)return help('Hi Austin. What would you like to catch up on?');
    if(plan.action!=='read'||plan.question!==null||!plan.intents.length)throw Error('Invalid interpretation');
    intents=plan.intents.map(readIntent);
    if(intents.some(i=>i.kind==='call_followup_owner')&&intents.length!==1)throw Error('Invalid interpretation');
  }catch{return help('I couldn’t reliably interpret that request. Could you tell me which person or work item you mean?');}
  if(intents[0]?.kind==='call_followup_owner')return previewCallOwner(intents[0],context);
  const results=await Promise.allSettled(intents.map(intent=>executeManagerIntent(intent,context)));
  const replies=results.map((result,index)=>result.status==='fulfilled'?result.value:{intent:intents[index]!,text:'That part of the request could not be loaded. Please try again.'});
  const evidence=replies.map(r=>'evidence' in r?r.evidence:undefined).filter(Boolean).join('\n\n');
  return {followupSelection:replies.find(r=>'followupSelection' in r)?.followupSelection,intent:replies.at(-1)!.intent,text:replies.map(r=>r.text).join('\n\n'),...(evidence?{evidence}:{})};
}

