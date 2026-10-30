import {useEffect,useState} from 'react';
import {ReceiptReview} from './ReceiptReview';
import {SupplierStatus} from './SupplierStatus';
type Snapshot={last_success:string|null;stale:boolean;payload?:{summary:{depositQuestions:number;supplierQuestions:number;unlinked:number};rows:{id:string;date:string;account:string;description:string;amount:string;currency:string|null;basis:string;settlement?:{state:string}}[];rowsTruncated?:boolean}|null};
export type ReconciliationStatus={status:string;lastSuccess:string|null;summary:{depositQuestions:number;supplierQuestions:number;unlinked:number}|null};
export function FinanceActions({expanded=false,reconciliation}:{expanded?:boolean;reconciliation?:ReconciliationStatus}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(false),[open,setOpen]=useState<'deposits'|'invoices'|'bank'|null>(null);
 const [deposits,setDeposits]=useState<number|null>(null),[invoices,setInvoices]=useState<number|null>(null);
 useEffect(()=>{if(open!=='bank')return;let live=true,busy=false;const controller=new AbortController();async function load(){if(busy||document.hidden)return;busy=true;try{const r=await fetch('/api/finance/query',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'attention',attention:'reconciliation',period:'all_time',jobSearch:''}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});if(!r.ok)throw Error();const d=await r.json();if(!d.reconciliation?.payload?.summary)throw Error();if(live){setSnapshot(d.reconciliation);setError(false);}}catch{if(live)setError(true);}finally{busy=false;}}void load();const timer=setInterval(()=>void load(),60000);document.addEventListener('visibilitychange',load);return()=>{live=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};},[open]);
 const summary=reconciliation?.summary;
 const toggle=(section:typeof open)=>setOpen(v=>v===section?null:section);
 return <section className="finance-actions" aria-label="Finance actions">
 <header><div><p className="gw-finance-eyebrow">Your next actions</p><h2>Needs your input</h2></div><span className="review-muted">{reconciliation?.lastSuccess?'Checked '+new Date(reconciliation.lastSuccess).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})+' ET':'Checking…'}</span></header>
 {(error||(reconciliation&&['stale','error','unavailable'].includes(reconciliation.status)))&&<p role="status">Actions may be outdated. Retrying automatically.</p>}
 <div className="finance-action-tiles">
 <button aria-expanded={expanded||open==='deposits'} aria-controls="finance-deposit-actions" onClick={()=>toggle('deposits')}><strong>{deposits??summary?.depositQuestions??'—'}</strong><span>Deposit matches</span><small>Confirm or choose a job →</small></button>
 <button aria-expanded={expanded||open==='invoices'} aria-controls="finance-invoice-actions" onClick={()=>toggle('invoices')}><strong>{invoices??summary?.supplierQuestions??'—'}</strong><span>Invoice assignments</span><small>Choose a job →</small></button>
 <button aria-expanded={open==='bank'} aria-controls="finance-bank-actions" onClick={()=>toggle('bank')}><strong>{summary?.unlinked??'—'}</strong><span>Awaiting evidence</span><small>Inspect unmatched bank activity →</small></button>
 </div>
 <div id="finance-deposit-actions" hidden={!expanded&&open!=='deposits'}><ReceiptReview onCount={setDeposits}/></div>
 <div id="finance-invoice-actions" hidden={!expanded&&open!=='invoices'}><SupplierStatus mode="tasks" refreshVersion={reconciliation?.lastSuccess??''} onCount={setInvoices}/></div>
 {open==='bank'&&<div id="finance-bank-actions">{!snapshot&&!error&&<p role="status">Loading unmatched activity…</p>}<p className="review-muted">The agent keeps checking these. Missing evidence and pending settlement do not always need a decision from you.</p><div className="review-grid">{snapshot?.payload?.rows.map(r=><article className="review-card" key={r.id}><header><h3>{r.description}</h3><strong>{r.amount} {r.currency??''}</strong></header><p>{r.date} · {r.account}</p><details><summary>Why unresolved?</summary><p>{r.basis}</p><p>{r.settlement?.state.replaceAll('_',' ')}</p></details></article>)}</div>{snapshot?.payload?.rowsTruncated&&<p>Showing the first 100. The remaining items stay in the bank register.</p>}</div>}
 </section>;
}
