import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRequire } from 'node:module';
import { SearchForm } from './SearchForm.jsx';
import { fetchCities, localPlaces, matchTitles } from './suggest.js';

const require = createRequire(import.meta.url);
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
// Load the real /job-titles.js the site ships.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../job-titles.js'), 'utf8'), sandbox);
const CATALOG = sandbox.window.JOB_SUGGESTIONS;

let nav;
beforeEach(() => {
  window.JOB_SUGGESTIONS = CATALOG;
  nav = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, set href(v) { nav(v); }, get href() { return 'http://localhost/index.html'; }, search: '' } });
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ results: [
    { name: 'Chicago', admin1: 'Illinois', country: 'United States', country_code: 'US', population: 2700000, feature_code: 'PPLA2' },
    { name: 'Chiba', admin1: 'Chiba', country: 'Japan', country_code: 'JP', population: 900000, feature_code: 'PPLA' },
    { name: 'Chihuahua', admin1: 'Chihuahua', country: 'Mexico', country_code: 'MX', population: 800000, feature_code: 'PPLA' },
    { name: 'Chicago Heights', admin1: 'Illinois', country: 'United States', country_code: 'US', population: 30000, feature_code: 'PPL' },
    { name: 'China', country: 'China', country_code: 'CN', population: 1300000000, feature_code: 'PCLI' },
  ] }) }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const params = () => new URL(nav.mock.calls.at(-1)[0], 'http://localhost/').searchParams;
const job = () => screen.getByRole('combobox', { name: 'Job title or keyword' });
const loc = () => screen.getByRole('combobox', { name: 'Location' });
const options = (name) => screen.getByRole('listbox', { name, hidden: true }).querySelectorAll('[role=option]');

describe('suggestion data', () => {
  it('dat → Data Analyst first; nothing under three characters', () => {
    expect(matchTitles('da', CATALOG)).toEqual([]);
    expect(matchTitles('dat', CATALOG)[0]).toMatchObject({ text: 'Data Analyst', kind: 'title' });
  });
  it('chi → Chicago instantly, and US-only lists skip other countries', () => {
    expect(localPlaces('chi')[0]).toMatchObject({ name: 'Chicago', admin1: 'Illinois' });
    expect(localPlaces('new j')[0]).toMatchObject({ name: 'New Jersey', scope: 'region' });
    expect(localPlaces('chi', 'gb')).toEqual([]);
    expect(localPlaces('newyork')[0]).toMatchObject({ name: 'New York', admin1: 'New York' });
    expect(localPlaces('stlouis')[0]).toMatchObject({ name: 'St. Louis' });
  });
  it('API cities are filtered, de-duplicated and ranked by size', async () => {
    const list = await fetchCities('chi', '', { fetchImpl: globalThis.fetch });
    expect(list.map((c) => c.name)).toEqual(['Chicago', 'Chiba', 'Chihuahua', 'Chicago Heights']);
  });
});

describe('country suggestions', () => {
  it('united → United States and United Kingdom; can → Canada; ind → India first', () => {
    expect(localPlaces('united').map((p) => p.name)).toEqual(['United States', 'United Kingdom']);
    expect(localPlaces('can')[0]).toMatchObject({ name: 'Canada', scope: 'country', country_code: 'ca' });
    expect(localPlaces('ind').map((p) => p.name)).toEqual(['India', 'Indianapolis', 'Indiana']);
    expect(localPlaces('usa')[0]).toMatchObject({ name: 'United States' });
    expect(localPlaces('unitedkingdom')[0]).toMatchObject({ name: 'United Kingdom' });
    expect(localPlaces('can', 'ca').map((p) => p.name)).toEqual(['Canada']);
  });

  it('picking a country searches with the Country filter, and typing one works too', () => {
    render(<SearchForm sort="relevance" onSort={() => {}} />);
    fireEvent.change(job(), { target: { value: 'Nurse' } });
    fireEvent.change(loc(), { target: { value: 'can' } });
    const first = options('Location suggestions')[0];
    expect(first.textContent).toContain('Canada');
    fireEvent.mouseDown(first); fireEvent.click(first);
    expect(loc().value).toBe('Canada');
    fireEvent.submit(job().closest('form'));
    expect(params().get('country')).toBe('ca');
    expect(params().get('location')).toBeNull();
    cleanup();
    render(<SearchForm sort="relevance" onSort={() => {}} />);
    fireEvent.change(loc(), { target: { value: 'United Kingdom' } });
    fireEvent.submit(loc().closest('form'));
    expect(params().get('country')).toBe('gb');
    expect(params().get('location')).toBeNull();
  });

  it('a country-only search shows the country name again on the results page', () => {
    render(<SearchForm initial={{ country: 'in', q: 'Data Analyst' }} sort="relevance" onSort={() => {}} />);
    expect(loc().value).toBe('India');
  });
});

it('carries the work authorization filter into both search paths', () => {
  render(<SearchForm initial={{ q: 'Engineer' }} sort="relevance" onSort={() => {}} />);
  const select = screen.getByRole('combobox', { name: 'Work authorization' });
  fireEvent.change(select, { target: { value: 'opt_friendly' } });
  const skip = screen.getByRole('link', { name: 'Search without résumé' });
  expect(new URL(skip.href).searchParams.get('sponsorship')).toBe('opt_friendly');
  fireEvent.submit(job().closest('form'));
  expect(params().get('sponsorship')).toBe('opt_friendly');
});

describe('SearchForm suggestions', () => {
  it('keyboard: pick Data Analyst and Chicago, then submit the picked values', async () => {
    vi.useFakeTimers();
    render(<SearchForm sort="relevance" onSort={() => {}} />);
    fireEvent.change(job(), { target: { value: 'da' } });
    expect(job().getAttribute('aria-expanded')).toBe('false');
    fireEvent.change(job(), { target: { value: 'dat' } });
    expect(job().getAttribute('aria-expanded')).toBe('true');
    expect(options('Job title suggestions')[0].textContent).toContain('Data Analyst');
    fireEvent.keyDown(job(), { key: 'ArrowDown' });
    expect(job().getAttribute('aria-activedescendant')).toBe(options('Job title suggestions')[0].id);
    fireEvent.keyDown(job(), { key: 'Enter' });
    expect(job().value).toBe('Data Analyst');
    expect(nav).not.toHaveBeenCalled(); // Enter on a suggestion picks it, it does not submit
    fireEvent.change(loc(), { target: { value: 'chi' } });
    expect(options('Location suggestions')[0].textContent).toContain('Chicago');
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect([...options('Location suggestions')].map((o) => o.querySelector('.suggest-label').textContent)).toEqual(['Chicago', 'Chiba', 'Chihuahua', 'Chicago Heights']);
    fireEvent.keyDown(loc(), { key: 'ArrowDown' });
    fireEvent.keyDown(loc(), { key: 'Enter' });
    expect(loc().value).toBe('Chicago, Illinois');
    fireEvent.submit(job().closest('form'));
    expect(params().get('q')).toBe('Data Analyst');
    expect(params().get('location')).toBe('Chicago, Illinois');
    expect(params().get('country')).toBe('us');
  });

  it('mouse/tap: clicking a suggestion fills the box', () => {
    render(<SearchForm sort="relevance" onSort={() => {}} />);
    fireEvent.change(job(), { target: { value: 'dat' } });
    const first = options('Job title suggestions')[0];
    fireEvent.mouseDown(first); fireEvent.click(first);
    expect(job().value).toBe('Data Analyst');
    expect(job().getAttribute('aria-expanded')).toBe('false');
  });

  it('free text still searches; Escape closes; a failed city lookup keeps instant results', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
    render(<SearchForm sort="relevance" onSort={() => {}} />);
    fireEvent.change(job(), { target: { value: 'Data wrangler xyz' } });
    fireEvent.keyDown(job(), { key: 'Escape' });
    expect(job().getAttribute('aria-expanded')).toBe('false');
    fireEvent.change(loc(), { target: { value: 'chi' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(options('Location suggestions')[0].textContent).toContain('Chicago');
    fireEvent.change(loc(), { target: { value: 'Springfield-ish' } });
    fireEvent.submit(job().closest('form'));
    expect(params().get('q')).toBe('Data wrangler xyz');
    expect(params().get('location')).toBe('Springfield-ish');
    expect(params().get('country')).toBeNull();
  });
});
