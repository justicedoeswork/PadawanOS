import {createPlaidRouter} from './plaidRoutes.js';
import {createReceiptReviewRouter} from './receiptReviewRoutes.js';
import {createSupplierReviewRouter} from './supplierReviewRoutes.js';
import {createSupplierRouter} from './supplierRoutes.js';
import {createQuickBooksRouter} from './quickbooksRoutes.js';
import {Router} from 'express';
import {createRequireSession} from './requireSession.js';
export function validFinanceQuery(v:unknown):boolean{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const q=v as Record<string,unknown>;
 return Object.keys(q).sort().join(',')==='attention,jobSearch,operation,period'&&
 ['received','costs','changes','attention','status','qbo_status','qbo_activity','supplier_status','supplier_job','plaid_status','plaid_activity'].includes(String(q.operation))&&
 ['this_month','last_month','all_time'].includes(String(q.period))&&
 ['all','undated','unpaid','reconciliation'].includes(String(q.attention))&&
 typeof q.jobSearch==='string'&&q.jobSearch.length<=160&&!/[\x00-\x1f]/.test(q.jobSearch);
}
export function createFinanceRouter(options:{reviewKey?:string|null;sessionSecret:string|null;baseUrl:string|null;readKey:string|null;refreshKey:string|null;allowedOrigins:string[];fetchImpl?:typeof fetch}){
 const router=Router(),prefix='/api/finance';
 if(options.baseUrl){const u=new URL(options.baseUrl);
  if(u.protocol!=='http:'||u.hostname!=='justice-finance-agent.internal'||u.port!=='8790'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('INVALID_FINANCE_AGENT_URL');}
 if((options.readKey&&options.readKey.length<32)||(options.refreshKey&&options.refreshKey.length<32)||(options.readKey&&options.readKey===options.refreshKey))throw Error('INVALID_FINANCE_SERVICE_KEYS');
 router.use(prefix,createRequireSession(options.sessionSecret),(_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
 router.use(createPlaidRouter(options));
 router.use(createQuickBooksRouter(options));
 router.use(createSupplierRouter(options));
 router.use(createSupplierReviewRouter(options));
 router.use(createReceiptReviewRouter(options));
 if(options.reviewKey&&(options.reviewKey.length<32||[options.readKey,options.refreshKey].includes(options.reviewKey)))throw Error('INVALID_FINANCE_REVIEW_KEY');
 let active=0;
 for(const [path,method] of [['status','GET'],['feeds','GET'],['query','POST'],['refresh','POST'],['refresh-job','POST']] as const){
  router[method==='GET'?'get':'post'](`${prefix}/${path}`,async(req,res)=>{
   if(req.originalUrl.includes('?')){res.status(400).json({error:{code:'INVALID_QUERY'}});return;}
   if(((path==='refresh'||path==='refresh-job')&&!req.headers.origin)||(req.headers.origin&&!options.allowedOrigins.includes(req.headers.origin))){res.status(403).json({error:{code:'ORIGIN_REJECTED'}});return;}
   if(path==='query'&&!validFinanceQuery(req.body)){res.status(400).json({error:{code:'INVALID_FINANCE_QUERY'}});return;}
   if(path==='refresh'&&req.body&&Object.keys(req.body).length){res.status(400).json({error:{code:'INVALID_FINANCE_QUERY'}});return;}
   if(path==='refresh-job'&&(!req.body||Object.keys(req.body).join(',')!=='jobNumber'||typeof req.body.jobNumber!=='string'||!/^\d{1,10}$/.test(req.body.jobNumber))){res.status(400).json({error:{code:'INVALID_FINANCE_QUERY'}});return;}
   const key=(path==='refresh'||path==='refresh-job')?options.refreshKey:options.readKey;
   if(!options.baseUrl||!key){res.status(503).json({error:{code:'FINANCE_NOT_CONFIGURED'}});return;}
   if(active>=4){res.status(429).json({error:{code:'FINANCE_BUSY'}});return;}active++;
   try{
    const response=await(options.fetchImpl??fetch)(`${options.baseUrl.replace(/\/$/,'')}/v1/${path}`,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${key}`,accept:'application/json','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(path==='query'||path==='refresh-job'?req.body:{})}:{})});
    const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let n=0;
    try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.byteLength;if(n>512000)throw Error();chunks.push(p.value);}}finally{await reader.cancel();}
    const raw=Buffer.concat(chunks).toString();if([options.readKey,options.refreshKey].some(k=>k&&raw.includes(k)))throw Error();
    const data:unknown=JSON.parse(raw);
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error();
    if(!response.ok){
     const code=(data as {error?:{code?:string}}).error?.code;
     const permitted=['SYNC_ALREADY_RUNNING','REFRESH_COOLDOWN','FINANCE_UNAVAILABLE','JOB_NOT_UNIQUE'];
     res.status(response.status===400?400:response.status===409?409:response.status===429?429:502).json({error:{code:code&&permitted.includes(code)?code:'FINANCE_UNAVAILABLE'}});return;
    }
    res.status(response.status).json(data);
   }catch{res.status(502).json({error:{code:'FINANCE_UNAVAILABLE'}});}finally{active--;}
  });
 }
 router.use(prefix,(_req,res)=>{res.status(404).json({error:{code:'NOT_FOUND'}});});return router;
}
