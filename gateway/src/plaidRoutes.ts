import {Router} from 'express';
export function createPlaidRouter(options:{baseUrl:string|null;readKey:string|null;refreshKey:string|null;allowedOrigins:string[];fetchImpl?:typeof fetch}){
 const router=Router();let active=0;
 for(const action of ['status','refresh'] as const)router[action==='status'?'get':'post']('/api/finance/plaid/'+action,async(req,res)=>{
  const refresh=action==='refresh';
  if(refresh&&(!req.headers.origin||!options.allowedOrigins.includes(req.headers.origin))){res.status(403).json({error:{code:'ORIGIN_REJECTED'}});return;}
  const {account,offset}=req.query;
  if(Object.keys(req.query).some(k=>!['account','offset'].includes(k))||(account!==undefined&&(typeof account!=='string'||account.length>64))||(offset!==undefined&&(typeof offset!=='string'||!/^\d{1,6}$/.test(offset)||Number(offset)>100000))||(refresh&&(Object.keys(req.query).length||req.body&&Object.keys(req.body).length))){res.status(400).json({error:{code:'INVALID_QUERY'}});return;}
  const key=refresh?options.refreshKey:options.readKey;
  if(!key||!options.baseUrl){res.status(503).json({error:{code:'PLAID_NOT_CONFIGURED'}});return;}
  if(active>=2){res.status(429).json({error:{code:'FINANCE_BUSY'}});return;}active++;
  try{
   const query=new URLSearchParams();if(account)query.set('account',String(account));if(offset)query.set('offset',String(offset));
   const r=await(options.fetchImpl??fetch)(options.baseUrl.replace(/\/$/,'')+'/v1/plaid/'+action+(query.size?'?'+query:''),{method:refresh?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(25000),headers:{authorization:'Bearer '+key,'content-type':'application/json'},...(refresh?{body:'{}'}:{})});
   if(!r.ok){res.status(r.status===409?409:502).json({error:{code:r.status===409?'SYNC_ALREADY_RUNNING':'PLAID_UNAVAILABLE'}});return;}
   const reader=r.body?.getReader();if(!reader)throw Error();let n=0;const parts:Uint8Array[]=[];try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>512000)throw Error();parts.push(p.value);}}finally{await reader.cancel();}
   const raw=Buffer.concat(parts).toString();if([options.readKey,options.refreshKey].some(k=>k&&raw.includes(k)))throw Error();res.status(r.status).json(JSON.parse(raw));
  }catch{res.status(502).json({error:{code:'PLAID_UNAVAILABLE'}});}finally{active--;}
 });return router;
}
