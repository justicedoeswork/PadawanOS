import {useEffect,useRef,useState} from 'react';
import {MAX_VOICE_BYTES,MAX_VOICE_MS,recordingType,speakReply,transcribeQuestion} from './managerVoice';

type Phase='idle'|'permission'|'recording'|'transcribing'|'answering';
export function ManagerVoice({disabled,onQuestion,onBusyChange,lastReply}:{disabled:boolean;onQuestion:(text:string)=>Promise<string>;onBusyChange:(busy:boolean)=>void;lastReply?:string}) {
  const [phase,setPhase]=useState<Phase>('idle'),[notice,setNotice]=useState('');
  const [spoken,setSpoken]=useState(true),[speaking,setSpeaking]=useState(false);
  const spokenRef=useRef(true),generation=useRef(0),recorder=useRef<MediaRecorder|null>(null);
  const stream=useRef<MediaStream|null>(null),request=useRef<AbortController|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const stopSpeech=useRef<()=>void>(()=>{}),mounted=useRef(true);
  const supported=typeof navigator!=='undefined'&&Boolean(navigator.mediaDevices?.getUserMedia)&&recordingType()!==null;
  function silence(){stopSpeech.current();setSpeaking(false);}
  function release(){
    clearTimeout(timer.current);
    if(recorder.current?.state==='recording')recorder.current.stop();
    stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;recorder.current=null;
  }
  function cancel(){generation.current++;request.current?.abort();release();setPhase('idle');onBusyChange(false);}
  useEffect(()=>{
    mounted.current=true;
    const hidden=()=>{if(document.hidden){cancel();silence();}};
    document.addEventListener('visibilitychange',hidden);
    return()=>{mounted.current=false;generation.current++;request.current?.abort();release();stopSpeech.current();onBusyChange(false);document.removeEventListener('visibilitychange',hidden);};
  },[]);
  useEffect(()=>{if(disabled)silence();},[disabled]);
  function play(text:string){
    silence();setSpeaking(true);
    stopSpeech.current=speakReply(text,failed=>{if(mounted.current){setSpeaking(false);if(failed)setNotice('Audio playback was unavailable. Your answer is still shown in chat.');}});
  }
  async function start(){
    if(disabled||phase!=='idle')return;
    silence();setNotice('');const token=++generation.current;
    const type=recordingType();if(!type){setNotice('Recording is unavailable in this browser. You can still type.');return;}
    setPhase('permission');onBusyChange(true);
    try{
      const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(token!==generation.current){mic.getTracks().forEach(track=>track.stop());return;}
      stream.current=mic;
      const capture=new MediaRecorder(mic,{mimeType:type,audioBitsPerSecond:64_000});recorder.current=capture;
      const chunks:Blob[]=[];let bytes=0;
      capture.ondataavailable=event=>{
        if(token!==generation.current||!event.data.size)return;
        bytes+=event.data.size;
        if(bytes>MAX_VOICE_BYTES){cancel();setNotice('That recording was too large. Please try a shorter question.');return;}
        chunks.push(event.data);
      };
      capture.onerror=()=>{if(token===generation.current){cancel();setNotice('The microphone stopped unexpectedly. Please try again.');}};
      capture.onstop=async()=>{
        if(token!==generation.current)return;
        release();setPhase('transcribing');
        const controller=new AbortController();request.current=controller;
        const timeout=setTimeout(()=>controller.abort(),35_000);
        try{
          const text=await transcribeQuestion(new Blob(chunks,{type:capture.mimeType||type}),controller.signal);
          if(token!==generation.current)return;
          setPhase('answering');clearTimeout(timeout);
          const answer=await onQuestion(text);
          if(token!==generation.current)return;
          if(spokenRef.current&&answer)play(answer);
        }catch(error){if(token===generation.current)setNotice(error instanceof Error&&error.name!=='AbortError'?error.message:'Voice timed out. Please try again.');}
        finally{clearTimeout(timeout);if(token===generation.current){request.current=null;setPhase('idle');onBusyChange(false);}}
      };
      capture.start(500);setPhase('recording');
      timer.current=setTimeout(()=>{if(capture.state==='recording')capture.stop();},MAX_VOICE_MS);
    }catch{if(token===generation.current){cancel();setNotice('Microphone access failed. Allow microphone access in your browser, then try again.');}}
  }
  return <div className="gw-manager-voice">
    <div className="gw-manager-voice-controls">
      <button type="button" disabled={!supported||disabled||phase==='transcribing'||phase==='answering'||phase==='permission'}
        aria-pressed={phase==='recording'} onClick={()=>phase==='recording'?recorder.current?.stop():void start()}>
        {phase==='recording'?'Finish & ask':'🎙 Talk to Padawan'}
      </button>
      {phase!=='idle'&&phase!=='answering'&&<button type="button" onClick={cancel}>Cancel recording</button>}
      <label><input type="checkbox" checked={spoken} onChange={event=>{spokenRef.current=event.target.checked;setSpoken(event.target.checked);if(!event.target.checked)silence();}}/> Spoken replies</label>
      {speaking?<button type="button" onClick={silence}>Stop speaking</button>:lastReply&&<button type="button" disabled={phase!=='idle'||disabled} onClick={()=>play(lastReply)}>Read reply</button>}
    </div>
    <p role="status">{notice||(phase==='permission'?'Waiting for microphone permission…':phase==='recording'?'Listening—tap Finish & ask when done. Stops after 60 seconds.':phase==='transcribing'?'Turning your voice into text…':phase==='answering'?'Padawan is checking…':supported?'Record a question, then tap Finish & ask.':'Voice recording is unavailable in this browser.')}</p>
    <small>Recordings are sent to OpenAI for transcription. Spoken replies use your device’s synthetic voice.</small>
  </div>;
}
