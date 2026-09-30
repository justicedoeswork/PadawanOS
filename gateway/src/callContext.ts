function record(value:unknown):Record<string,unknown> {
  return value && typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
/** Contact metadata is not speaker identification. Do not expose transcript/history. */
export function callContext(body:unknown,id:string) {
  const message=record(record(record(body).data).message);
  if(message.id!==id||message.provider!=='call_transcription')return null;
  const participants=[message.sender,...(Array.isArray(message.recipients)?message.recipients:[])].map(value=>{
    const person=record(value);
    return {
      name:typeof person.displayName==='string'&&person.displayName.trim()?person.displayName.trim().slice(0,160):null,
      phone:typeof person.phone==='string'?person.phone.slice(0,40):null
    };
  });
  return {callId:id,occurredAt:typeof message.occurredAt==='string'?message.occurredAt:null,
    participants,identityBasis:'call_metadata_not_verified_speaker_identity'};
}
