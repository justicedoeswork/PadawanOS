import {expect,it} from 'vitest';
import {callContext} from '../src/callContext.js';
it('returns only source contact metadata, never transcript or inferred speakers',()=>{
 const body={data:{message:{id:'one',provider:'call_transcription',occurredAt:'2026-09-30T15:18:00Z',sender:{displayName:'Austin'},recipients:[{displayName:'Taylor',phone:'1234'}],bodyText:'Private transcript'},processingHistory:['private']}};
 expect(callContext(body,'one')).toEqual({callId:'one',occurredAt:'2026-09-30T15:18:00Z',participants:[{name:'Austin',phone:null},{name:'Taylor',phone:'1234'}],identityBasis:'call_metadata_not_verified_speaker_identity'});
 expect(callContext(body,'wrong')).toBeNull();
 expect(callContext({data:{message:{...body.data.message,provider:'outlook'}}},'one')).toBeNull();
});
