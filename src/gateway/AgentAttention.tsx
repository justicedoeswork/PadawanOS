import {useEffect,useState} from 'react';
import {Button} from '@astryxdesign/core';
import {Mail,ClipboardList,Megaphone} from 'lucide-react';
import './AgentAttention.css';
export type AgentDestination='replies'|'approvals'|'insurance'|'marketing';
type Item={id:string;title:string;detail:string};
export type AttentionSummary={count:number;items:Item[];note:string;checkedAt:string;partial?:boolean};
type Source='replies'|'approvals'|'insurance'|'marketing'|'media';
export type AttentionData=Partial<Record<Source,AttentionSummary>>;
const endpoints:Record<Source,string>={replies:'/api/communications/emails/needs-reply',approvals:'/api/communications/approvals/pending',insurance:'/api/insurance/attention',marketing:'/api/marketing/campaigns/review',media:'/api/marketing/media/candidates/review'};
const obj=(v:unknown):v is Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,fallback:string)=>typeof v==='string'&&v.trim()?v.slice(0,240):fallback;
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const stamp=(v:unknown,fallback:string)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:fallback;
function unique<T extends {id:string}>(items:T[]):T[]{return [...new Map(items.map(i=>[i.id,i])).values()];}
export function attentionSummary(source:Source,body:unknown,now=new Date()):AttentionSummary{
 const checkedAt=now.toISOString();if(!obj(body))throw Error('Invalid summary');
 if(source==='replies'){
  if(!Array.isArray(body.data)||body.data.some(r=>!obj(r)||!obj(r.message)||typeof r.message.id!=='string'))throw Error('Invalid reply queue');
  const items=unique(body.data.map(r=>({id:r.message.id,title:text(r.message.subject,'Message without subject'),detail:'Reply needed · '+text(typeof r.message.sender==='string'?r.message.sender:r.message.sender?.displayName,'Open Communications for sender and evidence')})));
  return {count:items.length,items:items.slice(0,3),checkedAt,partial:body.data.length>=500,note:'Imported messages flagged for reply. Sending still requires the existing approval process.'};
 }
 if(source==='approvals'){
  if(!obj(body.data)||!Array.isArray(body.data.responseDrafts)||!Array.isArray(body.data.calendarProposals)||[...body.data.responseDrafts,...body.data.calendarProposals].some(r=>!obj(r)||typeof r.id!=='string'))throw Error('Invalid approval queue');
  const drafts=unique(body.data.responseDrafts),calendar=unique(body.data.calendarProposals);
  return {count:drafts.length+calendar.length,items:[],checkedAt,note:`${drafts.length} reply drafts · ${calendar.length} calendar proposals returned. May overlap messages needing replies.`};
 }
 if(source==='insurance'){
  if(!count(body.count)||!count(body.activeContractors)||body.count>body.activeContractors||!Array.isArray(body.items)||body.items.some(r=>!obj(r)||typeof r.id!=='string'||typeof r.title!=='string'||!Array.isArray(r.reasons)||!r.reasons.every((s:unknown)=>typeof s==='string'))||typeof body.hasMore!=='boolean'||typeof body.checkedAt!=='string'||!Number.isFinite(Date.parse(body.checkedAt)))throw Error('Invalid insurance summary');
  return {count:body.count,items:unique(body.items.map(r=>({id:r.id,title:text(r.title,'Contractor'),detail:r.reasons.join(' · ').slice(0,400)}))).slice(0,3),checkedAt:body.checkedAt,note:text(body.basis,'Active contractors only. Coverage on file and COI completeness are separate.'),partial:body.hasMore};
 }
 if(source==='media'){
  if(!Array.isArray(body.items)||body.items.some(r=>!obj(r)||typeof r.candidateId!=='string'||typeof r.status!=='string'))throw Error('Invalid media queue');
  const items=unique(body.items.filter(r=>r.status==='READY_FOR_CAMPAIGN').map(r=>({id:r.candidateId,title:text(r.project?.name,'Creative media'),detail:'Ready for campaign review'})));
  return {count:items.length,items:[],checkedAt:stamp(body.generatedAt,checkedAt),partial:body.items.length>=50,note:'Ready-for-campaign media returned; separate from campaign approvals.'};
 }
 if(!count(body.totalAwaitingReview)||!Array.isArray(body.items)||body.items.some(r=>!obj(r)||typeof r.campaignId!=='string'||typeof r.title!=='string'||!count(r.blockerCount)||!count(r.openChangeRequestCount)||typeof r.reviewable!=='boolean'||typeof r.approvalHealthStatus!=='string'))throw Error('Invalid marketing queue');
 const items=unique(body.items.map(r=>({id:r.campaignId,title:text(r.title,'Campaign'),detail:r.openChangeRequestCount>0?'Changes requested':r.blockerCount>0||r.approvalHealthStatus==='BLOCKED'?'Blocked — evidence or changes needed':r.reviewable&&r.approvalHealthStatus==='READY_FOR_APPROVAL'?'Ready for your review':'Not ready for approval'})));
 return {count:body.totalAwaitingReview,items:items.slice(0,3),checkedAt:stamp(body.generatedAt,checkedAt),partial:items.length<body.totalAwaitingReview,note:'Campaigns awaiting review, including blocked work. Approval and publishing remain in Marketing.'};
}
export function AgentAttention({onOpen}:{onOpen?:(destination:AgentDestination)=>void}){
 const [data,setData]=useState<AttentionData>({}),[errors,setErrors]=useState<Partial<Record<Source,boolean>>>({});
 useEffect(()=>{let live=true,busy=false;const controller=new AbortController();
 const load=async()=>{if(busy||document.hidden)return;busy=true;try{for(const source of Object.keys(endpoints) as Source[]){if(!live)break;try{
 const r=await fetch(endpoints[source],{credentials:'same-origin',headers:{accept:'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});if(!r.ok)throw Error();const value=attentionSummary(source,await r.json());
 if(live){setData(d=>({...d,[source]:value}));setErrors(e=>({...e,[source]:false}));}
 }catch{if(live)setErrors(e=>({...e,[source]:true}));}}}finally{busy=false;}};
 void load();const timer=setInterval(()=>void load(),300000);const visible=()=>{if(!document.hidden)void load();};document.addEventListener('visibilitychange',visible);
 return()=>{live=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[]);
 return <AgentAttentionView data={data} errors={errors} onOpen={onOpen}/>;
}
export function AgentAttentionView({data,errors={},onOpen}:{data:AttentionData;errors?:Partial<Record<Source,boolean>>;onOpen?:(destination:AgentDestination)=>void}){
 const sources=[{key:'replies' as const,title:'Messages needing replies',label:'Open inbox',Icon:Mail,empty:'No replies flagged in the imported queue.'},{key:'insurance' as const,title:'Insurance issues',label:'Open Insurance',Icon:ClipboardList,empty:'No current issues flagged for active contractors.'},{key:'marketing' as const,title:'Marketing review',label:'Open Marketing',Icon:Megaphone,empty:'No campaigns awaiting review.'}];
 return <section className="agent-attention" aria-label="Across your agents"><header className="agent-attention-heading"><div><p>Across your agents</p><h2>What needs you next</h2></div><span>Updates every 5 min</span></header><div className="agent-attention-grid">{sources.map(({key,title,label,Icon,empty})=>{
 const summary=data[key],stale=Boolean(errors[key])||Boolean(summary&&Date.now()-Date.parse(summary.checkedAt)>10*60000);
 return <article className="agent-attention-card" key={key}><div className="agent-attention-title"><Icon size={22} aria-hidden="true"/><h3>{title}</h3></div><div className="agent-attention-count">{summary?`${summary.count}${key==='replies'&&summary.partial?'+':''}`:'—'}<span>{key==='insurance'?'active contractors flagged':key==='marketing'?'campaigns awaiting review':'messages flagged'}</span></div>
 {errors[key]&&<p className="agent-attention-warning" role="status">Could not refresh. {summary?'Saved results may be outdated.':'This queue is unavailable, not empty.'}</p>}
 {summary?<><p className={stale?'agent-attention-warning':'agent-attention-time'}>{stale?'Check freshness · ':''}Checked {new Date(summary.checkedAt).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} ET</p>{summary.items.length?<ul>{summary.items.map(i=><li key={i.id}><strong>{i.title}</strong><span>{i.detail}</span></li>)}</ul>:summary.count===0?<p>{empty}</p>:<p>Open the workspace to review the pending items.</p>}{summary.count>summary.items.length&&<p className="agent-attention-time">Showing {summary.items.length} of {summary.count}{summary.partial?' or more':''} flagged items.</p>}<details className="agent-attention-note"><summary>Details</summary><p>{summary.note}</p></details></>:<p>Checking the saved queue…</p>}
 {key==='replies'&&<div className="agent-attention-approvals"><strong>{data.approvals?.count??'—'} communication approvals</strong><p>{errors.approvals?'Approval queue could not refresh; any saved count may be outdated.':data.approvals?.note??'Checking reply drafts and calendar proposals…'}</p><Button label="Review drafts" size="sm" variant="secondary" clickAction={()=>onOpen?.('approvals')}/></div>}
 {key==='marketing'&&<div className="agent-attention-approvals"><strong>{data.media?.count??'—'}{data.media?.partial?'+':''} creative items ready</strong><p>{errors.media?'Media queue could not refresh; any saved count may be outdated.':data.media?.note??'Checking creative media…'}</p></div>}
 <Button label={label} size="sm" variant="secondary" clickAction={()=>onOpen?.(key)}/>
 </article>;})}</div></section>;
}
