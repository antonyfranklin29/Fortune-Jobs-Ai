import { states } from '../resume/lib/guestResume.js';
import React, { useEffect, useState } from 'react';
import { discoveryRole } from '../shared/jobTags.js';

async function rpc(name, args = {}, signal) {
  const { url, key } = window.FJ_CONFIG;
  const response = await fetch(url + '/rest/v1/rpc/' + name, { method: 'POST', signal,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!response.ok) throw new Error('Catalogue counts unavailable');
  return response.json();
}
export function CategoryTiles() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        let cached;
        try { cached = JSON.parse(sessionStorage.getItem('fj_category_counts')); } catch { /* Fetch a fresh count. */ }
        const data = cached?.until > Date.now() ? cached.rows : await rpc('catalogue_category_counts', {}, controller.signal);
        if (!Array.isArray(data) || controller.signal.aborted) return;
        setRows(data.filter(row => ['healthcare','tech','transport'].includes(row.sector) && Number.isSafeInteger(Number(row.open_jobs)) && Number(row.open_jobs) > 0));
        try { sessionStorage.setItem('fj_category_counts', JSON.stringify({ rows: data, until: Date.now() + 3600000 })); } catch { /* Counts still display. */ }
      } catch { /* Hide the tiles when real counts cannot be read. */ }
    };
    load(); return () => controller.abort();
  }, []);
  const labels = { healthcare: 'Healthcare', tech: 'Tech', transport: 'Transport & Logistics' };
  return rows.length ? <section className="category-tiles" aria-label="Explore job categories">{rows.map(row => <a key={row.sector}
    href={'./results.html?' + new URLSearchParams({ mode: 'quick', country: 'us', sector: row.sector })}>
    <strong>{labels[row.sector]}</strong><span>{Number(row.open_jobs).toLocaleString()} open jobs</span><span aria-hidden="true">→</span>
  </a>)}</section> : null;
}
export function SearchAlternatives({ query, state, count }) {
  const [rows, setRows] = useState([]);
  const role = discoveryRole(query);
  useEffect(() => {
    const controller = new AbortController();
    setRows([]);
    if (count >= 5 || !role) return;
    rpc('catalogue_search_alternatives', { p_role: role.id, p_state: state || '' }, controller.signal)
      .then(data => { if (!controller.signal.aborted && Array.isArray(data)) setRows(data.filter(row => Number.isSafeInteger(Number(row.open_jobs)) && Number(row.open_jobs) > 0)); }).catch(() => {});
    return () => controller.abort();
  }, [role?.id, state, count]);
  if (count >= 5 || !role) return null;
  return <section className="search-alternatives" aria-label="Broaden your search"><h2>Broaden your search</h2>
    {['state', 'role'].filter(kind => rows.some(row => row.kind === kind)).map(kind => <div key={kind}><h3>{kind === 'state' ? 'Nearby states' : 'Similar roles'}</h3>
      {rows.filter(row => row.kind === kind).map(row => <a key={row.label} href={'./results.html?' + new URLSearchParams({ mode: 'quick', country: 'us', q: row.role_name, ...(row.state && { location: row.state }) })}>
        {row.kind === 'state' ? states[row.state] || row.label : row.label} · {Number(row.open_jobs)} {Number(row.open_jobs) === 1 ? 'job' : 'jobs'}</a>)}</div>)}
    <a href={'./results.html?' + new URLSearchParams({ mode: 'live', q: role.name, location: state || '' })}>Also see live jobs from our partners →</a>
  </section>;
}
