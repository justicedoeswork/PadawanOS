import { Router } from 'express';
import { createRequireSession } from './requireSession.js';
import { interpretLanguage, parseLanguageInput } from './managerLanguage.js';
export function createManagerLanguageRouter(options:{sessionSecret:string|null;apiKey:string|null;model:string|null;allowedOrigins:string[];fetchImpl?:typeof fetch}){
  const router=Router();let active=0,windowStart=0,count=0;
  router.post('/api/manager/interpret',createRequireSession(options.sessionSecret),async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.headers.origin&&!options.allowedOrigins.includes(req.headers.origin)){res.status(403).json({error:{code:'ORIGIN_REJECTED'}});return;}
    if(!options.apiKey||!options.model){res.status(503).json({error:{code:'LANGUAGE_NOT_CONFIGURED'}});return;}
    let input;
    try{input=parseLanguageInput(req.body);}catch{res.status(400).json({error:{code:'INVALID_LANGUAGE_REQUEST'}});return;}
    // Single-owner gateway: bound cost and concurrency even across browser tabs.
    if(Date.now()-windowStart>60_000){windowStart=Date.now();count=0;}
    if(active>=2||count>=20){res.status(429).json({error:{code:'LANGUAGE_BUSY'}});return;}
    count++;active++;
    try{res.json(await interpretLanguage(input,{apiKey:options.apiKey,model:options.model,...(options.fetchImpl?{fetchImpl:options.fetchImpl}:{})}));}
    catch{res.status(502).json({error:{code:'LANGUAGE_UNAVAILABLE'}});}
    finally{active--;}
  });
  return router;
}
