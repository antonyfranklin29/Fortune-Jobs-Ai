import {createHash} from 'node:crypto';
// Exclude only snapshot dates and relative freshness text. Job IDs, URLs, pay,
// requirements, counts, links and templates remain part of the content digest.
export function contentDigest(html, rows=[]) {
  const stable=html.replace(/\b\d{4}-\d{2}-\d{2}\b/g,'DATE')
    .replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/g,'DATE')
    .replace(/\b\d+ posted in the last 7 days(?: · )?/g,'');
  return createHash('sha256').update(stable+'\n'+JSON.stringify(rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['updated_at','fetched_at','last_seen_at'].includes(key)).sort(([a],[b])=>a.localeCompare(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');
}
export function freshness(previous, html, date, rows=[]) {
  const digest=contentDigest(html,rows);
  return {digest,lastmod:previous?.digest===digest ? previous.lastmod : date};
}
