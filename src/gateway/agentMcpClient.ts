/** Restricted browser MCP client for our stateless JSON transport only.
 * Credentials remain in the existing HttpOnly cookie. No tokens in localStorage.
 * Discovery/handshake are shared across calls; no automatic read retries. */
let initialized:Promise<void>|undefined;
let nextId=1;
const version='2025-11-25';
async function rpc(method:string,params:unknown,signal:AbortSignal,notification=false):Promise<Record<string, unknown>>{
 const id=notification?undefined:nextId++;
 const r=await fetch('/api/mcp',{method:'POST',credentials:'same-origin',cache:'no-store',signal,
  headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':version},
  body:JSON.stringify({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,params})});
 if(!r.ok){if(r.status===401)initialized=undefined;throw Error('Agent tools are unavailable');}
 if(notification){if(r.status!==202)throw Error('Invalid MCP notification response');return {};}
 const v=await r.json();if(v?.jsonrpc!=='2.0'||v.id!==id||v.error||!v.result)throw Error('Invalid agent tool response');return v.result;
}
export async function callAgentTool(name:string,args:Record<string,unknown>,timeoutMs=25000):Promise<unknown>{
 const signal=AbortSignal.timeout(timeoutMs);
 if(!initialized){initialized=(async()=>{
  const result=await rpc('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'justiceos-owner',version:'1'}},signal);
  if(result.protocolVersion!==version||!result.capabilities||typeof result.capabilities!=='object'||!('tools' in result.capabilities))throw Error('Unsupported agent tool service');
  await rpc('notifications/initialized',{},signal,true);
 })().catch(error=>{initialized=undefined;throw error;});}
 await initialized;
 const result=await rpc('tools/call',{name,arguments:args},signal);
 if(result.isError||!Array.isArray(result.content)||result.content.length!==1||result.content[0]?.type!=='text'||typeof result.content[0]?.text!=='string')throw Error('Agent source unavailable');
 return JSON.parse(result.content[0].text);
}
/** Existing manager presentation logic keeps its structured service data. */
export async function readCommunicationsTool(path:string):Promise<unknown>{
 const url=new URL(path,'https://justiceos.invalid');
 if(url.origin!=='https://justiceos.invalid'||!url.pathname.startsWith('/api/communications/'))throw Error('Invalid communications path');
 const view=url.pathname.slice('/api/communications/'.length);
 const call=/^calls\/([a-f0-9-]+)\/context$/i.exec(view);
 if(call){if(url.search)throw Error('Invalid call context');return callAgentTool('communications_call_context',{id:call[1]});}
 const filters:Record<string,string|number>={};
 for(const [key,value] of url.searchParams){if(key in filters)throw Error('Duplicate filter');filters[key]=['limit','offset'].includes(key)?Number(value):value;}
 return callAgentTool('communications_read',{view,filters});
}
