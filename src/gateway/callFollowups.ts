/** Render only persisted call-linked work. Source content stays data, never instructions. */
export type CallContext = {callId:string;occurredAt:string|null;participants:{name:string|null;phone:string|null}[]};
export function openCallFollowups(values:unknown[]): Record<string,unknown>[] {
  const open = new Set(['inbox','immediate','today','scheduled','later','waiting','blocked']);
  const items = values.filter((v):v is Record<string,unknown> =>
    Boolean(v && typeof v==='object' && !Array.isArray(v)))
    .filter(v => v.createdBy==='call-commitments' && open.has(String(v.status)));
  return items;
}
function callLabel(context:CallContext|undefined):string {
  if(!context)return 'Call contact details are unavailable.';
  const others=context.participants.filter(p=>!p.name||!['austin','austin justice'].includes(p.name.toLowerCase()));
  const names=others.map(p=>p.name || (p.phone?'the number ending '+p.phone.replace(/\D/g,'').slice(-4)+' (no saved contact name)':'an unnamed contact'));
  const date=context.occurredAt?new Date(context.occurredAt.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00')):null;
  const when=date&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(date):'an unconfirmed time';
  return 'From your call with '+(names.join(' / ')||'an unnamed contact')+' on '+when+' (phone contact record).';
}
/** Relabel only extraction metadata. Never rewrite words inside the source quote. */
function historicalExtraction(description:string):string {
  const quoteAt=description.indexOf('\nSource quote:');
  const header=quoteAt<0?description:description.slice(0,quoteAt);
  const quote=quoteAt<0?'':description.slice(quoteAt);
  const historical=header.split('\n').map(line=>{
    if(line.startsWith('Owner: '))return 'Owner at extraction: '+line.slice('Owner: '.length);
    if(line==='Who owns this follow-up, and is it owed to you?'||line==='What deadline should this follow-up use?')return 'Question raised at extraction: '+line;
    return line;
  }).join('\n');
  return 'Original extracted note (historical):\n'+historical+quote;
}
export type FollowupSelection={ref:string;id:string;version:number;title:string;callId:string};
export function summarizeCallFollowups(values: unknown[], contexts:Map<string,CallContext>=new Map()): {text:string;evidence?:string;followupSelection?:FollowupSelection[]} {
  const items=openCallFollowups(values);
  const partial=values.length>=500?' This is a limited ledger sample; older follow-ups may not be included.':'';
  if(!items.length)return {text:'I found no open call-linked follow-ups in the records checked.'+partial,followupSelection:[]};
  const shown=items.slice(0,8),groups=new Map<string,Record<string,unknown>[]>();
  // Group by immutable source call, never by a contact name or similar wording.
  shown.forEach((item,index)=>{const key=typeof item.originMessageId==='string'?item.originMessageId:'missing-'+index;groups.set(key,[...(groups.get(key)??[]),item]);});
  const evidence:string[]=[],followupSelection:FollowupSelection[]=[];
  const lines=[...groups.entries()].map(([callId,group],index)=>{
    const context=contexts.get(callId),label=callLabel(context).replace(' (phone contact record).','.');
    let needsOwner=false,needsDeadline=false;
    const actions=group.map((item,itemIndex)=>{
      const action=typeof item.title==='string'?item.title.replace(/^(Clarify|Review):\s*/,''):'Review this call follow-up';
      const description=typeof item.description==='string'?item.description:'';
      const header=description.split('\nSource quote:')[0]!;
      const owner=typeof item.responsibleParty==='string'&&item.responsibleParty.trim()?item.responsibleParty:null;
      const ref=(index+1)+'.'+(itemIndex+1);
      if(!owner)needsOwner=true;
      if(item.itemType==='clarification'&&header.split('\n').includes('What deadline should this follow-up use?'))needsDeadline=true;
      const due=header.split('\n').find(line=>line.startsWith('Deadline wording: '))?.slice('Deadline wording: '.length);
      evidence.push(label+'\n'+ref+'. '+action+'\nCurrent task owner: '+(owner==='austin'?'Austin (you)':owner??'unresolved')+'\n'+historicalExtraction(description)+'\nLedger item: '+String(item.id??'unavailable'));
      if(typeof item.id==='string'&&Number.isSafeInteger(item.version)&&Number(item.version)>0)followupSelection.push({ref,id:item.id,version:Number(item.version),title:action,callId});
      return ref+' '+action+(owner?' — recorded owner: '+(owner==='austin'?'you':owner):'')+(due&&due!=='none stated'?' (timing mentioned: “'+due+'”)':'')+'.';
    });
    const questions:string[]=[];
    if(needsOwner)questions.push(context?'Which of these were yours to handle, and which were the other caller’s?':'Who is responsible for these follow-ups?');
    if(needsDeadline)questions.push('What deadline should I use?');
    return (index+1)+'. '+label+'\n'+actions.join('\n')+(questions.length?'\n'+questions.join(' '):'');
  });
  return {text:'I found '+items.length+' open call follow-up'+(items.length===1?'':'s')+', grouped by call.\n\n'+lines.join('\n\n')+
    (items.length>8?'\n\nShowing 8; there are '+(items.length-8)+' more in this sample.':'')+partial,
    evidence:evidence.join('\n\n'),followupSelection};
}
