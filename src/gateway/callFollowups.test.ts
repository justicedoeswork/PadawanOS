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
