import React, { useEffect, useRef, useState } from 'react';
import { CompanyMark } from './JobViews.jsx';
import './hiring-now.css';

const CACHE_KEY = 'fj-hiring-now-v1';
const HOUR = 60 * 60 * 1000;
const COUNT = new Intl.NumberFormat('en-US');
const validRows = rows => Array.isArray(rows) && rows.length > 0 && rows.length <= 24 &&
  rows.every(row => typeof row?.company === 'string' && row.company.trim() &&
    Number.isSafeInteger(row.open_jobs) && row.open_jobs > 0);

export async function loadHiringCompanies(config, signal) {
  if (!config) return [];
  try {
    const cache = JSON.parse(window.sessionStorage.getItem(CACHE_KEY));
    const age = Date.now() - cache?.time;
    if (age >= 0 && age < HOUR && validRows(cache.rows)) return cache.rows;
  } catch { /* Storage can be unavailable. */ }

  try {
    const response = await fetch(config.url + '/rest/v1/rpc/top_hiring_companies', {
      method: 'POST',
      headers: { apikey: config.key, Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 24 }),
      signal,
    });
    if (!response.ok) return [];
    const rows = await response.json();
    if (!validRows(rows) || signal?.aborted) return [];
    try { window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), rows })); }
    catch { /* The fetched results still work without a cache. */ }
    return rows;
  } catch {
    return [];
  }
}

export function HiringNow() {
  const [rows, setRows] = useState([]);
  const [moving, setMoving] = useState(false);
  const [paused, setPaused] = useState(false);
  const viewport = useRef(null);
  const group = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    loadHiringCompanies(window.FJ_CONFIG, controller.signal).then(data => {
      if (!controller.signal.aborted) setRows(data);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!rows.length || !window.ResizeObserver) return;
    const measure = () => setMoving(group.current.scrollWidth > viewport.current.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current);
    observer.observe(group.current);
    measure();
    return () => observer.disconnect();
  }, [rows]);

  const chips = copy => rows.map(row => {
    const params = new URLSearchParams({ mode: 'quick', country: 'us', q: row.company });
    return <li key={row.company}>
      <a href={`/results.html?${params}`} tabIndex={copy ? -1 : undefined} onMouseDown={copy ? event => event.preventDefault() : undefined} className="hiring-chip">
        <CompanyMark job={row} />
        <span>{row.company} · {COUNT.format(row.open_jobs)} open {row.open_jobs === 1 ? 'job' : 'jobs'}</span>
      </a>
    </li>;
  });

  return <div className="hiring-slot">
    {rows.length > 0 && <section aria-labelledby="hiring-now-heading" className="hiring-now">
      <div className="hiring-header">
        <h2 id="hiring-now-heading">Companies hiring now on Fortune Jobs AI</h2>
        {moving && <button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>Pause scrolling</button>}
      </div>
      <div className={`hiring-viewport${moving ? ' is-moving' : ''}${paused ? ' is-paused' : ''}`} ref={viewport}>
        <div className="hiring-track">
          <ul className="hiring-group" ref={group}>{chips(false)}</ul>
          {moving && <ul className="hiring-group hiring-copy" aria-hidden="true">{chips(true)}</ul>}
        </div>
      </div>
      <p>Live counts from our job catalogue. Not affiliated with these companies.</p>
    </section>}
  </div>;
}
