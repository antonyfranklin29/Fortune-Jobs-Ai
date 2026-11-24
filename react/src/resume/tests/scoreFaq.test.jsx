import React from 'react';import {afterEach,expect,it} from 'vitest';import {cleanup,render,screen} from '@testing-library/react';import {readFileSync} from 'node:fs';import {URL as NodeURL} from 'node:url';
import {ResumeSearchPage} from '../ResumeSearchPage.jsx';import {ResumeServicesProvider,createResumeServices} from '../services.jsx';import content from '../score-content.json';
afterEach(cleanup);
it('renders the same five factual FAQ answers as the crawler block and FAQPage schema',()=>{
 render(<ResumeServicesProvider services={createResumeServices({storage:sessionStorage,search:()=>''})}><ResumeSearchPage/></ResumeServicesProvider>);
 expect(screen.getByRole('heading',{name:content.heading})).toBeTruthy();
 for(const {q,a} of content.faq){const heading=screen.getByRole('heading',{name:q});expect(heading.nextElementSibling.textContent).toBe(a);}
 const html=readFileSync(new NodeURL('../../../resume-search.html',import.meta.url),'utf8'),doc=new DOMParser().parseFromString(html,'text/html');
 const schema=[...doc.querySelectorAll('script[type="application/ld+json"]')].map(node=>JSON.parse(node.textContent)).find(item=>item['@type']==='FAQPage');
 const visible=[...doc.querySelectorAll('main.prerender h3')].map(node=>({q:node.textContent,a:node.nextElementSibling.textContent}));
 expect(visible).toEqual(content.faq);expect(schema.mainEntity.map(item=>({q:item.name,a:item.acceptedAnswer.text}))).toEqual(content.faq);
 expect(html).not.toContain('JobPosting');expect(content.faq[3].a).toContain('two hours');expect(content.faq[3].a).toContain('session storage');
});
