import {afterEach,describe,expect,it,vi} from 'vitest';
import {askManager,classifyManagerQuestion,executeManagerIntent} from './managerCommunications';
afterEach(()=>vi.unstubAllGlobals());
describe('call memory routing',()=>{
  it('answers with a recap and retains exact evidence for expansion without re-fetching a newer call',async()=>{
    const fake=vi.fn(async()=>new Response(JSON.stringify({data:{calls:[{
      messageId:'original-call',occurredAt:'2026-09-28T12:00:00Z',participants:[{displayName:'Chase'}],
      memories:[{extraction:{summary:[{text:'Discussed the roof schedule.',quote:'We talked about the roof schedule.'},{text:'Delivery is still unconfirmed.',quote:'We do not know delivery yet.'}],unresolved:[]}}]
    }],hasMore:false}})));
    vi.stubGlobal('fetch',fake);
    const reply=await executeManagerIntent({kind:'calls',participant:'Chase',latest:true});
    expect(reply.text).toContain('Discussed the roof schedule. Delivery is still unconfirmed.');
    expect(reply.text).not.toContain('Evidence:');expect(reply.text).not.toContain('original-call');
    expect(reply.evidence).toContain('Evidence: “We do not know delivery yet.”');
    const more=await executeManagerIntent({kind:'repeat'},{lastIntent:reply.intent,lastReply:reply.text,lastEvidence:reply.evidence});
    expect(more.text).toContain('original-call');expect(fake).toHaveBeenCalledTimes(1);
  });
  it('routes call questions before the generic today ledger',()=>{
    expect(classifyManagerQuestion('summarize my calls from today')).toEqual({kind:'calls',today:true});
    expect(classifyManagerQuestion('tell me the last thing i spoke about with Chase')).toEqual({kind:'calls',participant:'Chase',latest:true});
    expect(classifyManagerQuestion('when did me and Chase talk about shingles')).toEqual({kind:'calls',participant:'Chase',topic:'shingles'});
    expect(classifyManagerQuestion('what color shingles did Peter say he wants on his roof?')).toEqual({kind:'call_facts',subject:'Peter',topic:'shingle'});
  });
  it.each([
    'whats the last thing me and chase spoke about',
    "what's the last thing me and Chase spoke about?",
    'What’s the last thing Chase and I talked about?',
    'what did me and Chase talk about last?',
    'what did Chase and I discuss most recently?',
    'what did I speak with Chase about last?',
    'what did I discuss with Chase last?',
    'show me the latest call with Chase',
    'last conversation with Chase',
    'what is the most recent call with Chase?',
  ])('recognizes ordinary latest-call wording: %s',question=>{
    const intent=classifyManagerQuestion(question);
    expect(intent).toMatchObject({kind:'calls',latest:true});
    expect('participant' in intent && intent.participant?.toLowerCase()).toBe('chase');
  });
  it('uses the established participant for we without changing ambiguous search',()=>{
    const context={lastIntent:{kind:'calls' as const,participant:'Chase',latest:true}};
    expect(classifyManagerQuestion('what about shingles?',context)).toEqual({kind:'search',phrase:'shingles'});
    expect(classifyManagerQuestion('what did we talk about last?',context)).toEqual(context.lastIntent);
    expect(classifyManagerQuestion('what about Peter?')).toEqual({kind:'search',phrase:'Peter'});
    expect(classifyManagerQuestion('what did we talk about last?')).not.toMatchObject({kind:'calls'});
  });
  it('routes the reported failing phrase to the authenticated latest-call read',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({data:{calls:[],hasMore:false}})));
    vi.stubGlobal('fetch',fetcher);
    const reply=await askManager('whats the last thing me and chase spoke about');
    expect(fetcher).toHaveBeenCalledWith('/api/communications/call-memory?limit=1&participant=chase',expect.anything());
    expect(reply.text).not.toContain('Ask me to catch you up');
  });
  it('uses server-side today and labels raw transcripts instead of fabricating summaries',async()=>{
    const fetcher=vi.fn(async(_path:string)=>new Response(JSON.stringify({data:{calls:[{messageId:'call-1',occurredAt:'2026-09-28T12:00:00Z',participants:[{displayName:'Chase'}],excerpt:'Roof conversation.',memories:[]}],hasMore:false}})));
    vi.stubGlobal('fetch',fetcher);
    const reply=await askManager('summarize my calls from today');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/communications/call-memory?limit=10&range=today');
    expect(reply.text).toContain('summary isn’t ready');expect(reply.text).not.toContain('Roof conversation.');expect(reply.evidence).toContain('summary not yet saved');expect(reply.evidence).toContain('Roof conversation.');expect(reply.text).not.toContain('due');
  });
  it('shows partial extraction warnings beside saved notes',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({data:{calls:[{
      messageId:'call-1',occurredAt:'2026-09-28T12:00:00Z',participants:[],
      memories:[{extraction:{summary:[{text:'Roof discussion',quote:'Roof.'}],unresolved:['Partial extraction: omitted 2 items.']}}]
    }],hasMore:false}}))));
    const reply=await askManager('summarize my calls from today');
    expect(reply.text).toContain('Some details remain uncertain');expect(reply.evidence).toContain('Unresolved: Partial extraction: omitted 2 items.');
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
    expect(reply.text).toContain('don’t have a supported summary');expect(reply.evidence).toContain('reviewed; no supported summary retained');
    expect(reply.text).not.toContain('summary not yet saved');
  });
  it('labels known automated greetings and withheld earlier notes without inventing a conversation',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({data:{calls:[{
      messageId:'call-1',occurredAt:'2026-09-28T12:00:00Z',participants:[],excerpt:'Your call has been forwarded.',
      memories:[],callKind:'automated_greeting',withheldMemories:1
    }],hasMore:false}}))));
    const reply=await askManager('summarize my calls from today');
    expect(reply.text).toContain('only reached an automated greeting');
    expect(reply.evidence).toContain('Earlier notes withheld');
    expect(reply.text).not.toContain('Proposed note:');
  });

});
