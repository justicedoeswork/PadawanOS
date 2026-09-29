export const MAX_VOICE_BYTES=2_000_000;
export const MAX_VOICE_MS=60_000;
export function recordingType():string|null {
  if(typeof MediaRecorder==='undefined')return null;
  return ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type))??null;
}
export async function transcribeQuestion(recording:Blob,signal:AbortSignal):Promise<string> {
  if(!recording.size||recording.size>MAX_VOICE_BYTES)throw Error('That recording is empty or too large. Please try a shorter question.');
  const response=await fetch('/api/manager/transcribe',{method:'POST',credentials:'same-origin',headers:{'content-type':recording.type},body:recording,signal});
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const code=data?.error?.code;
    throw Error(code==='NO_SPEECH'?'I couldn’t hear a question. Please try again.':
      code==='VOICE_TOO_LONG'?'Please ask a shorter question.':
      response.status===429?'Voice is busy. Please try again in a moment.':
      response.status===503?'Voice is not configured yet. You can still type your question.':
      'I couldn’t transcribe that recording. Please try again or type your question.');
  }
  if(typeof data?.text!=='string'||!data.text.trim()||data.text.length>2000)throw Error('I couldn’t recognize a usable question. Please try again.');
  return data.text.trim();
}
/** Native speech reads the same visible answer; it does not generate a second answer. */
export function speakReply(text:string,onDone:(failed:boolean)=>void):()=>void {
  if(typeof speechSynthesis==='undefined'||typeof SpeechSynthesisUtterance==='undefined'){onDone(true);return()=>{};}
  speechSynthesis.cancel();
  const chunks:string[]=[];
  for(const word of text.split(/\s+/).filter(Boolean)){
    const last=chunks.at(-1);
    if(last&&last.length+word.length<200)chunks[chunks.length-1]=last+' '+word;
    else chunks.push(word);
  }
  let stopped=false,index=0;
  const next=()=>{
    if(stopped)return;
    const chunk=chunks[index++];if(!chunk){onDone(false);return;}
    const utterance=new SpeechSynthesisUtterance(chunk.trim());utterance.lang='en-US';utterance.rate=1;
    utterance.onend=next;utterance.onerror=()=>{if(!stopped){stopped=true;onDone(true);}};
    speechSynthesis.speak(utterance);
  };
  next();
  return()=>{stopped=true;speechSynthesis.cancel();};
}
