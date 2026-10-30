import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {SupplierPdfLinks} from './SupplierPdfLinks';
it('links exact source versions through authenticated app routes, deduplicating shared PDF bundles',()=>{
 const s={sourceKey:'a'.repeat(64),contentHash:'b'.repeat(64),attachmentId:'private-provider-id'};
 const html=renderToStaticMarkup(<SupplierPdfLinks sources={[s,{...s,sourceKey:'c'.repeat(64)},{sourceKey:'d'.repeat(64),attachmentId:null}, {...s,sourceKey:'invalid'}]}/>);
 expect(html.match(/View PDF/g)).toHaveLength(1);expect(html).toContain('/api/finance/suppliers/pdf?source=');expect(html).toContain('download=1');expect(html).not.toContain('private-provider-id');expect(html).toContain('noopener noreferrer');
});
