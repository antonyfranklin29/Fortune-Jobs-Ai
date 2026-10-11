export async function pdfToText(file) {
  const lib=await import('./vendor/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',import.meta.url).href;
  const task=lib.getDocument({data:await file.arrayBuffer(),isEvalSupported:false,standardFontDataUrl:new URL("./vendor/standard_fonts/",import.meta.url).href,cMapUrl:new URL("./vendor/cmaps/",import.meta.url).href,cMapPacked:true});
  let pdf;
  try {
    pdf=await task.promise;
    if(pdf.numPages>30)throw new Error('Please use a resume with 30 pages or fewer.');
    let text='';
    for(let i=1;i<=pdf.numPages;i++){
      const content=await (await pdf.getPage(i)).getTextContent();
      for(const item of content.items)text+=item.str+(item.hasEOL?'\n':' ');
      text+='\n';
      if(text.length>60000)throw new Error('Please shorten your resume to under 60,000 characters.');
    }
    return text.trim();
  }finally{await task.destroy();}
}
