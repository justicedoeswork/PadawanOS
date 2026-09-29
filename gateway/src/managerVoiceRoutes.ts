import {Router,raw,type ErrorRequestHandler} from 'express';
import {createRequireSession} from './requireSession.js';

const formats:Record<string,string>={'audio/webm':'webm','audio/mp4':'mp4'};
export function createManagerVoiceRouter(options:{sessionSecret:string|null;apiKey:string|null;allowedOrigins:string[];fetchImpl?:typeof fetch}) {
  const router=Router();let active=0,count=0,windowStart=0;
  router.post('/api/manager/transcribe',createRequireSession(options.sessionSecret),(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(!req.headers.origin||!options.allowedOrigins.includes(req.headers.origin)){res.status(403).json({error:{code:'ORIGIN_REJECTED'}});return;}
    if(!options.apiKey){res.status(503).json({error:{code:'VOICE_NOT_CONFIGURED'}});return;}
    const mime=(req.get('content-type')??'').split(';')[0]!.trim().toLowerCase();
    if(!formats[mime]){res.status(415).json({error:{code:'VOICE_FORMAT_UNSUPPORTED'}});return;}
    if(Date.now()-windowStart>60_000){windowStart=Date.now();count=0;}
    if(active>=2||count>=20){res.status(429).json({error:{code:'VOICE_BUSY'}});return;}
    count++;active++;
    let released=false;const release=()=>{if(!released){released=true;active--;}};
    res.once('finish',release);res.once('close',release);
    next();
  },raw({type:()=>true,limit:2_000_000}),async(req,res)=>{
    if(!Buffer.isBuffer(req.body)||!req.body.length){res.status(400).json({error:{code:'EMPTY_RECORDING'}});return;}
    const mime=(req.get('content-type')??'').split(';')[0]!.trim().toLowerCase();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
    const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnected);
    try {
      const body=new FormData();
      body.set('file',new Blob([new Uint8Array(req.body)],{type:mime}),`question.${formats[mime]}`);
      body.set('model','gpt-transcribe');
      const response=await(options.fetchImpl??fetch)('https://api.openai.com/v1/audio/transcriptions',{
        method:'POST',headers:{authorization:`Bearer ${options.apiKey}`},body,signal:controller.signal
      });
      if(!response.ok){await response.body?.cancel();throw Error('transcription_failed');}
      const reader=response.body?.getReader();if(!reader)throw Error('empty_response');
      const chunks:Uint8Array[]=[];let bytes=0;
      try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>32_000)throw Error('response_too_large');chunks.push(part.value);}}finally{await reader.cancel();}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(typeof data?.text!=='string'||!data.text.trim()){res.status(422).json({error:{code:'NO_SPEECH'}});return;}
      if(data.text.trim().length>2000){res.status(422).json({error:{code:'VOICE_TOO_LONG'}});return;}
      res.json({text:data.text.trim()});
    }catch{if(!res.destroyed)res.status(502).json({error:{code:'VOICE_UNAVAILABLE'}});}
    finally{clearTimeout(timer);res.off('close',disconnected);}
  });
  const errors:ErrorRequestHandler=(error,_req,res,_next)=>{
    res.status(error?.type==='entity.too.large'?413:400).json({error:{code:'INVALID_RECORDING'}});
  };
  router.use('/api/manager/transcribe',errors);
  return router;
}
