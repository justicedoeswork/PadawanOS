import {ReceiptReview} from './ReceiptReview';
import './FinanceStatus.css';
import {SupplierStatus} from './SupplierStatus';
import {QuickBooksStatus} from './QuickBooksStatus';
import {useEffect,useState} from 'react';
type Status={lastSuccessfulRefresh:string|null;status:string;stale:boolean;counts:Record<string,number>|null;error:string|null;scheduleEnabled:boolean;currentRun?:{processed_jobs:number;expected_jobs:number|null}|null};
export function FinanceStatus(){
 const [tab,setTab]=useState<'tasks'|'evidence'|'connections'>('tasks'),[status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function load(){try{const r=await fetch('/api/finance/status',{credentials:'same-origin',signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error();setStatus(await r.json());}catch{setMessage('Finance status is unavailable. Check the service connection before relying on saved answers.');}}
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),30000);return()=>clearInterval(timer);},[]);
 async function refresh(){setBusy(true);setMessage('');try{const r=await fetch('/api/finance/refresh',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(25000)});
  setMessage(r.status===202?'Refresh started. The last successful dataset stays available while it runs.':r.status===409?'A refresh is already running.':r.status===429?'Please wait: manual refreshes are limited to one every 15 minutes.':'Refresh could not start. Check the service connection.');await load();
 }catch{setMessage('Refresh request could not be confirmed. Check status before retrying.');}finally{setBusy(false);}}
 return <main className="gw-finance-workspace" aria-label="Finance Agent">
  <header className="gw-finance-heading"><div><p className="gw-finance-eyebrow">Finance Agent</p><h1>Financial review</h1><p>Review supplier documents, resolve job assignments, and check your connected sources.</p></div></header>
  <nav className="gw-finance-tabs" aria-label="Finance sections">{(['tasks','evidence','connections'] as const).map(value=><button key={value} type="button" aria-current={tab===value?'page':undefined} onClick={()=>setTab(value)}>{value==='tasks'?'Needs your input':value==='evidence'?'Supplier evidence':'Connections & freshness'}</button>)}</nav>
  {tab==='connections'?<div className="gw-finance-connections"><section aria-label="AccuLynx connection"><h2>AccuLynx</h2>
  {status&&<div><p>Last successful refresh: {status.lastSuccessfulRefresh?new Date(status.lastSuccessfulRefresh).toLocaleString('en-US',{timeZone:'America/New_York'})+' Eastern':'none'}</p>
   <p>Status: {status.status}{status.stale?' · stale':''}{status.currentRun?` · ${status.currentRun.processed_jobs}/${status.currentRun.expected_jobs??'?'} jobs`:''}</p>
   <p>{status.counts?Object.entries(status.counts).map(([k,v])=>`${k}: ${v}`).join(' · '):'No completed dataset.'}</p>
   <p>{status.scheduleEnabled?'Hourly at :05; nightly full scan at 2:05 AM Eastern.':'Automatic refresh not yet enabled.'}</p>
   {status.error&&<p>Last run failed ({status.error}). The previous dataset remains available. Ask “Finance status” for details.</p>}</div>}
  <button type="button" onClick={()=>void refresh()} disabled={busy||status?.status==='running'}>Refresh now</button>
  <p role="status">{message}</p>
  </section><QuickBooksStatus/>
  </div>:<>{tab==='tasks'&&<ReceiptReview/>}<SupplierStatus mode={tab}/></> }
 </main>;
}
