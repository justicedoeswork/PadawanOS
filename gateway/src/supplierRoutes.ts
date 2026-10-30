import {Router} from 'express';
export function createSupplierRouter(options:{baseUrl:string|null;readKey:string|null;refreshKey:string|null;allowedOrigins:string[];fetchImpl?:typeof fetch}){
 const router=Router();let active=0;
 for(const action of ['status','refresh'] as const)router[action==='status'?'get':'post']('/api/finance/suppliers/'+action,async(req,res)=>{
  if(action==='refresh'&&(!req.headers.origin||!options.allowedOrigins.includes(req.headers.origin))){res.status(403).json({error:{code:'ORIGIN_REJECTED'}});return;}
  const tasks=req.query.tasks??'false';
  const job=typeof req.query.job==='string'?req.query.job:'',offset=typeof req.query.offset==='string'?req.query.offset:'0';
  if(Object.keys(req.query).some(k=>!['job','offset','tasks'].includes(k))||!['true','false'].includes(String(tasks))||typeof tasks!=='string'||job.length>160||!/^\d{1,6}$/.test(offset)||(action==='refresh'&&(Object.keys(req.query).length||Object.keys(req.body??{}).length))){res.status(400).json({error:{code:'INVALID_QUERY'}});return;}
  const key=action==='refresh'?options.refreshKey:options.readKey;if(!options.baseUrl||!key){res.status(503).json({error:{code:'FINANCE_NOT_CONFIGURED'}});return;}
  if(active>=2){res.status(429).json({error:{code:'FINANCE_BUSY'}});return;}active++;
  try{const r=await(options.fetchImpl??fetch)(options.baseUrl.replace(/\/$/,'')+'/v1/suppliers/'+action+(action==='status'?'?'+new URLSearchParams({job,offset,tasks}):''),{method:action==='status'?'GET':'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},...(action==='refresh'?{body:'{}'}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error();const reader=r.body?.getReader();if(!reader)throw Error();let size=0;const parts:Uint8Array[]=[];try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>1000000)throw Error();parts.push(p.value);}}finally{await reader.cancel();}const text=Buffer.concat(parts).toString();if([options.readKey,options.refreshKey].some(k=>k&&text.includes(k)))throw Error();res.status(r.status).json(JSON.parse(text));}catch{res.status(502).json({error:{code:'SUPPLIER_UNAVAILABLE'}});}finally{active--;}
 });return router;
}
