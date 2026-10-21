import {Router} from 'express';
import {randomBytes,createHash} from 'node:crypto';
import {createRequireSession} from './requireSession.js';
const cookieName='__Host-finance-qbo';
export function createQuickBooksRouter(options:{sessionSecret:string|null;baseUrl:string|null;readKey:string|null;refreshKey:string|null;allowedOrigins:string[];fetchImpl?:typeof fetch}){
 const router=Router(),prefix='/api/finance/quickbooks';
 router.use(prefix,createRequireSession(options.sessionSecret),(_req,res,next)=>{res.set('Cache-Control','private, no-store');res.set('Referrer-Policy','no-referrer');next();});
 async function call(path:string,body?:unknown){
  const key=body===undefined?options.readKey:options.refreshKey;
  if(!options.baseUrl||!key)throw Error('QBO_NOT_CONFIGURED');
  const r=await(options.fetchImpl??fetch)(options.baseUrl.replace(/\/$/,'')+'/v1/quickbooks/'+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{authorization:'Bearer '+key,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const reader=r.body?.getReader();if(!reader)throw Error();let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>512000)throw Error();chunks.push(part.value);}}finally{await reader.cancel();}
  const raw=Buffer.concat(chunks).toString();if([options.readKey,options.refreshKey].some(k=>k&&raw.includes(k)))throw Error();
  const data=JSON.parse(raw);if(!r.ok)throw Error('QBO_UNAVAILABLE');return {status:r.status,data};
 }
 router.get(prefix+'/status',async(_req,res)=>{try{res.json((await call('status')).data);}catch{res.status(502).json({error:{code:'QBO_UNAVAILABLE'}});}});
 router.post(prefix+'/connect',async(req,res)=>{
  if(!req.headers.origin||!options.allowedOrigins.includes(req.headers.origin)){res.status(403).json({error:{code:'ORIGIN_REJECTED'}});return;}
  try{
   const binding=randomBytes(32).toString('hex');
   const data=(await call('authorize',{binding:createHash('sha256').update(binding).digest('hex')})).data;
   const url=new URL(data.authorizationUrl);if(url.origin!=='https://appcenter.intuit.com'||url.pathname!=='/connect/oauth2')throw Error();
   res.cookie(cookieName,binding,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:600000});res.json({authorizationUrl:url.href});
  }catch{res.status(502).json({error:{code:'QBO_UNAVAILABLE'}});}
 });
 router.get(prefix+'/callback',async(req,res)=>{
  const binding=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  res.clearCookie(cookieName,{httpOnly:true,secure:true,sameSite:'lax',path:'/'});
  try{
   const {code,state,realmId,error}=req.query;
   if(error||!binding||!/^[a-f0-9]{64}$/.test(binding)||typeof code!=='string'||typeof state!=='string'||typeof realmId!=='string')throw Error();
   await call('connect',{code,state,realm:realmId,binding:createHash('sha256').update(binding).digest('hex')});
   res.redirect(303,'/#/gateway?qbo=connected');
  }catch{res.redirect(303,'/#/gateway?qbo=reconnect-required');}
 });
 router.post(prefix+'/refresh',async(req,res)=>{
  if(!req.headers.origin||!options.allowedOrigins.includes(req.headers.origin)){res.status(403).json({error:{code:'ORIGIN_REJECTED'}});return;}
  try{const r=await call('refresh',{});res.status(r.status).json(r.data);}catch{res.status(502).json({error:{code:'QBO_UNAVAILABLE'}});}
 });
 return router;
}
