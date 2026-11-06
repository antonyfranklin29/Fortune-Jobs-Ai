// Adzuna "land/ad" links only work with the signed se/v parameters Adzuna adds. An older
// version of the job fetcher removed those, so such links open Adzuna's "Cannot find page".
// Adzuna's own job page (/details/<id>) works for the same listing and has its Apply button.
const BARE_ADZUNA = /^https:\/\/(?:www\.)?adzuna\.com\/land\/ad\/(\d+)\/?$/i;
export function fixApplyUrl(url) {
  const m = BARE_ADZUNA.exec(String(url || '').trim());
  return m ? `https://www.adzuna.com/details/${m[1]}` : url;
}
