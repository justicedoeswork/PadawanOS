import {afterEach,describe,expect,it,vi} from 'vitest';
import {askConversationalManager,readIntent} from './conversationalManager';
afterEach(()=>vi.unstubAllGlobals());
const plan=(intents:unknown[])=>({action:'read',question:null,intents});
describe('conversational manager read routing',()=>{
  it('uses structured meaning rather than requiring a recognized command',async()=>{
    const fetcher=vi.fn(async(path:unknown)=>String(path)==='/api/manager/interpret'
      ?new Response(JSON.stringify(plan([{kind:'calls',participant:'Chase',latest:true}])))
      :new Response(JSON.stringify({data:{calls:[],hasMore:false}})));
    vi.stubGlobal('fetch',fetcher);
    const reply=await askConversationalManager('uh remind me where things landed with Chase on our last call');
    expect(reply.intent).toEqual({kind:'calls',participant:'Chase',latest:true});
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/communications/call-memory?limit=1&participant=Chase');
  });
  it('passes bounded history for corrections and preserves clarification without querying records',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({action:'clarify',question:'Do you mean Chase or Peter?',intents:[]})));
    vi.stubGlobal('fetch',fetcher);
    const turns=Array.from({length:12},()=>({role:'user' as const,text:'x'.repeat(1800)}));
    const reply=await askConversationalManager('What did he say?',{turns});
    expect(reply.text).toBe('Do you mean Chase or Peter?');expect(fetcher).toHaveBeenCalledTimes(1);
    const body=JSON.parse((fetcher.mock.calls as unknown as [string,RequestInit][])[0]![1].body as string);
    expect(body.turns).toHaveLength(8);expect(body.turns[0].text).toHaveLength(1500);
  });
  it('executes multiple existing reads while keeping failures visible',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(path:unknown)=>{
      if(path==='/api/manager/interpret')return new Response(JSON.stringify(plan([{kind:'emails'},{kind:'notifications'}])));
      if(path==='/api/communications/emails/needs-reply')return new Response(JSON.stringify({data:[]}));
      return new Response('unavailable',{status:502});
    }));
    const reply=await askConversationalManager('Any replies or notifications to deal with?');
    expect(reply.text).toContain('No emails currently need a reply');expect(reply.text).toContain('could not be loaded');
  });
  it.each(['unsupported','greeting'])('does not execute any action for %s',async action=>{
    const fake=vi.fn(async()=>new Response(JSON.stringify({action,question:null,intents:[]})));
    vi.stubGlobal('fetch',fake);await askConversationalManager('Send that email');expect(fake).toHaveBeenCalledTimes(1);
  });
  it.each([{kind:'send',url:'/send'},{kind:'calendar',range:'yesterday'},{kind:'search',phrase:'roof',url:'https://example.test'},{kind:'calls',latest:'true'}])('rejects unexpected operations and parameters',intent=>{
    expect(()=>readIntent(intent)).toThrow();
  });
  it('keeps exact commands usable only when language mode is explicitly unconfigured',async()=>{
    const fake=vi.fn(async(path:unknown)=>path==='/api/manager/interpret'?new Response(JSON.stringify({error:{code:'LANGUAGE_NOT_CONFIGURED'}}),{status:503}):new Response(JSON.stringify({data:[]})));
    vi.stubGlobal('fetch',fake);
    expect((await askConversationalManager('which emails need replies')).intent).toEqual({kind:'emails'});
  });
  it('does not guess a fallback intent after a provider failure',async()=>{
    const fake=vi.fn(async()=>new Response('{}',{status:502}));vi.stubGlobal('fetch',fake);
    expect((await askConversationalManager('show urgent items')).text).toContain('couldn’t interpret');expect(fake).toHaveBeenCalledTimes(1);
  });
});
