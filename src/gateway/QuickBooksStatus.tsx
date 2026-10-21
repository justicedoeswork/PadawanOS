import {useEffect,useState} from 'react';
type Coverage={company:string|null;lastRefresh:string|null;nextRefresh:string;error:string|null;syncRunning:boolean;limitations:string[];accounts:{id:string;name:string;role:string|null;book_balance:number|null;last_seen:string}[]};
export function QuickBooksStatus(){
 const [status,setStatus]=useState<Coverage|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function load(){try{const r=await fetch('/api/finance/quickbooks/status',{credentials:'same-origin',signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error();setStatus(await r.json());}catch{setMessage('QuickBooks status is unavailable.');}}
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),30000);return()=>clearInterval(timer);},[]);
 async function action(kind:'connect'|'refresh'){setBusy(true);try{const r=await fetch('/api/finance/quickbooks/'+kind,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(65000)});if(!r.ok)throw Error();const data=await r.json();if(kind==='connect'){const u=new URL(data.authorizationUrl);if(u.origin!=='https://appcenter.intuit.com'||u.pathname!=='/connect/oauth2')throw Error();window.location.assign(u.href);}else{setMessage('QuickBooks verification started. The last successful snapshot stays available.');await load();}}catch{setMessage('QuickBooks request could not complete. Check status before retrying.');}finally{setBusy(false);}}
 return <section aria-label="QuickBooks connection"><h3>QuickBooks posted accounting</h3>
  <p>Intuit grants accounting read/write authorization. This application enforces read-only accounting access.</p>
  <button type="button" disabled={busy} onClick={()=>void action('connect')}>Connect / reconnect QuickBooks</button>
  <button type="button" disabled={busy||status?.syncRunning} onClick={()=>void action('refresh')}>Verify posted records now</button>
  {status&&<><p>Company: {status.company??'not connected'}. Last completed import: {status.lastRefresh??'none'}. Next hourly refresh: {status.nextRefresh}.</p>
   {status.error&&<p>Last attempt failed ({status.error}); the saved snapshot may be stale.</p>}
   <ul>{status.accounts.filter(a=>a.role||a.name.includes('9370')).map(a=><li key={a.id}>{a.name} · ID {a.id} · {a.role??'mapping unresolved'} · book balance {a.book_balance??'unknown'} · refreshed {a.last_seen}</li>)}</ul>
   {status.limitations.map(x=><p key={x}>{x}</p>)}</>}
  <p role="status">{message}</p>
 </section>;
}
