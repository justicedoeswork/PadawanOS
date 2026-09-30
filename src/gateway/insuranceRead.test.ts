import {afterEach,describe,expect,it,vi} from 'vitest';
import {askInsuranceRead} from './insuranceRead';

function fakeSocket(){
  const socket={
    onopen:null as (()=>void)|null,onclose:null as (()=>void)|null,onerror:null as (()=>void)|null,
    onmessage:null as ((event:MessageEvent)=>void)|null,
    send:vi.fn(),close:vi.fn(),
    emit(value:unknown){socket.onmessage?.({data:JSON.stringify(value)} as MessageEvent);}
  };
  const createSocket=vi.fn(()=>socket as unknown as WebSocket);
  return {socket,createSocket};
}
function openSession(socket:ReturnType<typeof fakeSocket>['socket']){
  socket.onopen?.();
  socket.emit({jsonrpc:'2.0',id:1,result:{protocolVersion:1}});
  socket.emit({jsonrpc:'2.0',id:2,result:{sessionId:'session-1'}});
}
afterEach(()=>vi.useRealTimers());
describe('manager insurance read bridge',()=>{
  it('uses the fixed authenticated endpoint and returns only its session answer',async()=>{
    const {socket,createSocket}=fakeSocket();
    const result=askInsuranceRead('When does Acme GL expire?',{origin:'https://justice.example',createSocket});
    openSession(socket);
    expect(createSocket).toHaveBeenCalledWith('wss://justice.example/acp/insurance');
    const requests=socket.send.mock.calls.map(call=>JSON.parse(call[0] as string));
    expect(requests.map(r=>r.method)).toEqual(['initialize','session/new','session/prompt']);
    expect(requests[0].params.clientCapabilities).toEqual({});
    expect(requests[2].params).toEqual({sessionId:'session-1',prompt:[{type:'text',text:'When does Acme GL expire?'}]});
    socket.emit({jsonrpc:'2.0',method:'session/update',params:{sessionId:'other',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Wrong contractor'}}}});
    socket.emit({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Active through October 7; waiver unverified.'}}}});
    socket.emit({jsonrpc:'2.0',id:3,result:{stopReason:'end_turn'}});
    await expect(result).resolves.toBe('Active through October 7; waiver unverified.');
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it('refuses agent requests for client capabilities',async()=>{
    const {socket,createSocket}=fakeSocket();
    const result=askInsuranceRead('Show policies',{origin:'https://justice.example',createSocket});
    const failed=expect(result).rejects.toThrow('could not be loaded');
    openSession(socket);
    socket.emit({jsonrpc:'2.0',id:99,method:'fs/read_text_file',params:{path:'/secret'}});
    expect(JSON.parse(socket.send.mock.lastCall?.[0] as string).error.code).toBe(-32601);
    socket.onclose?.();await failed;
    expect(createSocket).toHaveBeenCalledOnce();
  });
  it('does not present partial output as a completed answer or retry after disconnect',async()=>{
    const {socket,createSocket}=fakeSocket();
    const result=askInsuranceRead('Show policies',{origin:'https://justice.example',createSocket});
    const failed=expect(result).rejects.toThrow('could not be loaded');
    openSession(socket);
    socket.emit({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Partial'}}}});
    socket.onclose?.();await failed;
    expect(createSocket).toHaveBeenCalledOnce();
  });
  it('cleans up a timed out read',async()=>{
    vi.useFakeTimers();
    const {socket,createSocket}=fakeSocket();
    const result=askInsuranceRead('Show policies',{origin:'https://justice.example',createSocket,timeoutMs:20});
    const failed=expect(result).rejects.toThrow('could not be loaded');
    await vi.advanceTimersByTimeAsync(20);await failed;
    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.onmessage).toBeNull();
  });
  it('rejects wrong protocol responses and oversized prompts',async()=>{
    const {socket,createSocket}=fakeSocket();
    await expect(askInsuranceRead('x'.repeat(2001),{origin:'https://justice.example',createSocket})).rejects.toThrow();
    expect(createSocket).not.toHaveBeenCalled();
    const result=askInsuranceRead('Show policies',{origin:'https://justice.example',createSocket});
    const failed=expect(result).rejects.toThrow();
    socket.onopen?.();socket.emit({jsonrpc:'2.0',id:1,result:{protocolVersion:999}});
    await failed;
  });
});
