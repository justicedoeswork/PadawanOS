export type PdfSource={sourceKey:string;contentHash?:string;attachmentId?:string|null};
export function SupplierPdfLinks({sources}:{sources:PdfSource[]}){
 const seen=new Set<string>();const pdfs=sources.filter(s=>{if(!s.attachmentId||!/^[a-f0-9]{64}$/.test(s.sourceKey)||!s.contentHash||!/^[a-f0-9]{64}$/.test(s.contentHash)||seen.has(s.contentHash))return false;seen.add(s.contentHash);return true;});
 return pdfs.length?<div className="supplier-pdf-links">{pdfs.map((s,i)=>{const url='/api/finance/suppliers/pdf?'+new URLSearchParams({source:s.sourceKey,hash:s.contentHash!});return <div key={s.contentHash}><a className="supplier-pdf-open" href={url} target="_blank" rel="noopener noreferrer">View PDF{pdfs.length>1?' '+(i+1):''} ↗</a><a href={url+'&download=1'} aria-label={'Download PDF '+(i+1)}>Download</a></div>;})}</div>:null;
}
