import {expect,it} from 'vitest';
import {WebSocketServer} from 'ws';
import {readInsuranceMcp} from '../src/insuranceMcpRead.js';
it('bridges a bounded insurance question without advertising approval or filesystem capabilities',async()=>{
 const wss=new WebSocketServer({port:0,host:'127.0.0.1'});
 await new Promise<void>(r=>wss.on('listening',r));const address=wss.address() as {port:number};let count=0;
 wss.on('connection',(ws,request)=>{
  expect(request.headers.cookie).toBe('synthetic-cookie');expect(request.headers.origin).toBe('https://synthetic.example');
  ws.on('message',data=>{
   const v=JSON.parse(data.toString());count++;
   if(v.method==='initialize'){expect(v.params.clientCapabilities).toEqual({});ws.send(JSON.stringify({jsonrpc:'2.0',id:v.id,result:{protocolVersion:1}}));}
   else if(v.method==='session/new'){expect(v.params.mcpServers).toEqual([]);ws.send(JSON.stringify({jsonrpc:'2.0',id:v.id,result:{sessionId:'synthetic'}}));}
   else if(v.method==='session/prompt'){
    expect(v.params.prompt[0].text).toBe('Read synthetic coverage');
    ws.send(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'synthetic',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Synthetic coverage; not a compliance approval.'}}}}));
    ws.send(JSON.stringify({jsonrpc:'2.0',id:v.id,result:{stopReason:'end_turn'}}));
   }
  });
 });
 try{expect(await readInsuranceMcp('Read synthetic coverage',`http://127.0.0.1:${address.port}`,'synthetic-cookie','https://synthetic.example')).toContain('not a compliance approval');expect(count).toBe(3);}
 finally{await new Promise<void>(r=>wss.close(()=>r()));}
});
