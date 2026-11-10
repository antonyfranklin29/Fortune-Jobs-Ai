// SEO head tags for the public pages: title, description, canonical, Open Graph, Twitter card
// and structured data. Run by `npm run build` (before vite) so the source HTML stays the truth.
// Account pages keep their noindex tag and get nothing here.
const fs = require('node:fs');
const path = require('node:path');
const SITE = 'https://fortunejobsai.com';
const IMAGE = `${SITE}/og-image.jpg`;

const PAGES = {
  'index.html': { url: '/', title: 'Fortune Jobs AI: AI Job Search, Free ATS Résumé Score & Direct Employer Jobs',
    description: 'Search thousands of U.S. jobs straight from employer career sites. Get a free ATS résumé score, AI job matching and AI interview coaching. Free to use.' },
  'find-jobs.html': { url: '/find-jobs.html', title: 'Find Jobs Near You: Search U.S. Jobs by Title and City | Fortune Jobs AI',
    description: 'Search U.S. jobs by title, city or state, including remote jobs. Apply directly on the employer’s own careers page. Free job search with AI matching.' },
  'resume-search.html': { url: '/resume-search.html', title: 'Upload Your Résumé: Free ATS Score and Job Matches | Fortune Jobs AI',
    description: 'Upload your résumé (PDF or DOCX) to get a free ATS readiness score, see missing keywords and find matching jobs. Your file stays in your browser.' },
  'resume-builder.html': { url: '/resume-builder.html', title: 'Free Résumé Builder with ATS Score Checker | Fortune Jobs AI',
    description: 'Build an ATS-friendly résumé for free. See your ATS readiness score as you type, check a job description’s keywords and download a clean PDF.' },
  'about.html': { url: '/about.html', title: 'About Fortune Jobs AI: Honest, AI-Powered Job Search',
    description: 'Fortune Jobs AI helps job seekers find real U.S. jobs straight from employers, with free AI résumé tools and clear, honest job matching.' },
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
    email: 'info@fortunejobsai.com', sameAs: ['https://www.instagram.com/fortunejobsai/'] },
  { '@type': 'WebSite', '@id': `${SITE}/#site`, name: 'Fortune Jobs AI', url: `${SITE}/`, publisher: { '@id': `${SITE}/#org` },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/results.html?mode=quick&q={search_term_string}` }, 'query-input': 'required name=search_term_string' } },
] };

function head(file, p) {
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
  return `<!--seo-->${tags.join('')}<!--/seo-->`;
}

const root = path.resolve(__dirname, '..');
for (const [file, p] of Object.entries(PAGES)) {
  const f = path.join(root, file);
  let html = fs.readFileSync(f, 'utf8');
  html = html.replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, '').replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>${head(file, p)}`);
  fs.writeFileSync(f, html);
}
module.exports = { PAGES };
