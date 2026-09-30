import {createHmac,timingSafeEqual} from 'node:crypto';
import {Router} from 'express';
import {createRequireSession} from './requireSession.js';
import {parseCookies,SESSION_COOKIE_NAME} from './cookies.js';
import {createCommunicationsAgentClient,type CommunicationsAgentClient} from './communicationsAgentClient.js';

const PREFIX='/api/call-followup-owner';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const open=new Set(['inbox','immediate','today','scheduled','later','waiting','blocked']);
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
type Selection={id:string;version:number};
type ReviewedItem=Selection & {callId:string;title:string};
type Review={items:ReviewedItem[];owner:string;expires:number};
export type OwnerRouteOptions={sessionSecret:string|null;allowedOrigins:string[];baseUrl:string|null;readKey:string|null;writeKey:string|null;client?:CommunicationsAgentClient;fetchImpl?:typeof fetch;now?:()=>number};
/** One internal change only. The generic ledger API, sends and approvals stay unavailable.
 * A session-bound, expiring review binds exact items, versions and owner. */
export function createCallOwnerRouter(options:OwnerRouteOptions){
 const router=Router(), now=options.now??Date.now;
 const client=options.client??(options.baseUrl&&options.readKey?createCommunicationsAgentClient({baseUrl:options.baseUrl,readKey:options.readKey}):null);
 const key=options.sessionSecret??'';
 const sign=(payload:string,session:string)=>createHmac('sha256',key).update('call-owner-v1\n'+session+'\n'+payload).digest('hex');
 router.use(PREFIX,createRequireSession(options.sessionSecret));
 router.use(PREFIX,(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  if(!req.headers.origin||!options.allowedOrigins.includes(req.headers.origin)){res.status(403).json({error:{code:'ORIGIN_REJECTED'}});return;}
  if(!client||!options.baseUrl||!options.writeKey){res.status(503).json({error:{code:'OWNER_UPDATES_NOT_CONFIGURED'}});return;}
  if(!req.is('application/json')){res.status(415).json({error:{code:'JSON_REQUIRED'}});return;}
  next();
 });
 const load=async(id:string)=>{
  const result=await client!.get('/api/v1/ledger/items/'+id);
  if(result.kind!=='response'||result.status!==200)throw Error('unavailable');
  const item=object(object(result.body).data).item;
  const value=object(item);
  if(value.id!==id||value.createdBy!=='call-commitments'||!open.has(String(value.status))||!uuid.test(String(value.originMessageId)))throw Error('not_eligible');
  return value;
 };
 router.post(PREFIX+'/preview',async(req,res)=>{
  const body=object(req.body),owner=typeof body.owner==='string'?body.owner.trim():'';
  if(Object.keys(body).sort().join(',')!=='items,owner'||!owner||owner.length>160||/[\r\n]/.test(owner)||!Array.isArray(body.items)||!body.items.length||body.items.length>8){res.status(400).json({error:{code:'INVALID_OWNER_REVIEW'}});return;}
  const selections:Selection[]=[];
  for(const raw of body.items){const i=object(raw);if(Object.keys(i).sort().join(',')!=='id,version'||!uuid.test(String(i.id))||!Number.isSafeInteger(i.version)||Number(i.version)<1){res.status(400).json({error:{code:'INVALID_OWNER_REVIEW'}});return;}selections.push({id:String(i.id),version:Number(i.version)});}
  if(new Set(selections.map(i=>i.id)).size!==selections.length){res.status(400).json({error:{code:'INVALID_OWNER_REVIEW'}});return;}
  try{
   const items:ReviewedItem[]=[];
   for(const selected of selections){const item=await load(selected.id);if(item.version!==selected.version){res.status(409).json({error:{code:'REVIEW_CHANGED'}});return;}items.push({...selected,callId:String(item.originMessageId),title:String(item.title)});}
   const review:Review={items,owner:/^(me|myself|austin|austin justice)$/i.test(owner)?'austin':owner,expires:now()+10*60_000};
   const payload=Buffer.from(JSON.stringify(review)).toString('base64url');
   const session=parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME]!;
   res.json({review,token:payload+'.'+sign(payload,session)});
  }catch{res.status(502).json({error:{code:'OWNER_REVIEW_UNAVAILABLE'}});}
 });
 router.post(PREFIX+'/confirm',async(req,res)=>{
  const body=object(req.body),token=body.token;
  if(Object.keys(body).join(',')!=='token'||typeof token!=='string'||token.length>20000){res.status(400).json({error:{code:'INVALID_OWNER_REVIEW'}});return;}
  const [payload,signature,...extra]=token.split('.');
  const session=parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME]!;
  if(!payload||!signature||extra.length||!/^[0-9a-f]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(sign(payload,session)))){res.status(400).json({error:{code:'INVALID_OWNER_REVIEW'}});return;}
  let review:Review;
  try{review=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')) as Review;if(review.expires<now())throw Error('expired');}catch{res.status(409).json({error:{code:'REVIEW_EXPIRED'}});return;}
  const saved:string[]=[];
  try{
   // Preflight the entire selection. Per-item CAS below still protects races.
   const pending:ReviewedItem[]=[];
   for(const entry of review.items){const current=await load(entry.id);
    if(current.originMessageId!==entry.callId||current.title!==entry.title){res.status(409).json({error:{code:'REVIEW_CHANGED'},saved});return;}
    if(current.version===entry.version+1&&current.responsibleParty===review.owner){saved.push(entry.id);continue;}
    if(current.version!==entry.version){res.status(409).json({error:{code:'REVIEW_CHANGED'},saved});return;}
    pending.push(entry);
   }
   for(const entry of pending){
    const response=await (options.fetchImpl??fetch)(options.baseUrl!.replace(/\/+$/,'')+'/api/v1/ledger/items/'+entry.id,{
     method:'PATCH',redirect:'error',headers:{authorization:'Bearer '+options.writeKey,'content-type':'application/json'},signal:AbortSignal.timeout(10_000),
     body:JSON.stringify({expectedVersion:entry.version,changes:{responsibleParty:review.owner},reason:'Owner confirmed by Austin through Padawan review. This corrects task ownership, not transcript speaker identity.'})});
    const data=object(object(await response.json()).data);
    if(!response.ok||data.id!==entry.id||data.responsibleParty!==review.owner||data.version!==entry.version+1){res.status(response.status===409?409:502).json({error:{code:'OWNER_SAVE_INCOMPLETE'},saved});return;}
    saved.push(entry.id);
   }
   res.json({saved,owner:review.owner});
  }catch{res.status(502).json({error:{code:'OWNER_SAVE_UNCERTAIN'},saved});}
 });
 return router;
}
