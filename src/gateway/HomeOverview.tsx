import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core';
import { ArrowUpRight, Wallet, TrendingUp, CircleAlert, Radio } from 'lucide-react';
import { BarChart, businessTotal, numeric, type DashboardBank, type DashboardForecast, type DashboardActivity } from './FinanceDashboard';
import './HomeOverview.css';

type Section = 'overview'|'bank'|'forecast'|'tasks'|'connections';
type Feed = {name:string;status:string;message:string;lastImport:string|null};
export type HomeData = {bank?:DashboardBank;forecast?:DashboardForecast;activity?:DashboardActivity;feeds?:{feeds:Feed[]};suppliers?:{jobReviewCount:number};receipts?:{count:number}};
type Key = keyof HomeData;
export type HomeErrors = Partial<Record<Key,string>>;
const endpoints:Record<Key,string>={bank:'/api/finance/plaid/status',forecast:'/api/finance/forecast',activity:'/api/finance/dashboard',feeds:'/api/finance/feeds',suppliers:'/api/finance/suppliers/status?offset=0',receipts:'/api/finance/receipts'};
const names:Record<Key,string>={bank:'Bank balances',forecast:'Job forecasts',activity:'Collections',feeds:'Feed status',suppliers:'Invoice reviews',receipts:'Deposit reviews'};
const roles=['receivables','bill_pay','incidentals','job_savings'];
const money=(v:unknown)=>numeric(v)===null?'Not available':numeric(v)!.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=0;
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const date=(v:string|null|undefined)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':'Not yet imported';
// Check the shapes this view consumes. Failed or incompatible responses never become zeros.
export function validateHomeData(key:Key,v:unknown):boolean {
 if(!object(v))return false;
 switch(key){
 case 'bank':return Array.isArray(v.accounts)&&v.accounts.every(a=>object(a)&&typeof a.id==='string'&&typeof a.role==='string'&&typeof a.mask==='string'&&typeof a.present==='boolean'&&object(a.planning));
 case 'forecast':return count(v.approvedJobs)&&count(v.matchedJobs)&&count(v.reviewJobs)&&Array.isArray(v.rows);
 case 'activity':return typeof v.available==='boolean'&&typeof v.asOf==='string'&&Array.isArray(v.months)&&v.months.every(m=>object(m)&&typeof m.month==='string'&&/^\d{4}-\d{2}$/.test(m.month));
 case 'feeds':return Array.isArray(v.feeds)&&v.feeds.every(f=>object(f)&&typeof f.name==='string'&&typeof f.status==='string'&&typeof f.message==='string');
 case 'suppliers':return count(v.jobReviewCount);
 case 'receipts':return count(v.count);
 }
}
export function HomeOverview({onNavigate,attention=[],running=false}:{onNavigate?:(s:Section)=>void;attention?:string[];running?:boolean}){
 const [data,setData]=useState<HomeData>({}),[errors,setErrors]=useState<HomeErrors>({});
 useEffect(()=>{let active=true,busy=false;const abort=new AbortController();
 const load=async()=>{if(busy||document.hidden)return;busy=true;try{await Promise.allSettled((Object.keys(endpoints) as Key[]).map(async key=>{try{
 const response=await fetch(endpoints[key],{credentials:'same-origin',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(25000)])});if(!response.ok)throw Error();
 const value:unknown=await response.json();if(!validateHomeData(key,value))throw Error();
 // Home only retains aggregate review counts, not all supplier documents or deposit descriptions.
 const selected=key==='suppliers'?{jobReviewCount:(value as {jobReviewCount:number}).jobReviewCount}:key==='receipts'?{count:(value as {count:number}).count}:value;
 if(active){setData(old=>({...old,[key]:selected}));setErrors(old=>({...old,[key]:undefined}));}
 }catch{if(active)setErrors(old=>({...old,[key]:`${names[key]} could not refresh.`}));}}));}finally{busy=false;}};
 void load();const timer=setInterval(()=>void load(),60000);const visible=()=>{if(!document.hidden)void load();};document.addEventListener('visibilitychange',visible);
 return()=>{active=false;abort.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[]);
 return <HomeOverviewView data={data} errors={errors} onNavigate={onNavigate} attention={attention} running={running}/>;
}
export function HomeOverviewView({data,errors={},onNavigate,attention=[],running=false}:{data:HomeData;errors?:HomeErrors;onNavigate?:(s:Section)=>void;attention?:string[];running?:boolean}){
 const {bank,forecast,activity,feeds,suppliers,receipts}=data;
 const accounts=bank?.accounts.filter(a=>roles.includes(a.role))??[];
 const latest=activity?.available?activity.months.find(m=>m.month===activity.asOf.slice(0,7)):undefined;
 const cash=bank?businessTotal(bank.accounts,'reportedAvailable'):null;
 const projected=bank?businessTotal(bank.accounts,'projectedBalance'):null;
 const bankWarning=Boolean(errors.bank)||accounts.some(a=>a.stale||a.error||!a.present)||roles.some(r=>accounts.filter(a=>a.role===r).length!==1);
 const open=(s:Section)=>onNavigate?.(s);
 const action=(label:string,s:Section)=><Button label={label} variant="secondary" size="sm" clickAction={()=>open(s)}/>;
 const sourceNote=(key:Key,at?:string|null,stale?:boolean,error?:string|null)=>`${errors[key]||error?'Refresh failed · ':stale?'May be stale · ':''}Updated ${date(at)}`;
 return <div className="home-overview">
 <div className="home-metrics">
 <article className="home-metric home-cash"><Wallet size={20} aria-hidden="true"/><h2>Business cash available</h2><strong>{money(cash)}</strong><p>Bank-reported available · four business accounts</p>{bankWarning&&<p className="home-warning">Check account coverage and freshness before spending.</p>}{action('View cash & transactions','bank')}</article>
 <article className="home-metric"><TrendingUp size={20} aria-hidden="true"/><h2>Forecast gross profit</h2><strong>{money(forecast?.projectedGrossProfit)}</strong><p>{forecast?`${forecast.matchedJobs} of ${forecast.approvedJobs} approved jobs with matched budgets`:'Waiting for approved job budgets'}</p><small>Whole-job estimate before overhead and tax</small><small>{sourceNote('forecast',forecast?.lastRefresh,forecast?.stale,forecast?.error)}</small></article>
 <article className="home-metric"><ArrowUpRight size={20} aria-hidden="true"/><h2>Still to collect</h2><strong>{money(forecast?.outstandingCollections)}</strong><p>Customer balances on approved work</p><small>Includes money needed to finish jobs; timing not established.</small>{action('See approved jobs','forecast')}</article>
 <article className="home-metric"><ArrowUpRight size={20} aria-hidden="true"/><h2>Collected this month</h2><strong>{money(latest?.receipts)}</strong><p>{latest?`${latest.month} · month to date`:'Current month not available'}</p><small>AccuLynx receipts, not bank-verified income</small><small>{sourceNote('activity',activity?.lastRefresh,activity?.stale,activity?.error)}</small></article>
 </div>
 {Object.entries(errors).filter(([,v])=>v).map(([k,v])=><p role="alert" className="home-warning" key={k}>{v} Any previously loaded figures may be outdated.</p>)}
 <div className="home-columns">
 <section className="home-panel home-decisions"><div className="home-title"><CircleAlert size={20} aria-hidden="true"/><div><p className="home-eyebrow">Your next decisions</p><h2>Needs your attention</h2></div></div><p>Open a review to see the evidence and keep control of the decision.</p>
 <div className="home-review-list">{[
 {label:'Invoice job assignments',value:suppliers?.jobReviewCount,key:'suppliers' as Key,section:'tasks' as Section},
 {label:'Customer deposit matches',value:receipts?.count,key:'receipts' as Key,section:'tasks' as Section},
 {label:'Job budgets needing review',value:forecast?.reviewJobs,key:'forecast' as Key,section:'forecast' as Section},
 ].map(row=><div className="home-review" key={row.key}><span className="home-count">{row.value??'—'}</span><div><strong>{row.label}</strong><small>{errors[row.key]?'Refresh unavailable':row.value===undefined?'Checking…':row.value===0?'No items reported':'Owner review needed'}</small></div>{action('Review '+row.label.toLowerCase(),row.section)}</div>)}</div>
 {attention.length>0&&<ul>{attention.map((a,i)=><li key={i}>{a}</li>)}</ul>}
 {running&&<p role="status">Insurance Agent is working on your current request.</p>}
 <p className="home-note">Counts are separate review queues, not a combined count of unique transactions. Sending and record changes keep their existing approvals.</p>
 </section>
 <section className="home-panel"><div className="home-title"><Wallet size={20} aria-hidden="true"/><div><p className="home-eyebrow">Cash position</p><h2>Available & pending</h2></div></div>
 {bank?<BarChart labels={['Available now','Pending-adjusted ledger']} rows={accounts.map(a=>({label:a.role.replaceAll('_',' '),note:`••${a.mask} · ${a.stale||a.error?'Check freshness':date(a.providerUpdated??a.lastImport)}`,a:a.present&&a.currency==='USD'?numeric(a.planning.reportedAvailable):null,b:a.present&&a.currency==='USD'?numeric(a.planning.projectedBalance):null}))}/>:<p>Loading bank balances. Missing amounts are not treated as zero.</p>}
 <div className="home-projection"><span>Combined pending-adjusted ledger</span><strong>{money(projected)}</strong></div><p className="home-note">Pending items may already affect available cash. This is a separate ledger scenario, not an extra deduction or extra money. Personal accounts, cards and loans are excluded.</p>
 </section>
 <section className="home-panel"><p className="home-eyebrow">Last three months</p><h2>Collections & job costs</h2>
 {activity?.available?<BarChart labels={['Customer receipts','Recorded job costs']} rows={activity.months.slice(-3).map(m=>({label:m.month,note:m.partial?'Month to date':undefined,a:numeric(m.receipts),b:numeric(m.recordedCosts)}))}/>:<p>A completed AccuLynx import is needed to show this chart.</p>}
 <p className="home-note">Recorded costs include paid, unpaid and unknown payment statuses. The difference between these bars is not net profit.</p><p className="home-note">{sourceNote('activity',activity?.lastRefresh,activity?.stale,activity?.error)}</p>{action('Explore financial dashboard','overview')}
 </section>
 <section className="home-panel"><div className="home-title"><Radio size={20} aria-hidden="true"/><div><p className="home-eyebrow">Connected evidence</p><h2>How current is this?</h2></div></div>
 {feeds?.feeds.length?<ul className="home-feeds">{feeds.feeds.map(f=><li key={f.name}><span className={'home-dot '+(f.status==='current'?'home-dot-current':'')} aria-hidden="true"/><div><strong>{f.name}</strong><span>{f.status.replaceAll('_',' ')} · {date(f.lastImport)}</span><small>{f.message}</small></div></li>)}</ul>:<p>Checking connection freshness. No feed is assumed current.</p>}
 <p className="home-note">This page checks saved data every minute while visible. Provider updates follow each feed’s schedule. QuickBooks excludes For Review items; Amex stays outside QuickBooks.</p>{action('Check all connections','connections')}
 </section>
 </div>
 </div>;
}
