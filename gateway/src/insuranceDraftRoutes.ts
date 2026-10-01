import { Router } from 'express';
import { createRequireSession } from './requireSession.js';

const requestIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseDraftRequest(raw:unknown) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid_draft');
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='contractor,coverageType,requestId,requestText' ||
    typeof v.requestId!=='string'||!requestIdPattern.test(v.requestId) ||
    (v.coverageType!=='wc'&&v.coverageType!=='gl') ||
    typeof v.contractor!=='string'||!v.contractor.trim()||v.contractor.length>200||/[\x00-\x1f]/.test(v.contractor) ||
    typeof v.requestText!=='string'||!v.requestText.trim()||v.requestText.length>2000)throw Error('invalid_draft');
  return {requestId:v.requestId.toLowerCase(),requestText:v.requestText.trim(),contractor:v.contractor.trim(),coverageType:v.coverageType};
}
export function draftUpstream(acpUrl:string|null):string|null {
  if(!acpUrl)return null;
  try{
    const u=new URL(acpUrl);
    if(!['ws:','wss:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/acp'||
      !(u.hostname==='insurance-audit-agent.internal'||['127.0.0.1','localhost','[::1]'].includes(u.hostname)))return null;
    u.protocol=u.protocol==='wss:'?'https:':'http:';u.pathname='/manager/insurance/draft';return u.toString();
  }catch{return null;}
}
function validResult(value:unknown,requestId:string):value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  if(v.requestId!==requestId||!['not_started','completed','needs_review'].includes(String(v.status))||v.sent!==false)return false;
  if(v.status==='completed'){
    const d=v.draft as Record<string,unknown>|null;
    if(!d||typeof d.body!=='string'||typeof d.subject!=='string'||typeof d.recipient!=='object'||!d.recipient)return false;
  }
  return true;
}
export function createInsuranceDraftRouter(options:{sessionSecret:string|null;allowedOrigins:string[];acpUrl:string|null;serviceKey:string|null;userId:string|null;realmId:string|null;fetchImpl?:typeof fetch}){
  const router=Router();const upstream=draftUpstream(options.acpUrl);let active=0;
  router.post(['/api/insurance/draft','/api/insurance/draft/status'],createRequireSession(options.sessionSecret),async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!req.headers.origin||!options.allowedOrigins.includes(req.headers.origin)){res.status(403).json({error:{code:'ORIGIN_REJECTED'}});return;}
    if(!req.is('application/json')){res.status(415).json({error:{code:'JSON_REQUIRED'}});return;}
    if(!upstream||!options.serviceKey||!options.userId||!options.realmId){res.status(503).json({error:{code:'DRAFT_NOT_CONFIGURED'}});return;}
    let request;try{request=parseDraftRequest(req.body);}catch{res.status(400).json({error:{code:'INVALID_DRAFT_REQUEST'}});return;}
    if(active>=2){res.status(429).json({error:{code:'DRAFT_BUSY'}});return;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180_000);active++;
    try{
      const response=await (options.fetchImpl??fetch)(upstream+(req.path.endsWith('/status')?'/status':''),{method:'POST',redirect:'error',signal:controller.signal,
        headers:{authorization:`Bearer ${options.serviceKey}`,'content-type':'application/json','x-acp-user-id':options.userId,'x-acp-realm-id':options.realmId},body:JSON.stringify(request)});
      if(!response.ok){await response.body?.cancel();res.status(response.status===429?429:502).json({error:{code:'DRAFT_STATUS_UNCONFIRMED'}});return;}
      const reader=response.body?.getReader();if(!reader)throw Error('missing_response');
      let length=0;const chunks:Uint8Array[]=[];
      try{for(;;){const p=await reader.read();if(p.done)break;length+=p.value.byteLength;if(length>32_768)throw Error('large_response');chunks.push(p.value);}}finally{await reader.cancel();}
      const result=JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      if(!validResult(result,request.requestId))throw Error('invalid_response');
      res.status(200).json(result);
    }catch{res.status(502).json({error:{code:'DRAFT_STATUS_UNCONFIRMED'}});}
    finally{clearTimeout(timer);active--;}
  });
  return router;
}
