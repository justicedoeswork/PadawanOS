import type {ManagerContext,ManagerIntent,ManagerReply} from './managerCommunications';
const help=(text:string):ManagerReply=>({intent:{kind:'help'},text});
async function post(path:string,body:unknown){
 const response=await fetch('/api/call-followup-owner/'+path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20_000)});
 return {ok:response.ok,status:response.status,body:await response.json()};
}
export async function previewCallOwner(intent:Extract<ManagerIntent,{kind:'call_followup_owner'}>,context:ManagerContext):Promise<ManagerReply>{
 const refs=intent.items.split(','),selection=context.followupSelection??[];
 const items=refs.map(ref=>selection.find(item=>item.ref===ref));
 if(!refs.length||refs.length>8||new Set(refs).size!==refs.length||items.some(item=>!item))return help('Please ask for your call follow-ups again so I can show the exact tasks before saving an owner.');
 try{
  const result=await post('preview',{items:items.map(item=>({id:item!.id,version:item!.version})),owner:intent.owner});
  if(!result.ok)return help(result.status===503?'Saving ownership corrections is not enabled yet. Nothing was changed.':result.status===409?'Those follow-ups changed. Please ask for them again before correcting ownership.':'I couldn’t prepare that correction. Nothing was changed.');
  const review=result.body.review;
  if(typeof result.body.token!=='string'||!review||typeof review.owner!=='string'||!Array.isArray(review.items)||review.items.length!==items.length)throw Error('invalid');
  const lines=review.items.map((entry:{id:string;title:string;callId:string})=>{
   const selected=items.find(item=>item!.id===entry.id);
   if(!selected||selected.callId!==entry.callId||typeof entry.title!=='string')throw Error('invalid');
   return selected.ref+' '+entry.title.replace(/^(Clarify|Review):\s*/,'');
  });
  const text='I’ll record '+(review.owner==='austin'?'you':review.owner)+' as responsible for:\n'+lines.join('\n')+'\n\nSay “save correction” to save this, or “cancel correction”. This changes task ownership only; deadlines and who the work is owed to stay unchanged.';
  return {intent,text,followupSelection:selection,pendingOwnerReview:{token:result.body.token,text}};
 }catch{return help('I couldn’t prepare that correction. Nothing was changed.');}
}
export async function confirmCallOwner(context:ManagerContext):Promise<ManagerReply>{
 if(!context.pendingOwnerReview)return help('There is no ownership correction ready to save. Tell me which call follow-up and who is responsible.');
 try{
  const result=await post('confirm',{token:context.pendingOwnerReview.token});
  const saved=Array.isArray(result.body.saved)?result.body.saved.length:0;
  if(!result.ok)return {...help('The correction did not finish. '+saved+' task owner update(s) are confirmed saved. Ask for your call follow-ups again to check the current owners before retrying.'),followupSelection:[]};
  return {intent:{kind:'call_followups'},text:'Saved '+saved+' task owner correction'+(saved===1?'':'s')+' to your call follow-ups. I’ll use the recorded owner when you ask again.',followupSelection:[]};
 }catch{return {...help('I couldn’t confirm whether the correction saved. Ask for your call follow-ups again to check the current owners before retrying.'),followupSelection:[]};}
}
