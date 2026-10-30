import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {FinanceStatus} from './FinanceStatus';
import {SupplierStatus} from './SupplierStatus';
describe('Finance workspace',()=>{
 it('starts with the visual dashboard and keeps review tasks accessible',()=>{
  const html=renderToStaticMarkup(<FinanceStatus/>);
  expect(html).toContain('<main');
  expect(html).toContain('Automatic feed status');
  expect(html).not.toContain('Feeds refresh automatically while this page is closed');
  expect(html).toContain('aria-label="Finance Agent"');
  expect(html).toContain('aria-current="page">Dashboard');
  expect(html).toContain('Finance dashboard');
  expect(html).toContain('Needs your input');
  expect(html.indexOf('aria-label="Finance actions"')).toBeLessThan(html.indexOf('aria-label="Finance dashboard"'));
  expect(html).toContain('Invoice assignments');
  expect(html).toContain('Deposit matches');
  expect(html).toContain('Awaiting evidence');
  expect(html).not.toContain('Connect / reconnect QuickBooks');
 });
 it('labels the evidence view separately from the task view',()=>{
  expect(renderToStaticMarkup(<SupplierStatus mode="evidence"/>)).toContain('Supplier evidence');
 });
});
