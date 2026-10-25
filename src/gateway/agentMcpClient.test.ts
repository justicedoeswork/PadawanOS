import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it('initializes once then shares authenticated MCP tools across finance and communications',async()=>{
 const calls:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  expect(url).toBe('/api/mcp');expect(init.credentials).toBe('same-origin');
  const v=JSON.parse(init.body);calls.push(v);
  if(v.method==='notifications/initialized')return new Response(null,{status:202});
  return Response.json({jsonrpc:'2.0',id:v.id,result:v.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}}}:{content:[{type:'text',text:JSON.stringify({answer:'Synthetic evidence',unknown:null})}]}});
 }));
 const {callAgentTool,readCommunicationsTool}=await import('./agentMcpClient');
 expect(await callAgentTool('finance_query',{operation:'status'})).toEqual({answer:'Synthetic evidence',unknown:null});
 await readCommunicationsTool('/api/communications/call-memory?limit=1&participant=Synthetic%20Name');
 expect(calls.map(c=>c.method)).toEqual(['initialize','notifications/initialized','tools/call','tools/call']);
 expect(calls[3].params).toEqual({name:'communications_read',arguments:{view:'call-memory',filters:{limit:1,participant:'Synthetic Name'}}});
});
it('refuses source errors instead of interpreting them as a successful answer',async()=>{
 vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit)=>{const v=JSON.parse(String(init.body));if(v.method==='notifications/initialized')return new Response(null,{status:202});return Response.json({jsonrpc:'2.0',id:v.id,result:v.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}}}:{isError:true,content:[{type:'text',text:'unavailable'}]}});});
 const {callAgentTool}=await import('./agentMcpClient');await expect(callAgentTool('finance_query',{})).rejects.toThrow('unavailable');
});
it('does not accept arbitrary external endpoints or duplicate filters',async()=>{
 const {readCommunicationsTool}=await import('./agentMcpClient');
 await expect(readCommunicationsTool('https://evil.example/api/communications/status')).rejects.toThrow();
 await expect(readCommunicationsTool('/api/communications/search?q=a&q=b')).rejects.toThrow();
});
