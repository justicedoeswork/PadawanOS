import {afterEach,describe,expect,it,vi} from 'vitest';
import {askManager,classifyManagerQuestion} from './managerCommunications';
afterEach(()=>vi.unstubAllGlobals());
describe('call memory routing',()=>{
  it('routes call questions before the generic today ledger',()=>{
    expect(classifyManagerQuestion('summarize my calls from today')).toEqual({kind:'calls',today:true});
    expect(classifyManagerQuestion('tell me the last thing i spoke about with Chase')).toEqual({kind:'calls',participant:'Chase',latest:true});
    expect(classifyManagerQuestion('when did me and Chase talk about shingles')).toEqual({kind:'calls',participant:'Chase',topic:'shingles'});
    expect(classifyManagerQuestion('what color shingles did Peter say he wants on his roof?')).toEqual({kind:'call_facts',subject:'Peter',topic:'shingle'});
  });
  it('uses server-side today and labels raw transcripts instead of fabricating summaries',async()=>{
    const fetcher=vi.fn(async(_path:string)=>new Response(JSON.stringify({data:{calls:[{messageId:'call-1',occurredAt:'2026-09-28T12:00:00Z',participants:[{displayName:'Chase'}],excerpt:'Roof conversation.',memories:[]}],hasMore:false}})));
    vi.stubGlobal('fetch',fetcher);
    const reply=await askManager('summarize my calls from today');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/communications/call-memory?limit=10&range=today');
    expect(reply.text).toContain('summary not yet saved');expect(reply.text).toContain('Roof conversation.');expect(reply.text).not.toContain('due');
  });
  it('shows partial extraction warnings beside saved notes',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({data:{calls:[{
      messageId:'call-1',occurredAt:'2026-09-28T12:00:00Z',participants:[],
      memories:[{extraction:{summary:[{text:'Roof discussion',quote:'Roof.'}],unresolved:['Partial extraction: omitted 2 items.']}}]
    }],hasMore:false}}))));
    const reply=await askManager('summarize my calls from today');
    expect(reply.text).toContain('Unresolved: Partial extraction: omitted 2 items.');
  });
  it('keeps reported attribution and quotes in the answer and repeats through the same read path',async()=>{
    const fetcher=vi.fn(async(_path:string)=>new Response(JSON.stringify({data:{results:[{messageId:'call-1',occurredAt:'2026-09-28T12:00:00Z',fact:{statement:'Peter wants charcoal shingles.',attribution:'reported',attributedTo:'Chase',quote:'Chase said Peter wants charcoal shingles.'}}],hasMore:false}})));
    vi.stubGlobal('fetch',fetcher);
    const reply=await askManager('what color shingles did Peter say he wants on his roof?');
    expect(reply.text).toContain('Reported source: Chase');expect(reply.text).toContain('Evidence: “Chase said Peter wants charcoal shingles.”');
    expect(reply.text).toContain('not direct confirmation');
    await askManager('show me those',{lastIntent:reply.intent,lastReply:reply.text});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('shows Eastern time across UTC midnight and distinguishes reviewed empty notes from pending notes',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({data:{calls:[{
      messageId:'call-1',occurredAt:'2026-09-29 01:08:13.913971+00',participants:[],excerpt:'Unclear conversation.',
      memories:[{extraction:{summary:[],unresolved:['No supported business summary or facts were retained.']}}]
    }],hasMore:false}}))));
    const reply=await askManager('summarize my calls from today');
    expect(reply.text).toContain('Sep 28, 2026'); expect(reply.text).toContain('9:08 PM EDT');
    expect(reply.text).toContain('reviewed; no supported summary retained');
    expect(reply.text).not.toContain('summary not yet saved');
  });
  it('labels known automated greetings and withheld earlier notes without inventing a conversation',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({data:{calls:[{
      messageId:'call-1',occurredAt:'2026-09-28T12:00:00Z',participants:[],excerpt:'Your call has been forwarded.',
      memories:[],callKind:'automated_greeting',withheldMemories:1
    }],hasMore:false}}))));
    const reply=await askManager('summarize my calls from today');
    expect(reply.text).toContain('Automated greeting only');
    expect(reply.text).toContain('Earlier notes withheld');
    expect(reply.text).not.toContain('Proposed note:');
  });

});
