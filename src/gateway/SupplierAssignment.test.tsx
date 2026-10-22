import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {SupplierAssignment} from './SupplierAssignment';
it('requires an explicit assignment interaction before showing or saving a job selection',()=>{
 const html=renderToStaticMarkup(<SupplierAssignment documentKey={'a'.repeat(64)} reviewVersion="0" onSaved={()=>{throw Error('must not save during render');}}/>);
 expect(html).toContain('Assign to job');expect(html).not.toContain('Save assignment');
});
