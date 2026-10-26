/* Employer marks are curated by exact company name. Unknown employers keep an initial. */
(function (root) {
  'use strict';
  const domains = Object.freeze({
    'randstad digital': 'randstaddigital.com',
    'cbre': 'cbre.com',
    'cognizant': 'cognizant.com',
    'booz allen hamilton': 'boozallen.com',
    'oracle': 'oracle.com',
    'cardinal health': 'cardinalhealth.com',
    'cambia health solutions': 'cambiahealth.com',
    'caci international, inc.': 'caci.com',
    'caci': 'caci.com',
    'enterprise bank and trust': 'enterprisebank.com',
    'enterprise bank & trust': 'enterprisebank.com',
    'plymouth rock assurance corporation': 'plymouthrock.com',
    'trans union llc': 'transunion.com',
    'capital one': 'capitalone.com',
    'crowdstrike': 'crowdstrike.com',
    'applied materials': 'appliedmaterials.com',
    'robert half': 'roberthalf.com',
    'kforce technology staffing': 'kforce.com',
    'intuit': 'intuit.com',
    'jobot': 'jobot.com',
    'fairfax county': 'fairfaxcounty.gov',
    'trellix': 'trellix.com',
    'chemours': 'chemours.com',
    'eliassen group': 'eliassen.com',
    'cadmus': 'cadmusgroup.com'
  });

  function name(job) { return String(job?.company || '').trim(); }
  function metadata(job) {
    let value = job?.source_metadata;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { return null; }
    }
    return value && typeof value === 'object' ? value : null;
  }
  function trustedFeedLogo(job) {
    const company = metadata(job)?.company;
    if (!company || typeof company !== 'object') return null;
    const url = company.logos?.squareSizes?.url96 || company.logos?.square;
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'd2q79iu7y748jz.cloudfront.net') return null;
      if (!parsed.pathname.startsWith('/s/_squarelogo/')) return null;
      return parsed.href;
    } catch { return null; }
  }
  function urlFor(job) {
    const domain = domains[name(job).toLowerCase().replace(/\s+/g, ' ')];
    if (domain) return `assets/company-logos/${domain}.png`;
    return trustedFeedLogo(job);
  }
  function letterFor(job) { return name(job).charAt(0).toUpperCase() || '?'; }
  function html(job, escapeHtml) {
    const url = urlFor(job);
    return `<span class="company-logo" aria-hidden="true">${escapeHtml(letterFor(job))}${url ? `<img class="company-logo-image" src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async">` : ''}</span>`;
  }
  function element(job, className = 'featured-logo') {
    const node = document.createElement('span');
    node.className = className;
    node.setAttribute('aria-hidden', 'true');
    node.textContent = letterFor(job);
    const url = urlFor(job);
    if (url) {
      const img = document.createElement('img');
      img.className = 'company-logo-image';
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => img.remove(), { once: true });
      node.append(img);
    }
    return node;
  }
  if (root.document) root.document.addEventListener('error', function (event) {
    if (event.target?.classList?.contains('company-logo-image')) event.target.remove();
  }, true);
  const api = { urlFor, letterFor, html, element, trustedFeedLogo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FJCompanyLogos = api;
})(typeof window !== 'undefined' ? window : globalThis);
