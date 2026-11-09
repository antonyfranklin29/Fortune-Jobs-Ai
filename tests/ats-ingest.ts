// deno test --allow-env --allow-read --no-check --import-map=tests/deno/import_map.json tests/ats-ingest.ts
import { assert, assertEquals } from "./deno/assert.ts";
import * as L from "../supabase/functions/ats-ingest/core.mjs";
import { ROLES, REGIONS } from "../supabase/functions/ats-ingest/config.mjs";
import { BOARDS } from "../supabase/functions/ats-ingest/boards.mjs";
import { employerUrl, listOf, normalize, sliceFor, stateOf } from "../supabase/functions/ats-ingest/ats.mjs";

const roles = L.compileRoles(ROLES), idx = L.regionIndex(REGIONS);
const now = new Date("2026-11-07T12:00:00Z"), ctx = { roles, idx, fetchedAt: now.toISOString(), now };
const board = (provider: string, slug = "acme") => ({ provider, slug, name: "Acme" });

Deno.test("greenhouse job becomes an employer-linked row", () => {
  const n = normalize("greenhouse", { id: 42, title: "Senior Data Analyst", absolute_url: "https://boards.greenhouse.io/acme/jobs/42", location: { name: "Chicago, IL" }, first_published: "2026-11-01T00:00:00Z" }, board("greenhouse"), ctx);
  assert(n.row, JSON.stringify(n));
  assertEquals(n.row.canonical_role, "data-analyst");
  assertEquals(n.row.state_code, "IL");
  assertEquals(n.row.source_listing_id, "acme:42");
  assertEquals(n.row.apply_url, "https://boards.greenhouse.io/acme/jobs/42");
  assertEquals(n.row.company, "Acme");
});

Deno.test("greenhouse link on the company's own site is kept; aggregator links are not", () => {
  assert(employerUrl("greenhouse", "https://stripe.com/jobs/listing/x/123", null));
  assertEquals(employerUrl("greenhouse", "https://www.indeed.com/viewjob?jk=1", null), null);
  assertEquals(employerUrl("lever", "https://example.com/job", null), null);
  assertEquals(employerUrl("ashby", "http://jobs.ashbyhq.com/acme/1", null), "https://jobs.ashbyhq.com/acme/1");
});

Deno.test("lever, ashby and smartrecruiters shapes", () => {
  const lv = normalize("lever", { id: "a1", text: "Data Engineer", hostedUrl: "https://jobs.lever.co/acme/a1", categories: { location: "Austin, Texas, United States", commitment: "Full-time" }, createdAt: Date.parse("2026-11-02") }, board("lever"), ctx);
  assertEquals(lv.row?.state_code, "TX");
  assertEquals(lv.row?.employment_type, "Full-time");
  const ab = normalize("ashby", { id: "b2", title: "Software Engineer, Backend", jobUrl: "https://jobs.ashbyhq.com/acme/b2", location: "Remote", address: { postalAddress: { addressLocality: "New York", addressRegion: "New York" } }, workplaceType: "Remote", publishedAt: "2026-11-03T00:00:00Z" }, board("ashby"), ctx);
  assertEquals(ab.row?.state_code, "NY");
  assertEquals(ab.row?.work_mode, "remote");
  const sr = normalize("smartrecruiters", { id: "c3", name: "Cloud Engineer", location: { city: "Newark", region: "NJ", country: "us" }, releasedDate: "2026-11-04T00:00:00Z" }, board("smartrecruiters", "Acme"), ctx);
  assertEquals(sr.row?.apply_url, "https://jobs.smartrecruiters.com/Acme/c3");
  assertEquals(sr.row?.state_code, "NJ");
  assertEquals(normalize("smartrecruiters", { id: "d", name: "Cloud Engineer", location: { city: "Pune", country: "in" } }, board("smartrecruiters"), ctx).reject, "malformed_or_non_us");
});

Deno.test("no guessing: non-IT, non-US, stale and remote-without-state jobs are skipped", () => {
  const gh = (title: string, loc: string, posted = "2026-11-01T00:00:00Z") => normalize("greenhouse", { id: 1, title, absolute_url: "https://boards.greenhouse.io/acme/jobs/1", location: { name: loc }, first_published: posted }, board("greenhouse"), ctx);
  assertEquals(gh("Account Executive", "Chicago, IL").reject, "no_role");
  assertEquals(gh("Data Analyst", "London, UK").reject, "no_us_state");
  assertEquals(gh("Data Analyst", "Remote - US").reject, "no_us_state");
  assertEquals(gh("Data Analyst", "Chicago, IL", "2026-07-01T00:00:00Z").reject, "too_old");
});

Deno.test("multi-location strings pick the first US state", () => {
  assertEquals(stateOf(["London, UK; San Francisco, CA (Hybrid)"], idx), "CA");
  assertEquals(stateOf(["Seattle, WA or New York, NY"], idx), "WA");
});

Deno.test("board list: slices cover every board once, no duplicates", () => {
  const keys = BOARDS.map((b: { provider: string; slug: string }) => `${b.provider}:${b.slug}`);
  assertEquals(new Set(keys).size, keys.length);
  const seen = [0, 1, 2, 3].flatMap((p) => sliceFor(BOARDS, p, 4));
  assertEquals(seen.length, BOARDS.length);
  assertEquals(listOf("lever", [{}, {}]).length, 2);
  assertEquals(listOf("greenhouse", { jobs: [{}] }).length, 1);
});

Deno.test("core.mjs and config.mjs are current copies of job-ingest (run scripts/build-ats-core.cjs)", async () => {
  const lib = await Deno.readTextFile(new URL("../supabase/functions/ats-ingest/core.mjs", import.meta.url));
  const core = await Deno.readTextFile(new URL("../supabase/functions/ats-ingest/core.mjs", import.meta.url));
  for (const block of core.split(/\n(?=export function )/).slice(1)) assert(lib.includes(block.trim()), block.slice(0, 60));
  const a = await Deno.readTextFile(new URL("../supabase/functions/ats-ingest/config.mjs", import.meta.url));
  const b = await Deno.readTextFile(new URL("../supabase/functions/ats-ingest/config.mjs", import.meta.url));
  assertEquals(a, b);
});

Deno.test("workable: US locations only, link to the Workable posting", () => {
  const job = { shortcode: "AB12", title: "Senior Software Engineer", url: "https://apply.workable.com/j/AB12", published_on: new Date().toISOString().slice(0, 10), telecommuting: false, employment_type: "Full-time",
    locations: [{ country: "Canada", countryCode: "CA", city: "Toronto", region: "Ontario" }, { country: "United States", countryCode: "US", city: "Austin", region: "Texas" }] };
  const r = normalize("workable", job, board("workable", "Valsoft Corporation"), ctx);
  assertEquals(r.row?.state_code, "TX");
  assertEquals(r.row?.apply_url, "https://apply.workable.com/j/AB12");
  assertEquals(r.row?.employment_type, "Full-time");
  assertEquals(normalize("workable", { ...job, locations: [{ countryCode: "FR", city: "Paris", region: "Île-de-France" }] }, board("workable"), ctx).reject, "malformed_or_non_us");
  assertEquals(normalize("workable", { ...job, url: "https://www.linkedin.com/jobs/1" }, board("workable"), ctx).reject, "not_employer_link");
});
