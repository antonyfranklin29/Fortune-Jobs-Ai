import React from 'react';
import { afterEach, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CategoryTiles, SearchAlternatives } from './CatalogueDiscovery.jsx';
import { matchTitles } from './suggest.js';
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });
it('shows real positive category counts and hides zero groups', async () => {
  window.FJ_CONFIG = { url: 'https://fixture.test', key: 'public' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([{sector:'healthcare',open_jobs:12},{sector:'transport',open_jobs:0}])));
  render(<CategoryTiles />);
  expect(await screen.findByText('12 open jobs')).toBeTruthy();
  expect(screen.queryByText('Transport & Logistics')).toBeNull();
});
it('offers counted alternatives below five results and hides them at five', async () => {
  window.FJ_CONFIG = { url: 'https://fixture.test', key: 'public' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([{kind:'state',label:'South Carolina',state:'SC',role_name:'Registered Nurse',open_jobs:8}])));
  const view = render(<SearchAlternatives query="Registered Nurse" state="GA" count={2} />);
  expect(await screen.findByText('South Carolina · 8 jobs')).toBeTruthy();
  expect(screen.getByRole('link',{name:/Also see live/})).toBeTruthy();
  view.rerender(<SearchAlternatives query="Registered Nurse" state="GA" count={5} />);
  expect(screen.queryByRole('region',{name:'Broaden your search'})).toBeNull();
});
it('short healthcare abbreviations resolve to useful full titles', () => {
  expect(matchTitles('RN')[0].text).toBe('Registered Nurse');
  expect(matchTitles('CNA')[0].text).toBe('Certified Nursing Assistant');
  expect(matchTitles('CDL driver')[0].text).toBe('CDL Truck Driver');
});
