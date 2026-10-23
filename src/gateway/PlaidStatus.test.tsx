import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {PlaidStatus} from './PlaidStatus';
import {FinanceStatus} from './FinanceStatus';
it('keeps bank activity separate from review tasks and discloses Amex privacy before data loads',()=>{
 const shell=renderToStaticMarkup(<FinanceStatus/>);expect(shell).toContain('Bank &amp; Amex');
 const html=renderToStaticMarkup(<PlaidStatus/>);expect(html).toContain('Free-trial connections');expect(html).toContain('Amex stays out of QuickBooks');expect(html).toContain('Import available updates');expect(html).not.toContain('Connect QuickBooks');
});
