/** One bounded read through the existing authenticated insurance ACP bridge.
 * The bridge's server-enforced read_only mode remains the authority. No
 * credentials, realm, recipient, tool names or endpoint come from the model. */
type Socket = Pick<WebSocket, 'send' | 'close' | 'onopen' | 'onmessage' | 'onerror' | 'onclose'>;
type Options = { origin?: string; createSocket?: (url:string)=>Socket; timeoutMs?:number };
const unavailable = () => new Error('Insurance records could not be loaded. Please try again.');

export function askInsuranceRead(question:string, options:Options={}):Promise<string> {
  if(typeof question!=='string'||!question.trim()||question.length>2000) return Promise.reject(unavailable());
  const origin=options.origin??window.location.origin;
  const url=new URL('/acp/insurance',origin);
  if(!['http:','https:'].includes(url.protocol))return Promise.reject(unavailable());
  url.protocol=url.protocol==='https:'?'wss:':'ws:';
  return new Promise((resolve,reject)=>{
    let socket:Socket;
    let settled=false, stage:'initialize'|'new'|'prompt'='initialize', sessionId='', answer='';
    const finish=(error?:Error)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      if(socket){socket.onopen=null;socket.onmessage=null;socket.onerror=null;socket.onclose=null;try{socket.close();}catch{/* already closed */}}
      if(error)reject(error);else resolve(answer.trim());
    };
    // Longer than the insurance service's 180s prompt budget; never reconnect
    // and replay a prompt automatically after an ambiguous connection loss.
    const timer=setTimeout(()=>finish(unavailable()),options.timeoutMs??210_000);
    try{socket=(options.createSocket??(endpoint=>new WebSocket(endpoint)))(url.toString());}
    catch{finish(unavailable());return;}
    const send=(id:number,method:string,params:unknown)=>socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));
    socket.onerror=()=>finish(unavailable());
    socket.onclose=()=>finish(unavailable());
    socket.onopen=()=>{
      try{send(1,'initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'padawan-manager',version:'1'}});}
      catch{finish(unavailable());}
    };
    socket.onmessage=event=>{
      try{
        if(typeof event.data!=='string'||event.data.length>256_000)throw unavailable();
        const message=JSON.parse(event.data);
        if(!message||message.jsonrpc!=='2.0')throw unavailable();
        if(message.method){
          if(message.id!==undefined){
            // No filesystem/terminal/permission capabilities are advertised.
            socket.send(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not supported'}}));
            return;
          }
          if(message.method==='session/update'&&message.params?.sessionId===sessionId&&stage==='prompt'){
            const update=message.params.update;
            if(update?.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text'){
              if(typeof update.content.text!=='string'||answer.length+update.content.text.length>60_000)throw unavailable();
              answer+=update.content.text;
            }
          }
          return;
        }
        const expected=stage==='initialize'?1:stage==='new'?2:3;
        if(message.id!==expected||message.error||!message.result)throw unavailable();
        if(stage==='initialize'){
          if(message.result.protocolVersion!==1)throw unavailable();
          stage='new';send(2,'session/new',{cwd:'/',mcpServers:[]});
        }else if(stage==='new'){
          if(typeof message.result.sessionId!=='string'||!message.result.sessionId||message.result.sessionId.length>256)throw unavailable();
          sessionId=message.result.sessionId;stage='prompt';
          send(3,'session/prompt',{sessionId,prompt:[{type:'text',text:question.trim()}]});
        }else{
          if(message.result.stopReason!=='end_turn'||!answer.trim())throw unavailable();
          finish();
        }
      }catch{finish(unavailable());}
    };
  });
}
