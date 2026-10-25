import {Router} from 'express';
import {createRequireSession} from './requireSession.js';
import {reportUpstream} from './insuranceReportRoutes.js';
export function createInsuranceAttentionRouter(options:{sessionSecret:string|null;acpUrl:string|null;serviceKey:string|null;userId:string|null;realmId:string|null;fetchImpl?:typeof fetch}){
 const router=Router();const upstream=reportUpstream(options.acpUrl)?.replace(/\/report$/,'/attention');let active=0;
 router.get('/api/insurance/attention',createRequireSession(options.sessionSecret),async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(Object.keys(req.query).length){res.status(400).json({error:{code:'INVALID_QUERY'}});return;}
  if(!upstream||!options.serviceKey||!options.userId||!options.realmId){res.status(503).json({error:{code:'INSURANCE_NOT_CONFIGURED'}});return;}
  if(active>=2){res.status(429).json({error:{code:'INSURANCE_BUSY'}});return;}active++;
  try{
   const r=await(options.fetchImpl??fetch)(upstream,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${options.serviceKey}`,'x-acp-user-id':options.userId,'x-acp-realm-id':options.realmId}});
   if(!r.ok){await r.body?.cancel();throw Error();}
   const reader=r.body?.getReader();if(!reader)throw Error();let size=0;const parts:Uint8Array[]=[];
   try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>65536)throw Error();parts.push(p.value);}}finally{await reader.cancel();}
   const raw=Buffer.concat(parts).toString();if(raw.includes(options.serviceKey))throw Error();const d=JSON.parse(raw);
   if(!d||!Number.isInteger(d.count)||d.count<0||!Number.isInteger(d.activeContractors)||d.activeContractors<d.count||typeof d.checkedAt!=='string'||!Number.isFinite(Date.parse(d.checkedAt))||typeof d.basis!=='string'||typeof d.hasMore!=='boolean'||!Array.isArray(d.items)||d.items.length>50||d.items.some((v:any)=>!v||typeof v.id!=='string'||typeof v.title!=='string'||!Array.isArray(v.reasons)||!v.reasons.every((r:unknown)=>typeof r==='string')))throw Error();
   res.json({checkedAt:d.checkedAt,activeContractors:d.activeContractors,count:d.count,hasMore:d.hasMore,basis:d.basis,items:d.items.map((v:any)=>({id:v.id,title:v.title,reasons:v.reasons}))});
  }catch{res.status(502).json({error:{code:'INSURANCE_ATTENTION_UNAVAILABLE'}});}finally{active--;}
 });return router;
}
