import {afterEach,expect,it,vi} from 'vitest';
import {askConversationalManager} from './conversationalManager';
import {confirmCallOwner} from './callOwnerCorrection';
const selected={ref:'2.1',id:'item-1',callId:'call-1',version:3,title:'Price stone'};
const context={followupSelection:[selected],turns:[{role:'manager' as const,text:'2. Call with Taylor. 2.1 Price stone. Who is responsible?'}]};
afterEach(()=>vi.unstubAllGlobals());
it('interprets an ownership answer into an exact preview without saving',async()=>{
 const fetcher=vi.fn(async(path:unknown,init?:RequestInit)=>{
  if(String(path).endsWith('/interpret'))return new Response(JSON.stringify({action:'read',question:null,intents:[{kind:'call_followup_owner',items:'2.1',owner:'me'}]}));
  expect(path).toBe('/api/call-followup-owner/preview');expect(JSON.parse(String(init?.body))).toEqual({items:[{id:'item-1',version:3}],owner:'me'});
  return new Response(JSON.stringify({token:'signed-preview',review:{owner:'austin',items:[{id:'item-1',callId:'call-1',title:'Price stone'}]}}));
 });vi.stubGlobal('fetch',fetcher);
 const reply=await askConversationalManager('I am getting the pricing for Taylor',context);
 expect(reply.text).toContain('record you as responsible');expect(reply.text).toContain('save correction');expect(reply.pendingOwnerReview?.token).toBe('signed-preview');
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it('requires a current preview and accepts only the explicit save phrase',async()=>{
 const fake=vi.fn(async()=>new Response(JSON.stringify({saved:['item-1'],owner:'austin'})));vi.stubGlobal('fetch',fake);
 expect((await askConversationalManager('save correction')).text).toContain('no ownership correction');expect(fake).not.toHaveBeenCalled();
 const result=await askConversationalManager('save correction',{...context,pendingOwnerReview:{token:'review',text:'review'}});
 expect(fake).toHaveBeenCalledWith('/api/call-followup-owner/confirm',expect.objectContaining({body:'{"token":"review"}'}));
 expect(result.text).toContain('Saved 1');expect(result.pendingOwnerReview).toBeUndefined();
});
it('does not match missing refs, mixed requests or cancel into a save',async()=>{
 const fake=vi.fn(async()=>new Response(JSON.stringify({action:'read',question:null,intents:[{kind:'call_followup_owner',items:'3.1',owner:'me'}]})));vi.stubGlobal('fetch',fake);
 expect((await askConversationalManager('That is mine',context)).text).toContain('ask for your call follow-ups again');expect(fake).toHaveBeenCalledTimes(1);
 const cancelled=await askConversationalManager('cancel correction',{...context,pendingOwnerReview:{token:'review',text:'review'}});expect(cancelled.pendingOwnerReview).toBeUndefined();expect(fake).toHaveBeenCalledTimes(1);
 fake.mockImplementation(async()=>new Response(JSON.stringify({action:'read',question:null,intents:[{kind:'call_followup_owner',items:'2.1',owner:'me'},{kind:'emails'}]})));
 expect((await askConversationalManager('Change that and read emails',context)).text).toContain('couldn’t reliably interpret');
});
it('does not claim an ambiguous or partial save completed',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({saved:['one'],error:{code:'OWNER_SAVE_INCOMPLETE'}}),{status:502})));
 const result=await confirmCallOwner({pendingOwnerReview:{token:'token',text:'review'}});
 expect(result.text).toContain('1 task owner update(s) are confirmed saved');expect(result.text).toContain('did not finish');
});
