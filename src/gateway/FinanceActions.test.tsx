import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {FinanceActions} from './FinanceActions';
it('keeps unknown counts unknown, separates evidence from owner questions, and warns about stale actions',()=>{
 const empty=renderToStaticMarkup(<FinanceActions/>);expect(empty).toContain('Checking…');expect(empty).toContain('>—</strong>');expect(empty).not.toContain('All reviewed');
 const html=renderToStaticMarkup(<FinanceActions reconciliation={{status:'stale',lastSuccess:'2026-10-30T12:00:00Z',summary:{depositQuestions:2,supplierQuestions:4,unlinked:65}}}/>);
 expect(html).toContain('>2</strong>');expect(html).toContain('>4</strong>');expect(html).toContain('>65</strong>');expect(html).toContain('Awaiting evidence');expect(html).toContain('Actions may be outdated');expect(html).toContain('aria-controls="finance-invoice-actions"');
});
it('the review destination expands both existing review controls at the top',()=>{
 const html=renderToStaticMarkup(<FinanceActions expanded/>);expect(html).toContain('id="finance-deposit-actions"><section');expect(html).toContain('id="finance-invoice-actions"><section');
});
