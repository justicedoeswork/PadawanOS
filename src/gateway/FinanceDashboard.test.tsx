import {renderToStaticMarkup} from 'react-dom/server';import {describe,it,expect} from 'vitest';
import {FinanceDashboardView,BarChart,businessTotal,costScenario,numeric,type DashboardAccount} from './FinanceDashboard';
const account=(role:string,value='1000',currency='USD'):DashboardAccount=>({id:role,name:role,mask:'0000',role,present:true,currency,stale:false,error:null,lastImport:null,providerUpdated:null,planning:{reportedAvailable:value,reportedCurrent:'900',projectedBalance:'800',pendingCount:1,pendingInflows:'0',pendingOutflows:'100',basis:'Synthetic pending scenario'}});
describe('financial dashboard',()=>{
 it('totals only confirmed business accounts, without reserve deductions or personal/card debt',()=>{
 const accounts=['receivables','bill_pay','incidentals','job_savings','personal','rental','amex'].map(r=>account(r));expect(businessTotal(accounts,'reportedAvailable')).toBe(4000);expect(businessTotal(accounts,'projectedBalance')).toBe(3200);
 expect(businessTotal(accounts.slice(1),'reportedAvailable')).toBeNull();expect(businessTotal([...accounts,account('receivables')],'reportedAvailable')).toBeNull();
 expect(businessTotal(accounts.map(a=>a.role==='bill_pay'?{...a,currency:'CAD'}:a),'reportedAvailable')).toBeNull();expect(businessTotal(accounts.map(a=>({...a,planning:{...a.planning,projectedBalance:null}})),'projectedBalance')).toBeNull();
 });
 it('preserves real zero, withholds absent numbers and supports negative profit scenarios',()=>{
 expect(numeric(null)).toBeNull();expect(numeric('')).toBeNull();expect(numeric('invalid')).toBeNull();expect(numeric(0)).toBe(0);expect(costScenario('1000','900',30)).toBe(-170);expect(costScenario('1000',null,10)).toBeNull();
 const html=renderToStaticMarkup(<BarChart labels={['Profit']} rows={[{label:'Loss',a:-100},{label:'Unknown',a:null},{label:'Zero',a:0}]}/>);expect(html).toContain('-$100.00');expect(html).toContain('Not available');expect(html).toContain('fd-negative');expect(html).toContain('$0.00');
 });
 it('renders unavailable sections without invented totals and exposes account separation and limitations',()=>{
 const html=renderToStaticMarkup(<FinanceDashboardView data={{}} errors={{bank:'Bank data failed'}} onNavigate={()=>{}}/>);expect(html).toContain('Not available');expect(html).not.toContain('$0.00');expect(html).toContain('Bank data failed');expect(html).toContain('Amex purchases stay outside QuickBooks');expect(html).toContain('safe owner draws');
 });
});
