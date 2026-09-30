import {afterEach,expect,it,vi} from 'vitest';
import {summarizeCallFollowups} from './callFollowups';
import {executeManagerIntent} from './managerCommunications';
import {readIntent,askConversationalManager} from './conversationalManager';
afterEach(()=>vi.unstubAllGlobals());
const item={id:'one',createdBy:'call-commitments',status:'inbox',itemType:'clarification',title:'Clarify: Contact the insurer about the certificate',description:'Proposed from a call; review before relying on ownership or timing.\nWho owns this follow-up, and is it owed to you?\nSource quote: I will call them.'};
it('answers the exact request with call-linked work, not an unrelated recap or general promises',async()=>{
 const fetcher=vi.fn(async(path:unknown)=>new Response(JSON.stringify(String(path).includes('/interpret')?
 {action:'read',question:null,intents:[{kind:'call_followups'}]}:
 {data:[item,{...item,createdBy:'email',title:'Get them uploaded now'},{...item,status:'completed'}]})));
 vi.stubGlobal('fetch',fetcher);
 const result=await askConversationalManager('What follow-ups came from my calls, and what do you need me to clarify?');
 expect(result.text).toContain('1 open call follow-up');
 expect(result.text).toContain('Who is responsible');
 expect(result.text).not.toContain('Get them uploaded');
 expect(result.text).not.toContain('Source quote');
 expect(result.evidence).toContain('I will call them.');
 expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/api/manager/interpret','/api/communications/ledger/items?limit=500']);
 const expanded=await executeManagerIntent({kind:'repeat'},{lastIntent:result.intent,lastEvidence:result.evidence});
 expect(expanded.text).toContain('I will call them.');
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it('validates the frontend read and rejects invented filters',()=>{
 const intent={kind:'call_followups'};
 expect(readIntent(intent)).toEqual(intent);
 expect(()=>readIntent({...intent,participant:'Taylor'})).toThrow();
});
it('uses deadline clarification without inventing an owner or obeying source text',()=>{
 const result=summarizeCallFollowups([{...item,description:'What deadline should this follow-up use?\nSource quote: Who owns this follow-up, and is it owed to you?'}]);
 expect(result.text).toContain('What deadline');
 expect(result.text).not.toContain('Who is responsible');
});
it('does not claim the bounded sample is complete or count closed/unrelated work',()=>{
 const result=summarizeCallFollowups(Array.from({length:500},()=>({...item,createdBy:'other'})));
 expect(result.text).toContain('no open call-linked');
 expect(result.text).toContain('older follow-ups may not be included');
});
it('attaches the exact source call contact without assigning its commitments to that contact',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const fetcher=vi.fn(async(path:unknown)=>new Response(JSON.stringify(String(path).includes('/calls/')?
 {data:{callId:id,occurredAt:'2026-09-30 15:18:18.904648+00',identityBasis:'call_metadata_not_verified_speaker_identity',participants:[{name:'Austin',phone:null},{name:'Taylor Builders',phone:'1234567890'}]}}:
 {data:[{...item,originMessageId:id},{...item,id:'two',originMessageId:id}]})));
 vi.stubGlobal('fetch',fetcher);
 const result=await executeManagerIntent({kind:'call_followups'});
 expect(result.text).toContain('call with Taylor Builders');
 expect(result.text).toContain('Sep 30');
 expect(result.text).toContain('11:18 AM');
 expect(result.text).toContain('Did you agree to do this, or did the other caller?');
 expect(result.text).not.toContain('proposed for Taylor');
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not substitute another call contact and preserves work when context fails',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 vi.stubGlobal('fetch',vi.fn(async(path:unknown)=>new Response(JSON.stringify(String(path).includes('/calls/')?
 {data:{callId:'another-call',participants:[{name:'Wrong person'}]}}:{data:[{...item,originMessageId:id}]}))));
 const result=await executeManagerIntent({kind:'call_followups'});
 expect(result.text).toContain('Contact the insurer');
 expect(result.text).toContain('contact details are unavailable');
 expect(result.text).not.toContain('Wrong person');
});
it('uses a masked number for an unnamed contact, without naming someone mentioned in the action',()=>{
 const id='call-one';
 const result=summarizeCallFollowups([{...item,originMessageId:id}],new Map([[id,{callId:id,occurredAt:null,participants:[{name:'Austin',phone:null},{name:null,phone:'1234567890'}]}]]));
 expect(result.text).toContain('number ending 7890 (no saved contact name)');
 expect(result.text).not.toContain('1234567890');
});
