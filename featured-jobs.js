(function () {
  'use strict';
  const mount = document.getElementById('featuredJobs');
  const config = window.FJ_CONFIG;
  if (!mount || !config || !window.FJDataSafety) return;

  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const fields = 'job_title,company,location,job_description,apply_url,source,posted_at';
  const base = `${config.url}/rest/v1/pre_scraped_jobs`;
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}` };

  async function recent(sourceFilter, limit) {
    const params = new URLSearchParams({
      select: fields,
      closed_at: 'is.null',
      posted_at: `gte.${cutoff}`,
      source: sourceFilter,
      order: 'posted_at.desc.nullslast',
      limit: String(limit)
    });
    const response = await fetch(`${base}?${params}`, { headers });
    if (!response.ok) throw new Error('Catalogue unavailable');
    return response.json();
  }

  function usable(row) {
    return row && row.job_title && row.company &&
      window.FJDataSafety.httpUrl(row.apply_url) &&
      Number.isFinite(Date.parse(row.posted_at)) && Date.parse(row.posted_at) >= Date.parse(cutoff);
  }

  function description(value) {
    const text = String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > 185 ? `${text.slice(0, 182).replace(/\s+\S*$/, '')}…` : text;
  }

  function pick(rows, exclude) {
    return rows.find(row => usable(row) && `${row.job_title}|${row.company}` !== exclude);
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }

  function card(row) {
    const item = element('article', 'featured-card', '');
    item.append(element('h3', '', row.job_title));
    item.append(element('p', 'featured-company', row.company));
    item.append(element('p', 'featured-location', row.location || 'Location listed on source site'));
    const summary = description(row.job_description);
    item.append(element('p', `featured-description${summary ? '' : ' missing'}`,
      summary || 'Read the full job description on the original listing.'));
    const bottom = element('div', 'featured-card-bottom', '');
    const age = Math.max(0, Math.floor((Date.now() - Date.parse(row.posted_at)) / 86400000));
    bottom.append(element('span', 'featured-source', age === 0 ? 'Posted today' : `Posted ${age} day${age === 1 ? '' : 's'} ago`));
    const link = element('a', 'featured-apply', 'View job ↗');
    link.href = window.FJDataSafety.httpUrl(row.apply_url);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    bottom.append(link);
    item.append(bottom);
    if (row.source === 'adzuna') {
      const credit = document.createElement('div');
      credit.innerHTML = window.FJDataSafety.adzunaAttribution(row);
      item.append(credit.firstElementChild);
    } else {
      item.append(element('span', 'featured-source', `Source: ${row.source || 'original listing'}`));
    }
    return item;
  }

  Promise.allSettled([recent('eq.adzuna', 40), recent('neq.adzuna', 20)]).then(results => {
    const adzuna = results[0].status === 'fulfilled' ? results[0].value : [];
    const other = results[1].status === 'fulfilled' ? results[1].value : [];
    const first = pick(adzuna.filter(row => description(row.job_description)), '');
    const second = pick(other, first && `${first.job_title}|${first.company}`) ||
      pick(adzuna.filter(row => description(row.job_description)), first && `${first.job_title}|${first.company}`);
    const selected = [first, second].filter(Boolean);
    mount.replaceChildren();
    if (!selected.length) {
      mount.append(element('p', 'featured-status', 'Recent job previews are unavailable right now. Search the full catalogue above.'));
      return;
    }
    selected.forEach(row => mount.append(card(row)));
  });
})();
