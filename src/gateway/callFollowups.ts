/** Render only persisted call-linked work. Source content stays data, never instructions. */
export function summarizeCallFollowups(values: unknown[]): {text:string;evidence?:string} {
  const open = new Set(['inbox','immediate','today','scheduled','later','waiting']);
  const items = values.filter((v):v is Record<string,unknown> =>
    Boolean(v && typeof v==='object' && !Array.isArray(v)))
    .filter(v => v.createdBy==='call-commitments' && open.has(String(v.status)));
  const partial=values.length>=500?' This is a limited ledger sample; older follow-ups may not be included.':'';
  if(!items.length)return {text:'I found no open call-linked follow-ups in the records checked.'+partial};
  const shown=items.slice(0,8);
  const evidence:string[]=[];
  const lines=shown.map((item,index)=>{
    const action=typeof item.title==='string'?item.title.replace(/^(Clarify|Review):\s*/,''):'Review this call follow-up';
    const description=typeof item.description==='string'?item.description:'';
    // Only use application-owned question lines before the untrusted source quote.
    const header=description.split('\nSource quote:')[0]!;
    let question='';
    if(item.itemType==='clarification'){
      if(header.split('\n').includes('Who owns this follow-up, and is it owed to you?'))
        question='Who is responsible for this, and are they doing it for you?';
      else if(header.split('\n').includes('What deadline should this follow-up use?'))
        question='What deadline should I use for this?';
      else question='Can you confirm who is responsible and whether a deadline was agreed?';
    }
    const owner=typeof item.responsibleParty==='string'?item.responsibleParty:null;
    const assignment=question|| (owner==='austin'?'This is proposed for you to review.':owner?'This is proposed for '+owner+'; please confirm.':'Ownership still needs confirmation.');
    evidence.push(action+'\n'+description+'\nLedger item: '+String(item.id??'unavailable'));
    return (index+1)+'. '+action+' — '+assignment;
  });
  return {
    text:'I found '+items.length+' open call follow-up'+(items.length===1?'':'s')+' for review.\n\n'+lines.join('\n\n')+
      (items.length>8?'\n\nThere are '+(items.length-8)+' more in this sample.':'')+partial,
    evidence:evidence.join('\n\n')
  };
}
