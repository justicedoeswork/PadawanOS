import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {requestInsuranceReport,checkInsuranceReport,reportIntent} from './insuranceReport';
import {askConversationalManager,readIntent} from './conversationalManager';
import {executeManagerIntent} from './managerCommunications';
const intent={kind:'insurance_report' as const,search:'',activeOnly:false,email:true};
const question='Create a current insurance summary PDF and email it to me.';
beforeEach(()=>{const data=new Map<string,string>();vi.stubGlobal('sessionStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)});});
afterEach(()=>vi.unstubAllGlobals());
describe('durable manager report actions',()=>{
 it('keeps the same request ID after a lost response, including across status checks',async()=>{
  const bodies:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:unknown,options:RequestInit)=>{bodies.push(JSON.parse(String(options.body)));throw Error('lost response');}));
  expect((await requestInsuranceReport(intent,question)).text).toContain('check report status');
  await requestInsuranceReport(intent,question);await checkInsuranceReport();
  expect(new Set(bodies.map(b=>b.requestId)).size).toBe(1);
  expect(bodies[0]).toMatchObject({requestText:question,email:true,activeOnly:false,search:''});
  expect(bodies[0].to).toBeUndefined();
 });
 it('reports confirmed PDF and Outlook acceptance without claiming final delivery',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,options:RequestInit)=>new Response(JSON.stringify({requestId:JSON.parse(String(options.body)).requestId,status:'completed',
    report:{driveFileId:'pdf',driveFileName:'Insurance.pdf',driveLink:'https://drive.google.com/file/d/pdf/view'},delivery:{sent:true,attached:true}}))));
  const reply=await requestInsuranceReport(intent,question);
  expect(reply.text).toContain('Saved Insurance.pdf');expect(reply.text).toContain('Outlook accepted');
  expect(reply.text).toContain('https://drive.google.com/');
 });
 it('keeps uncertain delivery held and does not include untrusted links',async()=>{
  const ids:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,options:RequestInit)=>{const request=JSON.parse(String(options.body));ids.push(request.requestId);return new Response(JSON.stringify({requestId:request.requestId,status:'partially_completed',
    report:{driveFileId:'pdf',driveFileName:'Insurance.pdf',driveLink:'javascript:alert(1)'},delivery:{sent:false,outcomeUnknown:true}}));}));
  const reply=await requestInsuranceReport(intent,question);await requestInsuranceReport(intent,question);
  expect(reply.text).toContain('will not be resent');expect(reply.text).not.toContain('javascript');expect(ids[0]).toBe(ids[1]);
 });
 it('does not start work when it cannot retain the request ID',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);vi.stubGlobal('sessionStorage',{getItem:()=>null,setItem:()=>{throw Error('blocked');}});
  expect((await requestInsuranceReport(intent,question)).text).toContain('haven’t started');expect(fetcher).not.toHaveBeenCalled();
 });
 it('requires a distinct action and keeps report requests out of read and repeat execution',async()=>{
  expect(()=>readIntent(intent)).toThrow();expect(()=>reportIntent({...intent,to:'other'})).toThrow();
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  expect((await executeManagerIntent({kind:'repeat'},{lastIntent:intent,lastReply:'Saved result'})).text).toBe('Saved result');
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('routes the explicit report action with the original user request and supports status checks',async()=>{
  const requests:any[]=[];
  const fetcher=vi.fn(async(url:unknown,options:RequestInit)=>{
   if(url==='/api/manager/interpret')return new Response(JSON.stringify({action:'report',question:null,intents:[intent]}));
   const request=JSON.parse(String(options.body));requests.push(request);return new Response(JSON.stringify({requestId:request.requestId,status:'working'}),{status:202});
  });vi.stubGlobal('fetch',fetcher);
  await askConversationalManager(question);await askConversationalManager('check report status');
  expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect(requests[0].requestText).toBe(question);
  expect(fetcher.mock.calls.filter(c=>c[0]==='/api/manager/interpret')).toHaveLength(1);
 });
});
