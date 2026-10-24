import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {FinanceStatus} from './FinanceStatus';
import {SupplierStatus} from './SupplierStatus';
describe('Finance workspace',()=>{
 it('starts with review tasks in a main workspace, not a chat disclosure',()=>{
  const html=renderToStaticMarkup(<FinanceStatus/>);
  expect(html).toContain('<main');
  expect(html).toContain('Automatic feed status');
  expect(html).toContain('Feeds refresh automatically while this page is closed');
  expect(html).toContain('aria-label="Finance Agent"');
  expect(html).toContain('aria-current="page">Needs your input');
  expect(html).toContain('Review tasks');
  expect(html).not.toContain('Connect / reconnect QuickBooks');
 });
 it('labels the evidence view separately from the task view',()=>{
  expect(renderToStaticMarkup(<SupplierStatus mode="evidence"/>)).toContain('Supplier invoices, credits &amp; payment evidence');
 });
});
