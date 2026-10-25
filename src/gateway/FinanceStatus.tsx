import {FinanceDashboard} from './FinanceDashboard';
import {ForecastStatus} from './ForecastStatus';
import {PlaidStatus} from './PlaidStatus';
import {ReceiptReview} from './ReceiptReview';
import './FinanceStatus.css';
import {SupplierStatus} from './SupplierStatus';
import {QuickBooksStatus} from './QuickBooksStatus';
import {useEffect,useState} from 'react';
type Feed={name:string;lastImport:string|null;providerUpdated?:string|null;nextRun:string|null;status:string;message:string};
type Status={lastSuccessfulRefresh:string|null;status:string;stale:boolean;counts:Record<string,number>|null;error:string|null;scheduleEnabled:boolean;jobRefreshes?:{job_number:string;status:string;completed_at:string|null;error_code:string|null}[];currentRun?:{target_job_id?:string|null;processed_jobs:number;expected_jobs:number|null}|null};
export type FinanceSection='overview'|'forecast'|'tasks'|'evidence'|'bank'|'connections';
export function FinanceStatus({initialTab='overview'}:{initialTab?:FinanceSection}){
 const [feeds,setFeeds]=useState<Feed[]>([]),[jobNumber,setJobNumber]=useState('');
 const [tab,setTab]=useState<FinanceSection>(initialTab),[status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function load(){try{const r=await fetch('/api/finance/status',{credentials:'same-origin',signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error();setStatus(await r.json());const f=await fetch('/api/finance/feeds',{credentials:'same-origin',signal:AbortSignal.timeout(25000)});if(f.ok)setFeeds((await f.json()).feeds);}catch{setMessage('Finance status is unavailable. Check the service connection before relying on saved answers.');}}
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),30000);return()=>clearInterval(timer);},[]);
 async function refresh(){setBusy(true);setMessage('');try{const r=await fetch('/api/finance/refresh',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(25000)});
  setMessage(r.status===202?'Refresh started. The last successful dataset stays available while it runs.':r.status===409?'A refresh is already running.':r.status===429?'Please wait: manual refreshes are limited to one every 15 minutes.':'Refresh could not start. Check the service connection.');await load();
 }catch{setMessage('Refresh request could not be confirmed. Check status before retrying.');}finally{setBusy(false);}}
 async function refreshJob(){setBusy(true);try{const r=await fetch('/api/finance/refresh-job',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({jobNumber}),signal:AbortSignal.timeout(25000)});setMessage(r.status===202?'Job payment refresh queued. It starts automatically after any active scan.':r.status===400?'Enter one valid imported job number.':r.status===429?'This job was just refreshed. Wait one minute before requesting it again.':'Could not queue this job refresh.');await load();}catch{setMessage('Job refresh request could not be confirmed. Check its status before retrying.');}finally{setBusy(false);}}
 return <main className="gw-finance-workspace" aria-label="Finance Agent">
  <header className="gw-finance-heading"><div><p className="gw-finance-eyebrow">Finance Agent</p><h1>Finance</h1></div></header>
  <section aria-label="Automatic feed status">{feeds.filter(f=>f.status!=='current').map(f=><p role="status" key={f.name}>{f.name}: {f.message}</p>)}</section>
  <nav className="gw-finance-tabs" aria-label="Finance sections">{(['overview','forecast','tasks','evidence','bank','connections'] as const).map(value=><button key={value} type="button" aria-current={tab===value?'page':undefined} onClick={()=>setTab(value)}>{value==='overview'?'Dashboard':value==='forecast'?'Forecast':value==='tasks'?'Needs your input':value==='evidence'?'Supplier evidence':value==='bank'?'Bank & Amex':'Connections'}</button>)}</nav>
  {tab==='overview'?<FinanceDashboard onNavigate={setTab}/>:tab==='forecast'?<ForecastStatus/>:tab==='bank'?<PlaidStatus/>:tab==='connections'?<div className="gw-finance-connections"><section aria-label="AccuLynx connection"><h2>AccuLynx</h2><p>Full scans keep older jobs covered. For a payment you just entered, refresh only that job:</p><label>Job number <input inputMode="numeric" value={jobNumber} onChange={e=>setJobNumber(e.target.value)} /></label><button type="button" disabled={busy||!/^\d{1,10}$/.test(jobNumber)} onClick={()=>void refreshJob()}>Refresh job payments</button>{status?.jobRefreshes?.map(j=><p key={j.job_number}>Job {j.job_number}: {j.status}{j.completed_at?' · '+new Date(j.completed_at).toLocaleString('en-US',{timeZone:'America/New_York'})+' Eastern':''}{j.error_code?' · '+j.error_code:''}</p>)}
  {status&&<div><p>Last successful refresh: {status.lastSuccessfulRefresh?new Date(status.lastSuccessfulRefresh).toLocaleString('en-US',{timeZone:'America/New_York'})+' Eastern':'none'}</p>
   <p>Status: {status.status}{status.stale?' · stale':''}{status.currentRun?` · ${status.currentRun.processed_jobs}/${status.currentRun.expected_jobs??'?'} jobs`:''}</p>
   <p>{status.counts?Object.entries(status.counts).map(([k,v])=>`${k}: ${v}`).join(' · '):'No completed dataset.'}</p>
   <p>{status.scheduleEnabled?'Hourly at :05; nightly full scan at 2:05 AM Eastern.':'Automatic refresh not yet enabled.'}</p>
   {status.error&&<p>Last run failed ({status.error}). The previous dataset remains available. Ask “Finance status” for details.</p>}</div>}
  <button type="button" onClick={()=>void refresh()} disabled={busy||status?.status==='running'}>Run full coverage scan</button>
  <p role="status">{message}</p>
  </section><section aria-label="Feed freshness"><h2>Automatic connections</h2>{feeds.map(f=><article key={f.name}><h3>{f.name}</h3><p>{f.message}</p><p>Last import: {f.lastImport?new Date(f.lastImport).toLocaleString('en-US',{timeZone:'America/New_York'})+' Eastern':'not available'}</p>{f.providerUpdated!==undefined&&<p>Bank/provider updated: {f.providerUpdated?new Date(f.providerUpdated).toLocaleString('en-US',{timeZone:'America/New_York'})+' Eastern':'not available'}</p>}<p>Next scheduled check: {f.nextRun?new Date(f.nextRun).toLocaleString('en-US',{timeZone:'America/New_York'})+' Eastern':'not scheduled'}</p></article>)}</section><QuickBooksStatus/>
  </div>:<>{tab==='tasks'&&<><p className="review-lead">Match payments. Assign invoices.</p><ReceiptReview/></>}<SupplierStatus mode={tab} refreshVersion={feeds.find(f=>f.name==='Supplier email')?.lastImport??''}/></> }
 </main>;
}
