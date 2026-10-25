import {JobPicker} from './JobPicker';
import {useState,useRef} from 'react';
import {Button} from '@astryxdesign/core';
type Job={id:string;name:string;jobNumber:string|null;address:string};
export function SupplierAssignment({documentKey,reviewVersion,onSaved}:{documentKey:string;reviewVersion:string;onSaved:()=>void}){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState<Job|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const request=useRef<{jobId:string;id:string}|null>(null);
 async function assign(){if(!selected)return;setBusy(true);setMessage('');if(request.current?.jobId!==selected.id)request.current={jobId:selected.id,id:crypto.randomUUID()};try{const r=await fetch('/api/finance/suppliers/assign',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({documentKey,jobId:selected.id,requestId:request.current.id,expectedReviewId:reviewVersion}),signal:AbortSignal.timeout(25000)});if(r.status===409){setMessage('This assignment changed in another view. Refresh the task before assigning it.');return;}if(!r.ok)throw Error();setMessage('Assignment saved.');setOpen(false);onSaved();}catch{setMessage('Save could not be confirmed. Retry to safely check the same assignment.');}finally{setBusy(false);}}
 return <div className="gw-supplier-assignment">
 <Button label={open?'Cancel':'Assign to job'} variant="secondary" isDisabled={busy} clickAction={()=>{setOpen(!open);setMessage('');}}/>
 {open&&<div><p>Includes completed jobs. Assignment does not confirm payment.</p>
 <JobPicker disabled={busy} onSelect={j=>{setSelected(j);request.current=null;}}/>
 {selected&&<p>Assign to <strong>{selected.name}</strong>{selected.jobNumber?` · Job ${selected.jobNumber}`:''}?</p>}
 <Button label={busy?'Saving / searching…':'Save assignment'} isDisabled={busy||!selected} clickAction={()=>void assign()}/></div>}
 <p role="status">{message}</p></div>;
}
