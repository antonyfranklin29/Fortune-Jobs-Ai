import {
  MIN_CITY_JOBS, applicationUrl, getCityListings, getEmployerPostings, jobPosting, postingPath,
} from './catalogue.mjs';

const panel = document.querySelector('[data-job-page]');

function noindex() {
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement('meta');
    robots.name = 'robots';
    document.head.append(robots);
  }
  robots.content = 'noindex,follow';
}

function textElement(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function applyLink(job, href = applicationUrl(job.apply_url), text = 'View original listing') {
  const link = textElement('a', text);
  link.href = href;
  link.rel = 'noopener noreferrer';
  return link;
}

async function refreshCity() {
  const { city, state, role } = panel.dataset;
  const list = panel.querySelector('ul');
  const status = panel.querySelector('[role="status"]');
  const detailIds = new Set(panel.dataset.detailIds.split(',').filter(Boolean));
  try {
    const rows = await getCityListings(window.FJ_CONFIG, { city, state, role });
    if (rows.length < MIN_CITY_JOBS) noindex();
    list.replaceChildren(...rows.map(job => {
      const item = document.createElement('li');
      const title = textElement('h2', job.job_title);
      const meta = textElement('p', job.company + ' · ' + job.location);
      const date = textElement('p', 'Posted ' + job.posted_at.slice(0, 10));
      const link = detailIds.has(String(job.id))
        ? applyLink(job, postingPath(job.id), 'View job details')
        : applyLink(job);
      item.append(title, meta, date, link);
      if (job.source === 'adzuna') item.append(' ', textElement('small', 'Job source: Adzuna'));
      return item;
    }));
    status.textContent = rows.length
      ? 'Showing ' + rows.length + ' recent ' + (rows.length === 1 ? 'listing.' : 'listings.')
      : 'No current listings match this city and role. Try a broader search.';
  } catch {
    noindex();
    list.replaceChildren();
    status.textContent = 'Could not verify current listings. Try the main job search.';
  }
}

async function refreshPosting() {
  const status = panel.querySelector('[role="status"]');
  try {
    const [job] = await getEmployerPostings(window.FJ_CONFIG, panel.dataset.id);
    const schema = jobPosting(job);
    if (!schema) {
      noindex();
      status.textContent = 'This listing is unavailable.';
      return;
    }
    const title = textElement('h1', schema.title);
    const info = textElement('p', job.company + ' · ' + job.location);
    const dates = textElement('p', 'Posted ' + schema.datePosted.slice(0, 10) +
      ' · Closes ' + schema.validThrough.slice(0, 10));
    const description = textElement('div', schema.description);
    description.className = 'description';
    panel.replaceChildren(title, info, dates, description, applyLink(job, applicationUrl(job.apply_url), 'Apply on employer site'));
    const markup = document.createElement('script');
    markup.type = 'application/ld+json';
    markup.textContent = JSON.stringify(schema);
    document.head.append(markup);
  } catch {
    noindex();
    status.textContent = 'Could not verify this listing. Try the main job search.';
  }
}

if (panel?.dataset.jobPage === 'city') refreshCity();
if (panel?.dataset.jobPage === 'posting') refreshPosting();
