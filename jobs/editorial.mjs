// Selected from the query examples supplied by the owner, plus their useful hubs.
// This is a priority list, not a claim to have accessed the private GSC property.
export const PRIORITY_PAGES=new Set([
 '/jobs/business-analyst/new-york-ny/','/jobs/business-analyst/new-york/',
 '/jobs/qa-engineer/washington-dc/','/jobs/qa-engineer/',
 '/jobs/data-analyst/raleigh-nc/','/jobs/data-analyst/washington-dc/','/jobs/data-analyst/north-carolina/',
 '/jobs/remote/','/jobs/remote/software-engineer/','/jobs/entry-level/','/jobs/entry-level/data-analyst/',
 '/salaries/','/salaries/data-analyst/','/salaries/software-engineer/','/salaries/data-analyst/texas/',
]);
const NEARBY={
 'new-york-ny':['jersey-city-nj','newark-nj'], 'raleigh-nc':['charlotte-nc'],
 'washington-dc':['arlington-va'], 'arlington-va':['washington-dc'],
};
const RELATED={
 'business-analyst':['data-analyst','business-intelligence-developer','product-manager'],
 'data-analyst':['business-analyst','data-scientist','business-intelligence-developer'],
 'qa-engineer':['software-engineer','security-engineer','it-support'],
 'software-engineer':['full-stack-developer','frontend-developer','backend-developer'],
};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=slug=>slug.split('-').map(word=>word==='qa'?'QA':word==='it'?'IT':word[0].toUpperCase()+word.slice(1)).join(' ');
export function editorialLinks(path,role,paths){
 const tail=path.split('/').filter(Boolean).at(-1);
 const rolePaths=(RELATED[role]||[]).flatMap(id=>{
  const same='/jobs/'+id+'/'+tail+'/';const national='/jobs/'+id+'/';
  return paths.has(same)?[[same,label(id)+' jobs in this area']]:paths.has(national)?[[national,label(id)+' jobs nationwide']]:[];
 });
 const nearby=(NEARBY[tail]||[]).map(city=>['/jobs/'+role+'/'+city+'/',label(city)]).filter(([url])=>paths.has(url));
 return [...rolePaths,...nearby];
}
export function editorialSection(path,rows,role,paths){
 if(!PRIORITY_PAGES.has(path))return '';
 const own=rows.filter(row=>row.company && !/^jobg8\b/i.test(row.company));
 const companies=new Set(own.map(row=>row.company.trim().toLowerCase()));
 const states=new Set(own.map(row=>row.state_code).filter(Boolean));
 const terms=[['SQL',/\bsql\b/i],['Python',/\bpython\b/i],['Excel',/\bexcel\b/i],['Tableau',/\btableau\b/i],['Power BI',/\bpower\s*bi\b/i],['JavaScript',/\bjavascript\b/i],['testing',/\btesting\b/i],['AWS',/\baws\b/i]];
 const counts=terms.map(([name,re])=>[name,own.filter(job=>re.test([job.job_title,job.job_description].join(' '))).length]).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,3);
 const snapshot=own.length?`${own.length.toLocaleString('en-US')} listings from ${companies.size.toLocaleString('en-US')} distinct advertised company names${states.size>1?' across '+states.size+' states':''} are represented in this snapshot. Company names are counted as listed, not as a verified ownership group.`:'This directory links to qualifying slices of the current catalogue. Each linked page states its own sample and scope.';
 const guidance=path.startsWith('/salaries/')?'Compare the pay unit and sample size before comparing locations. These are advertised amounts from current postings; they do not measure accepted offers, total compensation or the whole labor market.':path.includes('/entry-level/')?'A junior or graduate title is a starting point. Read the original requirements and highlight only relevant coursework, projects and experience you can verify. Internship listings are labelled separately.':path.includes('/remote/')?'Check location restrictions and work hours in the original posting. Remote is a catalogue work-mode flag; it does not mean you can work from every state or country.':'Compare the actual responsibilities before broadening your search to a related role. Similar job titles can require different tools, experience and work authorization. This job portal does not guarantee eligibility or availability.';
 const links=editorialLinks(path,role,paths);
 return '<section class="market"><h2>How to use this search</h2><p>'+escape(snapshot)+'</p>'+(counts.length?'<p>Explicit mentions in this page’s available listing text: '+counts.map(([name,n])=>escape(name)+' ('+n+')').join(', ')+'. These are text mentions, not a complete skill survey.</p>':'')+'<p>'+escape(guidance)+'</p>'+(links.length?'<h3>Related roles and other cities in the region</h3><ul>'+links.map(([url,name])=>'<li><a href="'+escape(url)+'">'+escape(name)+'</a></li>').join('')+'</ul>':'')+'</section>';
}
