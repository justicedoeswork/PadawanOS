/** Render only persisted call-linked work. Source content stays data, never instructions. */
export type CallContext = {callId:string;occurredAt:string|null;participants:{name:string|null;phone:string|null}[]};
export function openCallFollowups(values:unknown[]): Record<string,unknown>[] {
  const open = new Set(['inbox','immediate','today','scheduled','later','waiting']);
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
export function summarizeCallFollowups(values: unknown[], contexts:Map<string,CallContext>=new Map()): {text:string;evidence?:string} {
  const items=openCallFollowups(values);
  const partial=values.length>=500?' This is a limited ledger sample; older follow-ups may not be included.':'';
  if(!items.length)return {text:'I found no open call-linked follow-ups in the records checked.'+partial};
  const shown=items.slice(0,8);
  const evidence:string[]=[];
  const lines=shown.map((item,index)=>{
    const action=typeof item.title==='string'?item.title.replace(/^(Clarify|Review):\s*/,''):'Review this call follow-up';
    const description=typeof item.description==='string'?item.description:'';
    // Only use application-owned question lines before the untrusted source quote.
    const header=description.split('\nSource quote:')[0]!;
    const context=contexts.get(String(item.originMessageId));
    const label=callLabel(context);
    let question='';
    if(item.itemType==='clarification'){
      if(header.split('\n').includes('Who owns this follow-up, and is it owed to you?'))
        question=context?'Did you agree to do this, or did the other caller? The transcript does not identify the speaker.':'Who is responsible for this, and are they doing it for you?';
      else if(header.split('\n').includes('What deadline should this follow-up use?'))
        question='What deadline should I use for this?';
      else question='Can you confirm who is responsible and whether a deadline was agreed?';
    }
    const owner=typeof item.responsibleParty==='string'?item.responsibleParty:null;
    const assignment=question|| (owner==='austin'?'This is proposed for you to review.':owner?'This is proposed for '+owner+'; please confirm.':'Ownership still needs confirmation.');
    evidence.push(label+'\n'+action+'\n'+description+'\nLedger item: '+String(item.id??'unavailable'));
    return (index+1)+'. '+label+'\n'+action+' — '+assignment;
  });
  return {
    text:'I found '+items.length+' open call follow-up'+(items.length===1?'':'s')+' for review.\n\n'+lines.join('\n\n')+
      (items.length>8?'\n\nThere are '+(items.length-8)+' more in this sample.':'')+partial,
    evidence:evidence.join('\n\n')
  };
}
