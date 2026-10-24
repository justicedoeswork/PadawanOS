import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {FinanceStatus} from './FinanceStatus';
import {PlaidStatus,CashPlan,type Planning} from './PlaidStatus';
const plan:Planning={pendingCount:1,pendingInflows:'0.00',pendingOutflows:'100.00',projectedBalance:'900.00',reportedCurrent:'1000.00',reportedAvailable:'950.00',availableDifference:'50.00',kind:'projected_cash',evidenceAt:null,basis:'Current balance excludes listed pending movements.',warning:'Planning estimate, not guaranteed spendable cash.'};
describe('pending cash planning',()=>{
 it('separates balances and highlights unresolved available difference',()=>{const html=renderToStaticMarkup(<CashPlan plan={plan}/>);expect(html).toContain('Pending-adjusted ledger estimate: 900.00');expect(html).toContain('Available now (bank): 950.00');expect(html).toContain('not deducted from bank available');expect(html).toContain('not guaranteed spendable cash');});
 it('withholds uncertain projections and labels card debt',()=>{const html=renderToStaticMarkup(<CashPlan plan={{...plan,projectedBalance:null,kind:'projected_card_balance'}}/>);expect(html).toContain('Pending-adjusted card estimate: withheld');});
});

it('keeps bank activity separate from review tasks and discloses Amex privacy before data loads',()=>{
 const shell=renderToStaticMarkup(<FinanceStatus/>);expect(shell).toContain('Bank &amp; Amex');
 const html=renderToStaticMarkup(<PlaidStatus/>);expect(html).toContain('Free-trial connections');expect(html).toContain('Amex stays out of QuickBooks');expect(html).toContain('Import available updates');expect(html).not.toContain('Connect QuickBooks');
});
