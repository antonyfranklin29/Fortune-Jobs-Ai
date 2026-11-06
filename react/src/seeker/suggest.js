// Search suggestions for the job and location boxes.
// Job titles, skills and companies come from /job-titles.js (window.JOB_SUGGESTIONS).
// Locations come from US states, a short list of large US cities (works offline),
// then worldwide cities from Open-Meteo's free geocoding API, as the old homepage did.
import { states } from '../resume/lib/guestResume.js';

export const MIN_CHARS = 3;
const TITLE_MAX = 10;
const CITY_MAX = 8;
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let titleIndex = null;
let titleSource = null;
function buildTitleIndex(src) {
  const all = [];
  for (const [kind, list] of [['title', src.titles], ['skill', src.skills], ['company', src.companies]]) {
    (list || []).forEach((text, pos) => {
      const f = fold(text);
      all.push({ text, kind, pos, f, starts: [0, ...[...f.matchAll(/[\s\-/&(.]+/g)].map((m) => m.index + m[0].length)] });
    });
  }
  return all;
}

/** Port of the old homepage's matchTitles(): prefix matches first, then word-start matches, in list order. */
export function matchTitles(query, src = typeof window === 'object' ? window.JOB_SUGGESTIONS : null) {
  const q = fold(query).replace(/\s+/g, ' ').trim();
  if (q.length < MIN_CHARS || !src) return [];
  if (titleSource !== src) { titleIndex = buildTitleIndex(src); titleSource = src; }
  const out = [];
  for (const it of titleIndex) {
    let rank = -1; let at = -1;
    if (it.f.startsWith(q)) { rank = 0; at = 0; } else {
      const s = it.starts.find((p) => p > 0 && it.f.startsWith(q, p));
      if (s !== undefined) { rank = 1; at = s; }
    }
    if (rank >= 0) out.push({ text: it.text, kind: it.kind, pos: it.pos, rank, at, len: q.length });
  }
  out.sort((a, b) => a.rank - b.rank || a.pos - b.pos);
  const titles = out.filter((x) => x.kind === 'title');
  const others = out.filter((x) => x.kind !== 'title' && x.rank === 0).slice(0, 2);
  const shown = titles.slice(0, TITLE_MAX - others.length).concat(others);
  return shown.length < TITLE_MAX ? shown.concat(out.filter((x) => !shown.includes(x)).slice(0, TITLE_MAX - shown.length)) : shown;
}

// Large US cities, so the most common searches work instantly and offline.
const US_CITIES = [
  ['New York', 'New York'], ['Los Angeles', 'California'], ['Chicago', 'Illinois'], ['Houston', 'Texas'], ['Phoenix', 'Arizona'],
  ['Philadelphia', 'Pennsylvania'], ['San Antonio', 'Texas'], ['San Diego', 'California'], ['Dallas', 'Texas'], ['Jacksonville', 'Florida'],
  ['Austin', 'Texas'], ['Fort Worth', 'Texas'], ['San Jose', 'California'], ['Columbus', 'Ohio'], ['Charlotte', 'North Carolina'],
  ['Indianapolis', 'Indiana'], ['San Francisco', 'California'], ['Seattle', 'Washington'], ['Denver', 'Colorado'], ['Oklahoma City', 'Oklahoma'],
  ['Nashville', 'Tennessee'], ['Washington', 'District of Columbia'], ['El Paso', 'Texas'], ['Las Vegas', 'Nevada'], ['Boston', 'Massachusetts'],
  ['Detroit', 'Michigan'], ['Portland', 'Oregon'], ['Louisville', 'Kentucky'], ['Memphis', 'Tennessee'], ['Baltimore', 'Maryland'],
  ['Milwaukee', 'Wisconsin'], ['Albuquerque', 'New Mexico'], ['Tucson', 'Arizona'], ['Fresno', 'California'], ['Sacramento', 'California'],
  ['Mesa', 'Arizona'], ['Kansas City', 'Missouri'], ['Atlanta', 'Georgia'], ['Omaha', 'Nebraska'], ['Colorado Springs', 'Colorado'],
  ['Raleigh', 'North Carolina'], ['Miami', 'Florida'], ['Minneapolis', 'Minnesota'], ['Tampa', 'Florida'], ['New Orleans', 'Louisiana'],
  ['Cleveland', 'Ohio'], ['Pittsburgh', 'Pennsylvania'], ['Cincinnati', 'Ohio'], ['St. Louis', 'Missouri'], ['Orlando', 'Florida'],
  ['Salt Lake City', 'Utah'], ['Newark', 'New Jersey'], ['Jersey City', 'New Jersey'], ['Edison', 'New Jersey'], ['Durham', 'North Carolina'],
  ['Greenville', 'North Carolina'], ['Irvine', 'California'], ['Plano', 'Texas'], ['Richmond', 'Virginia'], ['Arlington', 'Virginia'],
].map(([name, admin1], rank) => ({ name, admin1, country: 'United States', country_code: 'us', scope: 'city', kind: 'City', rank }));

const regionEntries = Object.entries(states).map(([code, name]) => ({ code, name, admin1: name, country: 'United States', country_code: 'us', scope: 'region', kind: code === 'DC' ? 'District' : 'State' }));

// Countries the search can filter by (the Country filter's options), with common short names.
export const SEARCH_COUNTRIES = [
  { code: 'us', name: 'United States', aliases: ['usa', 'united states of america', 'america'] },
  { code: 'ca', name: 'Canada', aliases: [] },
  { code: 'gb', name: 'United Kingdom', aliases: ['uk', 'great britain', 'britain', 'england'] },
  { code: 'in', name: 'India', aliases: ['bharat'] },
];
const countryEntries = SEARCH_COUNTRIES.map((c) => ({ name: c.name, admin1: '', country: c.name, country_code: c.code, scope: 'country', kind: 'Country', aliases: c.aliases }));

/** Countries matching what was typed (prefix of the name or a common short name). */
export function countryPlaces(query) {
  const q = fold(query).split(',')[0].trim();
  if (q.length < MIN_CHARS) return [];
  const tight = q.replace(/[\s.-]+/g, '');
  return countryEntries.filter((c) => [c.name, ...c.aliases].some((n) => fold(n).startsWith(q) || fold(n).replace(/[\s.-]+/g, '').startsWith(tight)));
}

/** The country code when the whole location is a country name or short name ("Canada", "UK"), else ''. */
export function exactCountry(location) {
  const q = fold(location).trim().replace(/\.$/, '');
  const hit = SEARCH_COUNTRIES.find((c) => [c.name, ...c.aliases].some((n) => fold(n) === q || fold(n).replace(/[\s.]+/g, '') === q.replace(/[\s.]+/g, '')));
  return hit ? hit.code : '';
}

/** Instant location suggestions (no network): countries, US cities, then US states. */
export function localPlaces(query, country = '') {
  const q = fold(query).split(',')[0].trim();
  if (q.length < MIN_CHARS) return [];
  const countries = countryPlaces(q);
  if (country && country !== 'us') return countries;
  const tight = q.replace(/[\s.-]+/g, ''); // "newyork" and "st louis" still match
  const starts = (name) => fold(name).startsWith(q) || fold(name).replace(/[\s.-]+/g, '').startsWith(tight);
  const regions = regionEntries.filter((r) => starts(r.name) || r.code.toLowerCase() === q);
  const cities = US_CITIES.filter((c) => starts(c.name));
  return [...countries, ...cities, ...regions].slice(0, CITY_MAX);
}

export const placeLabel = (p) => (p.scope === 'region' || p.scope === 'country' ? p.name : [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : null].filter(Boolean).join(', '));
export const placeKey = (p) => `${fold(p.name)}|${fold(p.admin1)}|${(p.country_code || '').toLowerCase()}`;

const cityCache = new Map();
/** Worldwide cities from Open-Meteo (free, no key), filtered and ranked like the old homepage. */
export async function fetchCities(query, country = '', { fetchImpl = (...a) => fetch(...a), signal } = {}) {
  const q = query.split(',')[0].trim();
  const key = `${country}|${fold(q)}`;
  if (cityCache.has(key)) return cityCache.get(key);
  const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=30&language=en&format=json' + (country ? '&countryCode=' + country.toUpperCase() : '');
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error('city lookup failed');
  const data = await res.json();
  const fq = fold(q);
  const seen = new Set();
  const all = (data.results || [])
    .filter((r) => !/^(ADM|PCL|CONT|RGN)/.test(r.feature_code || '') && fold(r.name).startsWith(fq)) // cities and towns, not countries
    .map((r) => ({ name: r.name, admin1: r.admin1 || '', country: r.country || '', country_code: (r.country_code || '').toLowerCase(), scope: 'city', kind: 'City', population: r.population || 0, feature_code: r.feature_code || '' }))
    .filter((r) => { const k = placeKey(r); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.population - a.population);
  const big = all.filter((r) => r.population >= 5000 || /^PPL(A|C)/.test(r.feature_code));
  const list = (big.length >= 3 ? big : all).slice(0, CITY_MAX);
  cityCache.set(key, list);
  return list;
}

/** Local places first, then API cities not already listed. */
export function mergePlaces(local, remote) {
  const seen = new Set(local.map(placeKey));
  return [...local, ...remote.filter((r) => !seen.has(placeKey(r)))].slice(0, CITY_MAX);
}
