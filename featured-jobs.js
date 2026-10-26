(function (root) {
  'use strict';

  const DAY = 86400000;
  const SIZE = 10;

  function cleanDescription(value) {
    return String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(?:nbsp|amp|quot|lt|gt|#39);/gi, entity => ({
        '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#39;': "'"
      })[entity.toLowerCase()] || entity)
      .replace(/\s+/g, ' ').trim();
  }

  function shorten(value, max) {
    const text = cleanDescription(value);
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  }

  function selectJobs(adzunaRows, otherRows, now, safeUrl) {
    const cutoff = now - 30 * DAY;
    const seen = new Set();
    const valid = rows => rows.filter(row => row && row.job_title && row.company &&
      safeUrl(row.apply_url) && Number.isFinite(Date.parse(row.posted_at)) &&
      Date.parse(row.posted_at) >= cutoff && Date.parse(row.posted_at) <= now + DAY);
    const eligibleAdzuna = valid(adzunaRows);
    const adzuna = eligibleAdzuna.filter(row => cleanDescription(row.job_description));
    const other = valid(otherRows);
    const selected = [];
    const overflow = [];
    const companyCounts = new Map();
    function take(pool, allowRepeatCompany = false) {
      while (pool.length) {
        const row = pool.shift();
        const key = `${row.job_title.trim().toLowerCase()}|${row.company.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        const company = row.company.trim().toLowerCase();
        if (!allowRepeatCompany && (companyCounts.get(company) || 0) >= 2) { overflow.push(row); continue; }
        seen.add(key);
        companyCounts.set(company, (companyCounts.get(company) || 0) + 1);
        selected.push(row);
        break;
      }
    }
    // Favor listings with a real saved description while retaining other sources.
    for (let i = 0; i < SIZE; i++) take(i % 3 === 1 ? other : adzuna);
    while (selected.length < SIZE && (adzuna.length || other.length || eligibleAdzuna.length))
      take(adzuna.length ? adzuna : other.length ? other : eligibleAdzuna);
    while (selected.length < SIZE && overflow.length) take(overflow, true);
    return selected;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { cleanDescription, selectJobs };
  if (typeof document === 'undefined') return;
  const list = document.getElementById('featuredJobs');
  const detail = document.getElementById('featuredDetail');
  const count = document.getElementById('featuredCount');
  const config = root.FJ_CONFIG;
  const safety = root.FJDataSafety;
  if (!list || !detail || !count || !config || !safety) return;

  const cutoff = new Date(Date.now() - 30 * DAY).toISOString();
  const fields = 'job_title,company,location,job_description,apply_url,source,posted_at,salary,employment_type,work_mode,is_remote';
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}` };
  async function recent(sourceFilter) {
    const params = new URLSearchParams({
      select: fields, closed_at: 'is.null', posted_at: `gte.${cutoff}`,
      source: sourceFilter, order: 'posted_at.desc.nullslast', limit: '70'
    });
    const response = await fetch(`${config.url}/rest/v1/pre_scraped_jobs?${params}`, { headers });
    if (!response.ok) throw new Error('Catalogue unavailable');
    return response.json();
  }

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function sourceCredit(row) {
    if (row.source !== 'adzuna') {
      const labels = { indeed: 'Indeed', dice: 'Dice', employer_direct: 'Employer', employer_feed: 'Employer career feed' };
      return el('span', 'featured-source', `Source: ${labels[row.source] || row.source || 'original listing'}`);
    }
    const holder = document.createElement('div');
    holder.innerHTML = safety.adzunaAttribution(row);
    return holder.firstElementChild || el('span', 'featured-source', 'Source: Adzuna');
  }

  function age(row) {
    const days = Math.max(0, Math.floor((Date.now() - Date.parse(row.posted_at)) / DAY));
    return days === 0 ? 'Posted today' : `Posted ${days} day${days === 1 ? '' : 's'} ago`;
  }

  function meta(row) {
    const parts = [row.location || 'Location on original listing'];
    if (row.work_mode) parts.push(row.work_mode.replace(/_/g, ' '));
    else if (row.is_remote) parts.push('Remote');
    if (row.employment_type) parts.push(row.employment_type.replace(/_/g, ' '));
    if (row.salary) parts.push(String(row.salary));
    return parts.join(' · ');
  }

  function fit(row) {
    if (!root.FJResume || !root.FJGuestResume || new URLSearchParams(location.search).get('resume') === '0') return null;
    let profile = null;
    try {
      const params = new URLSearchParams(location.search);
      profile = root.FJGuestResume.load(sessionStorage, Date.now(), params.get('resume') === '1' ? params.get('resume_id') || '' : null);
    } catch {}
    return profile ? root.FJResume.assess(row, profile) : null;
  }

  function renderDetail(row) {
    detail.replaceChildren();
    const heading = el('div', 'featured-detail-heading');
    heading.append(root.FJCompanyLogos.element(row));
    const headingText = el('div', 'featured-detail-heading-text');
    headingText.append(el('h3', '', row.job_title));
    headingText.append(el('p', 'featured-company', row.company));
    heading.append(headingText);
    detail.append(heading);
    detail.append(el('p', 'featured-meta', `${meta(row)} · ${age(row)}`));
    const assessment = fit(row);
    if (assessment) {
      detail.append(el('p', 'featured-fit', `Estimated job fit: ${assessment.score}/100`));
      detail.append(el('p', 'featured-fit-note', assessment.missing.length ? `To improve: show a real example using ${assessment.missing[0]}, if you have that experience.` : 'To improve: show measurable results from the matching skills you have.'));
    }
    const facts = el('div', 'featured-facts');
    facts.append(el('h4', '', 'At a glance'));
    const factList = document.createElement('ul');
    const items = [row.location || 'Location on original listing', age(row)];
    if (row.work_mode || row.is_remote) items.push(row.work_mode ? row.work_mode.replace(/_/g, ' ') : 'Remote');
    if (row.employment_type) items.push(row.employment_type.replace(/_/g, ' '));
    if (row.salary) items.push(`Pay: ${row.salary}`);
    items.slice(0, 4).forEach(item => factList.append(el('li', '', item)));
    facts.append(factList);
    detail.append(facts);
    const overview = el('div', 'featured-overview');
    overview.append(el('h4', '', 'About this role'));
    const description = cleanDescription(row.job_description);
    overview.append(el('p', '', description || 'The full description is available on the original job posting.'));
    detail.append(overview);
    const actions = el('div', 'featured-actions');
    const apply = el('a', 'featured-apply', 'View original job ↗');
    apply.href = safety.httpUrl(row.apply_url);
    apply.target = '_blank';
    apply.rel = 'noopener noreferrer';
    actions.append(apply);
    const similar = el('a', 'featured-similar', 'Search similar jobs →');
    const similarParams = new URLSearchParams({ mode: 'quick', q: row.job_title });
    const resumeParams = new URLSearchParams(location.search);
    if (resumeParams.get('resume') === '0') similarParams.set('resume', '0');
    else {
      try {
        const profile = root.FJGuestResume?.load(sessionStorage, Date.now(), resumeParams.get('resume') === '1' ? resumeParams.get('resume_id') || '' : null);
        if (profile) { similarParams.set('resume', '1'); similarParams.set('resume_id', profile.match_id); }
      } catch {}
    }
    similar.href = `results.html?${similarParams}`;
    actions.append(similar);
    detail.append(actions);
    detail.append(el('p', 'featured-detail-note', 'Check requirements and availability on the original listing.'));
    detail.append(sourceCredit(row));
  }

  function renderList(rows) {
    list.replaceChildren();
    count.textContent = `${rows.length} recent job listings · Select one to preview its details`;
    rows.forEach((row, index) => {
      const wrapper = el('div', 'featured-card');
      const button = el('button', 'featured-card-select');
      button.type = 'button';
      button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
      button.setAttribute('aria-label', `View ${row.job_title} at ${row.company}`);
      button.append(root.FJCompanyLogos.element(row));
      const content = el('span', 'featured-card-content');
      content.append(el('h3', '', row.job_title));
      content.append(el('p', 'featured-company', row.company));
      content.append(el('p', 'featured-location', meta(row)));
      content.append(el('p', 'featured-snippet', shorten(row.job_description, 115) || 'Read the full description on the original listing.'));
      const assessment = fit(row);
      if (assessment) content.append(el('strong', 'featured-fit', `Job fit ${assessment.score}/100`));
      content.append(el('span', 'featured-source', age(row)));
      button.append(content);
      button.addEventListener('click', () => {
        list.querySelectorAll('.featured-card-select').forEach(item => item.setAttribute('aria-pressed', 'false'));
        button.setAttribute('aria-pressed', 'true');
        renderDetail(row);
        if (window.matchMedia('(max-width: 768px)').matches) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      wrapper.append(button);
      wrapper.append(sourceCredit(row));
      list.append(wrapper);
    });
    renderDetail(rows[0]);
  }

  Promise.allSettled([recent('eq.adzuna'), recent('neq.adzuna')]).then(results => {
    const adzuna = results[0].status === 'fulfilled' ? results[0].value : [];
    const other = results[1].status === 'fulfilled' ? results[1].value : [];
    const rows = selectJobs(adzuna, other, Date.now(), safety.httpUrl);
    if (rows.length) renderList(rows);
    else {
      list.replaceChildren(el('p', 'featured-status', 'Recent job previews are unavailable right now. Use the search above to explore the catalogue.'));
      detail.replaceChildren(el('p', 'featured-status', 'No job selected.'));
      count.textContent = 'Browse the saved job catalogue with the search above.';
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
