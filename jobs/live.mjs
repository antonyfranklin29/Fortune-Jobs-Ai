import {
  MIN_CITY_JOBS, MIN_STATE_JOBS, DISPLAY_LIMIT, applicationUrl, getAreaListings, getEmployerPostings, jobPosting, postingPath,
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

async function refreshArea() {
  const { city, state, role } = panel.dataset;
  const list = panel.querySelector('ul');
  const status = panel.querySelector('[role="status"]');
  const detailIds = new Set(panel.dataset.detailIds.split(',').filter(Boolean));
  try {
    const rows = await getAreaListings(window.FJ_CONFIG, { city, state, role });
    if (rows.length < (city ? MIN_CITY_JOBS : MIN_STATE_JOBS)) noindex();
    const visible = rows.slice(0, DISPLAY_LIMIT);
    list.replaceChildren(...visible.map(job => {
      const item = document.createElement('li');
      const title = textElement('h2', job.job_title);
      const meta = textElement('p', job.company + ' · ' + job.location);
      const link = detailIds.has(String(job.id))
        ? applyLink(job, postingPath(job.id), 'View job details')
        : applyLink(job);
      item.append(title, meta);
      if (job.posted_at) item.append(textElement('p', 'Posted ' + job.posted_at.slice(0, 10)));
      item.append(link);
      if (job.source === 'adzuna') item.append(' ', textElement('small', 'Job source: Adzuna'));
      return item;
    }));
    status.textContent = rows.length
      ? 'Showing ' + visible.length + ' of ' + rows.length + ' open listings.'
      : 'No open listings match this area and role. Try a broader search.';
  } catch {
    status.append(' Live availability could not be checked.');
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

if (['area', 'city'].includes(panel?.dataset.jobPage)) refreshArea();
if (panel?.dataset.jobPage === 'posting') refreshPosting();
