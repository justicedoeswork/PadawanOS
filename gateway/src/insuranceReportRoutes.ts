import { Router } from 'express';
import { createRequireSession } from './requireSession.js';

export function parseReportRequest(raw:unknown) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid_report');
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='activeOnly,email,requestId,requestText,search'||
    typeof v.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.requestId)||
    typeof v.email!=='boolean'||typeof v.activeOnly!=='boolean'||
    typeof v.search!=='string'||v.search.length>200||/[\x00-\x1f]/.test(v.search)||
    typeof v.requestText!=='string'||!v.requestText.trim()||v.requestText.length>2000)throw Error('invalid_report');
  return {requestId:v.requestId.toLowerCase(),requestText:v.requestText.trim(),search:v.search.trim(),email:v.email,activeOnly:v.activeOnly};
}
export function reportUpstream(acpUrl:string|null):string|null {
  if(!acpUrl)return null;
  try{
    const u=new URL(acpUrl);
    if(!['ws:','wss:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/acp'||
      !(u.hostname==='insurance-audit-agent.internal'||['127.0.0.1','localhost','[::1]'].includes(u.hostname)))return null;
    u.protocol=u.protocol==='wss:'?'https:':'http:';u.pathname='/manager/insurance/report';return u.toString();
  }catch{return null;}
}
export function createInsuranceReportRouter(options:{sessionSecret:string|null;allowedOrigins:string[];
  acpUrl:string|null;serviceKey:string|null;userId:string|null;realmId:string|null;fetchImpl?:typeof fetch}) {
  const router=Router();const upstream=reportUpstream(options.acpUrl);let active=0;
  router.post('/api/insurance/report',createRequireSession(options.sessionSecret),async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!req.headers.origin||!options.allowedOrigins.includes(req.headers.origin)){res.status(403).json({error:{code:'ORIGIN_REJECTED'}});return;}
    if(!req.is('application/json')){res.status(415).json({error:{code:'JSON_REQUIRED'}});return;}
    if(!upstream||!options.serviceKey||!options.userId||!options.realmId){res.status(503).json({error:{code:'REPORT_NOT_CONFIGURED'}});return;}
    let request;try{request=parseReportRequest(req.body);}catch{res.status(400).json({error:{code:'INVALID_REPORT_REQUEST'}});return;}
    if(active>=2){res.status(429).json({error:{code:'REPORT_BUSY'}});return;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180_000);active++;
    try{
      const response=await (options.fetchImpl??fetch)(upstream,{method:'POST',redirect:'error',signal:controller.signal,
        headers:{authorization:`Bearer ${options.serviceKey}`,'content-type':'application/json',
          'x-acp-user-id':options.userId,'x-acp-realm-id':options.realmId},body:JSON.stringify(request)});
      if(!response.ok){await response.body?.cancel();res.status(response.status===429?429:502).json({error:{code:'REPORT_STATUS_UNCONFIRMED'}});return;}
      const reader=response.body?.getReader();if(!reader)throw Error('missing_response');
      let length=0;const chunks:Uint8Array[]=[];
      try{for(;;){const p=await reader.read();if(p.done)break;length+=p.value.byteLength;if(length>32_768)throw Error('large_response');chunks.push(p.value);}}finally{await reader.cancel();}
      const result=JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>;
      if(!result||typeof result!=='object'||result.requestId!==request.requestId||
        !['working','completed','partially_completed','failed','needs_review'].includes(String(result.status)))throw Error('invalid_response');
      res.status(response.status===202?202:200).json(result);
    }catch{res.status(502).json({error:{code:'REPORT_STATUS_UNCONFIRMED'}});}
    finally{clearTimeout(timer);active--;}
  });
  return router;
}
