import {afterEach,describe,expect,it,vi} from 'vitest';
import {recordingType,speakReply,transcribeQuestion} from './managerVoice';
afterEach(()=>vi.unstubAllGlobals());
describe('voice client',()=>{
 it('selects a browser-supported recorder format',()=>{
   vi.stubGlobal('MediaRecorder',{isTypeSupported:(type:string)=>type==='audio/mp4'});
   expect(recordingType()).toBe('audio/mp4');
 });
 it('uploads audio to the signed-in gateway and returns editable ordinary text',async()=>{
   const fake=vi.fn(async()=>new Response(JSON.stringify({text:' What did Morgan say? '})));vi.stubGlobal('fetch',fake);
   const blob=new Blob(['audio'],{type:'audio/webm'}),signal=new AbortController().signal;
   expect(await transcribeQuestion(blob,signal)).toBe('What did Morgan say?');
   expect(fake).toHaveBeenCalledWith('/api/manager/transcribe',expect.objectContaining({credentials:'same-origin',body:blob,signal}));
 });
 it('does not upload empty audio or surface private provider messages',async()=>{
   const fake=vi.fn(async()=>new Response(JSON.stringify({error:{message:'private detail'}}),{status:502}));vi.stubGlobal('fetch',fake);
   await expect(transcribeQuestion(new Blob([]),new AbortController().signal)).rejects.toThrow('empty');expect(fake).not.toHaveBeenCalled();
   await expect(transcribeQuestion(new Blob(['audio']),new AbortController().signal)).rejects.toThrow('couldn’t transcribe');
 });
 it('reads the answer in order, preserves amounts and stops queued speech on cancel',()=>{
   const said:{text:string;onend:()=>void}[]=[],cancel=vi.fn(),done=vi.fn();
   vi.stubGlobal('SpeechSynthesisUtterance',class {constructor(public text:string){}});
   vi.stubGlobal('speechSynthesis',{cancel,speak:(utterance:{text:string;onend:()=>void})=>said.push(utterance)});
   const stop=speakReply('Amount is $1,234.56. '+('Still unconfirmed. '.repeat(30)),done);
   expect(said[0]?.text).toContain('$1,234.56.');said[0]!.onend();expect(said).toHaveLength(2);
   stop();said[1]!.onend();expect(said).toHaveLength(2);expect(cancel).toHaveBeenCalledTimes(2);expect(done).not.toHaveBeenCalled();
 });
});
