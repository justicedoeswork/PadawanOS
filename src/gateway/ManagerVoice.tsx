import {useEffect,useRef,useState} from 'react';
import {MAX_VOICE_BYTES,recordingType,speakReply,transcribeQuestion} from './managerVoice';
import {createVoiceActivity} from './voiceActivity';

type Phase='idle'|'permission'|'recording'|'transcribing'|'answering'|'speaking';
type Props={disabled:boolean;onQuestion:(text:string)=>Promise<string>;onBusyChange:(busy:boolean)=>void;lastReply?:string};
export function ManagerVoice(props:Props) {
  const [phase,setPhase]=useState<Phase>('idle'),[notice,setNotice]=useState('');
  const [spoken,setSpoken]=useState(true),[reading,setReading]=useState(false);
  const latest=useRef(props);latest.current=props;
  const spokenRef=useRef(true),generation=useRef(0),active=useRef(false);
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null);
  const audio=useRef<AudioContext|null>(null),source=useRef<MediaStreamAudioSourceNode|null>(null);
  const request=useRef<AbortController|null>(null),poll=useRef<ReturnType<typeof setInterval>|undefined>(undefined);
  const resumeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const stopSpeech=useRef<()=>void>(()=>{}),mounted=useRef(true);
  const supported=typeof navigator!=='undefined'&&Boolean(navigator.mediaDevices?.getUserMedia)&&recordingType()!==null&&typeof AudioContext!=='undefined';
  const current=(token:number)=>mounted.current&&active.current&&token===generation.current;
  function release(){
    clearInterval(poll.current);source.current?.disconnect();source.current=null;
    if(recorder.current?.state==='recording')recorder.current.stop();
    stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;recorder.current=null;
  }
  function end(message=''){
    active.current=false;generation.current++;clearTimeout(resumeTimer.current);
    request.current?.abort();request.current=null;release();stopSpeech.current();
    const context=audio.current;audio.current=null;if(context)void context.close().catch(()=>{});
    if(mounted.current){setPhase('idle');setReading(false);setNotice(message);}
    latest.current.onBusyChange(false);
  }
  useEffect(()=>{
    mounted.current=true;
    const hidden=()=>{if(document.hidden)end();};
    document.addEventListener('visibilitychange',hidden);
    return()=>{mounted.current=false;end();document.removeEventListener('visibilitychange',hidden);};
  },[]);
  function next(token:number){
    if(!current(token))return;
    setPhase('permission');
    resumeTimer.current=setTimeout(()=>{if(current(token))void listen(token);},350);
  }
  function play(text:string,token?:number){
    stopSpeech.current();setReading(true);if(token!==undefined)setPhase('speaking');
    stopSpeech.current=speakReply(text,failed=>{
      if(!mounted.current)return;
      setReading(false);
      if(token!==undefined){
        if(!current(token))return;
        if(failed)end('Audio playback was unavailable. Your answer is shown in chat.');else next(token);
      }else if(failed)setNotice('Audio playback was unavailable. Your answer is shown in chat.');
    });
  }
  function skipSpeech(){stopSpeech.current();setReading(false);if(active.current)next(generation.current);}
  async function listen(token:number){
    if(!current(token))return;
    const type=recordingType();if(!type){end('Recording is unavailable in this browser.');return;}
    try{
      const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(!current(token)){mic.getTracks().forEach(track=>track.stop());return;}
      stream.current=mic;
      const context=audio.current;if(!context)throw Error('Audio unavailable');
      await context.resume();if(!current(token))return;
      const analyser=context.createAnalyser();analyser.fftSize=2048;
      source.current=context.createMediaStreamSource(mic);source.current.connect(analyser);
      const samples=new Float32Array(analyser.fftSize),observe=createVoiceActivity(performance.now());
      const capture=new MediaRecorder(mic,{mimeType:type,audioBitsPerSecond:64_000});recorder.current=capture;
      const chunks:Blob[]=[];let bytes=0;
      capture.ondataavailable=event=>{
        if(!current(token)||!event.data.size)return;
        bytes+=event.data.size;
        if(bytes>MAX_VOICE_BYTES){end('That recording was too large. Please try a shorter question.');return;}
        chunks.push(event.data);
      };
      capture.onerror=()=>{if(current(token))end('The microphone stopped unexpectedly. Please try again.');};
      capture.onstop=async()=>{
        if(!current(token))return;
        release();setPhase('transcribing');
        const controller=new AbortController();request.current=controller;
        const timeout=setTimeout(()=>controller.abort(),35_000);
        try{
          const text=await transcribeQuestion(new Blob(chunks,{type:capture.mimeType||type}),controller.signal);
          clearTimeout(timeout);request.current=null;
          if(!current(token))return;
          setPhase('answering');
          const answer=await latest.current.onQuestion(text);
          if(!current(token))return;
          if(spokenRef.current&&answer)play(answer,token);else next(token);
        }catch(error){if(current(token))end(error instanceof Error&&error.name!=='AbortError'?error.message:'Voice timed out. Please try again.');}
        finally{clearTimeout(timeout);}
      };
      capture.start(500);setPhase('recording');
      poll.current=setInterval(()=>{
        if(!current(token))return;
        analyser.getFloatTimeDomainData(samples);
        const rms=Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);
        const result=observe(rms,performance.now());
        if(result==='quiet')end('Voice paused because no speech was detected. Tap Talk to resume.');
        else if(result==='submit'){clearInterval(poll.current);if(capture.state==='recording')capture.stop();}
      },50);
    }catch{if(current(token))end('Microphone access failed. Allow microphone access in your browser, then try again.');}
  }
  function start(){
    if(props.disabled||active.current)return;
    stopSpeech.current();setReading(false);setNotice('');
    try{
      audio.current=new AudioContext();void audio.current.resume().catch(()=>{});
      active.current=true;const token=++generation.current;
      setPhase('permission');latest.current.onBusyChange(true);void listen(token);
    }catch{end('Voice is unavailable in this browser. You can still type.');}
  }
  return <div className="gw-manager-voice">
    <div className="gw-manager-voice-controls">
      {phase==='idle'?<button type="button" disabled={!supported||props.disabled} onClick={start}>🎙 Talk to Padawan</button>:
        <button type="button" aria-pressed="true" onClick={()=>end()}>End voice chat</button>}
      <label><input type="checkbox" checked={spoken} onChange={event=>{spokenRef.current=event.target.checked;setSpoken(event.target.checked);if(!event.target.checked&&reading)skipSpeech();}}/> Spoken replies</label>
      {reading?<button type="button" onClick={skipSpeech}>Stop speaking</button>:props.lastReply&&<button type="button" disabled={phase!=='idle'||props.disabled} onClick={()=>play(props.lastReply!)}>Read reply</button>}
    </div>
    <p role="status">{notice||(phase==='permission'?'Opening microphone…':phase==='recording'?'Listening… pause when you’re done.':phase==='transcribing'?'Turning your voice into text…':phase==='answering'?'Padawan is checking…':phase==='speaking'?'Padawan is speaking. I’ll listen again after the reply.':supported?'Tap once to talk back and forth.':'Voice recording is unavailable in this browser.')}</p>
    <small>Recordings are sent to OpenAI for transcription. Spoken replies use your device’s synthetic voice.</small>
  </div>;
}
