// Keep the dedicated search pages in sync with the shared search implementation.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
let home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pageStyle = `<style>
nav .find-jobs-link{color:var(--gold);font-weight:700;}
@media(max-width:768px){nav{flex-wrap:wrap;height:auto;min-height:80px;gap:12px;padding:16px 20px}.nav-links{display:flex;gap:18px;order:3;width:100%;justify-content:center}}
body[data-page="results"] .hero{display:none}
body[data-page="results"] .results-section{display:block;min-height:60vh;padding-top:40px}
body[data-page="results"] .polling-bar{position:static}
body[data-page="results"] .results-back{display:inline-block;color:var(--gold);margin-bottom:24px}
body[data-page="find"] .hero{min-height:65vh}
</style>`;
if (!home.includes('nav .find-jobs-link')) home = home.replace('</head>', pageStyle + '\n</head>');
home = home.replace(/<li><a href="#">How It Works<\/a><\/li>/g, '')
  .replace(/<a href="#">About Us<\/a>/g, '<a href="about.html">About Us</a>')
  .replace(/<a href="#">Find Jobs<\/a>/g, '<a href="find-jobs.html">Find Jobs</a>');
fs.writeFileSync(path.join(root, 'index.html'), home);
let search = home
  .replace(/<section class="(?:how-it-works|categories|why-us|testimonials|cta-section)">[\s\S]*?<\/section>/g, '')
  .replace(/<!-- STATS -->[\s\S]*?(?=<!-- HOW IT WORKS -->)/, '')
  .replace('Find Your <span>Dream Job</span><br>with AI', 'Find Your <span>Next Job</span>');
// Remove the complete stats block using its section boundary.
search = search.replace(/<!-- STATS -->[\s\S]*?(?=<!-- HOW IT WORKS -->)/, '');
fs.writeFileSync(path.join(root, 'find-jobs.html'), search.replace('<body>', '<body data-page="find">').replace(/<title>.*?<\/title>/, '<title>Find Jobs — Fortune Jobs AI</title>'));
let results = search.replace('<body>', '<body data-page="results">')
  .replace(/<title>.*?<\/title>/, '<title>Job Results — Fortune Jobs AI</title>')
  .replace('<section class="results-section" id="resultsSection">', '<section class="results-section" id="resultsSection"><a class="results-back" href="find-jobs.html">← Search again</a>')
  .replace('Your Best Matched Jobs', 'Your Job Results')
  .replace('Relevant opportunities selected for your search', 'Searching for matching jobs…')
  .replace(/<footer>[\s\S]*?<\/footer>/, '<footer><p>© 2026 Fortune Jobs AI. All rights reserved. · <a href="privacy.html">Privacy</a> · <a href="contact.html">Contact</a></p></footer>')
  .replaceAll("scrollIntoView({ behavior: 'smooth', block: 'start' })", "scrollIntoView({ behavior: 'instant', block: 'start' })");
fs.writeFileSync(path.join(root, 'results.html'), results);
const head = home.slice(0, home.indexOf('<body>')).replace(/<title>.*?<\/title>/, '<title>About — Fortune Jobs AI</title>');
const nav = home.match(/<nav>[\s\S]*?<\/nav>/)[0];
const about = `<body><style>main.hero h2{color:var(--white)}</style>${nav}<main class="hero" style="max-width:960px;margin:auto;text-align:left;min-height:65vh">
<div class="hero-badge">ABOUT FORTUNE JOBS AI</div>
<h1>Your next opportunity,<br><span>within reach.</span></h1>
<p class="hero-sub-text" style="margin-left:0">Fortune Jobs AI helps job seekers discover opportunities that fit their interests, skills and career goals.</p>
<h2 style="margin:36px 0 16px">A clearer way to search</h2>
<p style="line-height:1.9;color:var(--gray-400)">Explore saved opportunities with Quick Match or look for fresh listings with Live Search. Choose a job title, location and the filters that matter to you, then review your matches on a dedicated results page.</p>
<h2 style="margin:32px 0 16px">Built around your next step</h2>
<p style="line-height:1.9;color:var(--gray-400)">Compare roles, see why they may fit your search, and follow application links to take the next step. Create an account to save opportunities and keep your job search organized.</p>
<p style="line-height:1.9;color:var(--gray-400);margin-top:24px">Our aim is to make discovering relevant work simpler and more focused, whether you are starting your career or exploring a new direction.</p>
<a href="find-jobs.html" class="upsell-btn" style="margin-top:32px">Find Jobs →</a>
</main><footer><p>© 2026 Fortune Jobs AI. All rights reserved. · <a href="privacy.html">Privacy</a> · <a href="contact.html">Contact</a></p></footer></body></html>`;
fs.writeFileSync(path.join(root, 'about.html'), head + about);
