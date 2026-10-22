import {Router} from 'express';
import {createHash} from 'node:crypto';
import {parseCookies,SESSION_COOKIE_NAME} from './cookies.js';
export function createSupplierReviewRouter(options:{baseUrl:string|null;readKey:string|null;reviewKey?:string|null;allowedOrigins:string[];fetchImpl?:typeof fetch}){
 const router=Router();let active=0;
 for(const action of ['jobs','assign'] as const)router[action==='jobs'?'get':'post']('/api/finance/suppliers/'+action,async(req,res)=>{
  const write=action==='assign';
  if(write&&(!req.headers.origin||!options.allowedOrigins.includes(req.headers.origin))){res.status(403).json({error:{code:'ORIGIN_REJECTED'}});return;}
  const q=typeof req.query.q==='string'?req.query.q:'';
  const v=req.body;
  const valid=write?Object.keys(req.query).length===0&&v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')==='documentKey,expectedReviewId,jobId,requestId'&&typeof v.documentKey==='string'&&/^[a-f0-9]{64}$/.test(v.documentKey)&&typeof v.jobId==='string'&&/^[a-f0-9-]{36}$/i.test(v.jobId)&&typeof v.requestId==='string'&&/^[a-f0-9-]{36}$/i.test(v.requestId)&&typeof v.expectedReviewId==='string'&&/^\d{1,20}$/.test(v.expectedReviewId):Object.keys(req.query).length===1&&q.trim().length>=2&&q.length<=160&&!/[\x00-\x1f]/.test(q);
  if(!valid){res.status(400).json({error:{code:'INVALID_QUERY'}});return;}
  const key=write?options.reviewKey:options.readKey;if(!options.baseUrl||!key){res.status(503).json({error:{code:'REVIEW_NOT_CONFIGURED'}});return;}
  if(active>=2){res.status(429).json({error:{code:'FINANCE_BUSY'}});return;}active++;
  try{
   const actor='justiceos-owner-session:'+createHash('sha256').update(parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME]??'').digest('hex');
   const r=await(options.fetchImpl??fetch)(options.baseUrl.replace(/\/$/,'')+'/v1/suppliers/'+action+(write?'':'?'+new URLSearchParams({q})),{method:write?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+key,'content-type':'application/json'},...(write?{body:JSON.stringify({...v,reviewer:actor})}:{})});
   if(!r.ok){res.status([400,404,409].includes(r.status)?r.status:502).json({error:{code:r.status===409?'REVIEW_CONFLICT':r.status===404?'REVIEW_NOT_FOUND':'REVIEW_UNAVAILABLE'}});return;}
   const reader=r.body?.getReader();if(!reader)throw Error();let n=0;const parts:Uint8Array[]=[];try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>64000)throw Error();parts.push(p.value);}}finally{await reader.cancel();}
   const raw=Buffer.concat(parts).toString();if([options.readKey,options.reviewKey].some(k=>k&&raw.includes(k)))throw Error();res.status(200).json(JSON.parse(raw));
  }catch{res.status(502).json({error:{code:'REVIEW_UNAVAILABLE'}});}finally{active--;}
 });return router;
}
