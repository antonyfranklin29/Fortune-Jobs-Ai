// SEO head tags for the public pages: title, description, canonical, Open Graph, Twitter card
// and structured data. Run by `npm run build` (before vite) so the source HTML stays the truth.
// Account pages keep their noindex tag and get nothing here.
const fs = require('node:fs');
const path = require('node:path');
const SITE = 'https://fortunejobsai.com';
const IMAGE = `${SITE}/og-image.jpg`;

const PAGES = {
  'index.html': { url: '/', title: 'Fortune Jobs AI: AI Job Search & Free ATS Resume Score',
    description: 'Free AI-powered job portal: search 20,000+ jobs from employer career sites and trusted job networks. Get a free ATS resume score, AI job matching and AI interview coaching.' },
  'find-jobs.html': { url: '/find-jobs.html', title: 'Find U.S. Jobs by Title and City | Fortune Jobs AI',
    description: 'Search U.S. jobs by title, city or state, including remote jobs. Each listing links to the original posting. Free job search with AI matching.' },
  'application-tracker.html': { url:'/application-tracker.html',title:'Free Job Application Tracker | Fortune Jobs AI',description:'Track saved jobs, applications, interviews and offers in your free Fortune Jobs AI account. Update stages and keep private notes.' },
  'resume-search.html': { url: '/resume-search.html', title: 'Free ATS Resume Score and Job Matches | Fortune Jobs AI',
    description: 'Upload your resume (PDF or DOCX) to get a free ATS readiness score, see missing keywords and find matching jobs. Your file stays in your browser.' },
  'resume-builder.html': { url: '/resume-builder.html', title: 'Free Resume Builder with ATS Score Checker | Fortune Jobs AI',
    description: 'Build an ATS-friendly resume for free. See your ATS readiness score as you type, check a job description’s keywords and download a clean PDF.' },
  'about.html': { url: '/about.html', title: 'About Fortune Jobs AI: Honest, AI-Powered Job Search',
    description: 'Fortune Jobs AI helps job seekers find real U.S. jobs, with free AI resume tools and clear, honest job matching. Every listing links to the original posting.' },
  'contact.html': { url: '/contact.html', title: 'Contact Fortune Jobs AI',
    description: 'Questions, feedback or employer partnerships? Contact the Fortune Jobs AI team at info@fortunejobsai.com.' },
  'privacy.html': { url: '/privacy.html', title: 'Privacy Policy | Fortune Jobs AI', description: 'How Fortune Jobs AI collects, uses and protects your information.' },
  'terms.html': { url: '/terms.html', title: 'Terms of Use and Refund Policy | Fortune Jobs AI', description: 'The terms for using Fortune Jobs AI, including Pro and Employer Plus subscriptions and refunds.' },
  // Search results change with every query: let Google follow the job links, not index the page itself.
  'results.html': { url: '/results.html', title: 'Job Search Results | Fortune Jobs AI', description: 'Job search results on Fortune Jobs AI.', noindex: true },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const ORG = { '@context': 'https://schema.org', '@graph': [
  { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'Fortune Jobs AI', url: `${SITE}/`, logo: `${SITE}/newsletter-logo.png`,
    email: 'info@fortunejobsai.com', description: 'Free AI-powered job portal for college students, new graduates and job seekers.',
    parentOrganization: { '@type': 'Organization', name: 'YOU DO LMS INC.' },
    sameAs: ['https://www.instagram.com/fortunejobs_ai/', 'https://www.facebook.com/profile.php?id=61596142272586', 'https://www.linkedin.com/company/fortunejobsai/', 'https://www.threads.com/@fortunejobs_ai'] },
  { '@type': 'WebSite', '@id': `${SITE}/#site`, name: 'Fortune Jobs AI', url: `${SITE}/`, publisher: { '@id': `${SITE}/#org` },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/results.html?mode=quick&q={search_term_string}` }, 'query-input': 'required name=search_term_string' } },
] };

// Free tools: describe them as software so Google can show them as apps.
const APP = {
  'resume-search.html': { name: 'Free ATS Resume Score', description: 'Upload a resume (PDF or DOCX) to get an ATS readiness score with line-by-line feedback and matching U.S. jobs.' },
  'resume-builder.html': { name: 'Free ATS Resume Builder', description: 'Build an ATS-friendly resume, see the ATS readiness score as you type and download a PDF.' },
};
const appSchema = (file, url) => ({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: APP[file].name,
  description: APP[file].description, url, applicationCategory: 'BusinessApplication', operatingSystem: 'Web',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, publisher: { '@type': 'Organization', name: 'Fortune Jobs AI', url: `${SITE}/` } });

// FAQ structured data mirrors the visible FAQ in the page's crawler-readable block (<h3> question, <p> answer).
const unhtml = (t) => t.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
function faqSchema(html) {
  const block = html.match(/<h2>Frequently asked questions<\/h2>([\s\S]*?)<\/main>/);
  if (!block) return null;
  const items = [...block[1].matchAll(/<h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p>/g)]
    .map(([, q, a]) => ({ '@type': 'Question', name: unhtml(q), acceptedAnswer: { '@type': 'Answer', text: unhtml(a) } }));
  return items.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items } : null;
}
const ABOUT = { '@context': 'https://schema.org', '@type': 'AboutPage', url: `${SITE}/about.html`, mainEntity: { '@id': `${SITE}/#org` } };

function head(file, p, html = '') {
  const url = SITE + p.url;
  const tags = [
    `<meta name="description" content="${esc(p.description)}">`,
    p.noindex ? '<meta name="robots" content="noindex,follow">' : `<link rel="canonical" href="${url}">`,
    '<meta property="og:type" content="website">', '<meta property="og:site_name" content="Fortune Jobs AI">',
    `<meta property="og:title" content="${esc(p.title)}">`, `<meta property="og:description" content="${esc(p.description)}">`,
    `<meta property="og:url" content="${url}">`, `<meta property="og:image" content="${IMAGE}">`,
    '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">', `<meta name="twitter:image" content="${IMAGE}">`,
    '<meta name="theme-color" content="#10243b">',
  ];
  if (file === 'index.html') tags.push(`<script type="application/ld+json">${JSON.stringify(ORG)}</script>`);
  const faq = faqSchema(html);
  if (faq) tags.push(`<script type="application/ld+json">${JSON.stringify(faq).replace(/</g, '\\u003c')}</script>`);
  if (file === 'about.html') tags.push(`<script type="application/ld+json">${JSON.stringify({ ...ABOUT, mainEntity: ORG['@graph'][0] })}</script>`);
  if (APP[file] && file !== 'resume-search.html') tags.push(`<script type="application/ld+json">${JSON.stringify(appSchema(file, url)).replace(/</g, '\\u003c')}</script>`);
  return `<!--seo-->${tags.join('')}<!--/seo-->`;
}

const root = path.resolve(__dirname, '..');
for (const [file, p] of Object.entries(PAGES)) {
  const f = path.join(root, file);
  let html = fs.readFileSync(f, 'utf8');
  if(file==='resume-search.html'){
    const score=JSON.parse(fs.readFileSync(path.join(root,'src/resume/score-content.json'),'utf8'));
    const block='<style>.prerender{visibility:hidden;animation:fja-prerender 0s 4s forwards}@keyframes fja-prerender{to{visibility:visible}}</style><main class="prerender" style="max-width:760px;margin:auto;padding:24px;font-family:Inter,Arial,sans-serif;color:#10243b"><h1>'+esc(score.heading)+'</h1><p>'+esc(score.answer)+'</p><h2>Frequently asked questions</h2>'+score.faq.map(({q,a})=>'<h3>'+esc(q)+'</h3><p>'+esc(a)+'</p>').join('')+'<p><a href="/privacy.html">Privacy Policy</a></p></main>';
    html=html.replace(/(<div id="root">)[\s\S]*?(<\/div>)/,'$1'+block+'$2');
  }
  html = html.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, '').replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>${head(file, p, html)}`);
  fs.writeFileSync(f, html);
}
for (const file of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
  const location = path.join(root, file);
  const html = fs.readFileSync(location, 'utf8');
  if (!html.includes('src="/source-tracking.js"')) fs.writeFileSync(location, html.replace('</head>', '<script defer src="/source-tracking.js"></script></head>'));
}
module.exports = { PAGES };
