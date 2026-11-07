// deno test --allow-env --allow-read --no-check --import-map=tests/deno/import_map.json tests/usajobs-ingest.ts
import { assert, assertEquals } from "./deno/assert.ts";
import * as L from "../supabase/functions/usajobs-ingest/core.mjs";
import { ROLES, REGIONS } from "../supabase/functions/usajobs-ingest/config.mjs";
import { normalize, salaryOf, searchUrl } from "../supabase/functions/usajobs-ingest/usa.mjs";

const roles = L.compileRoles(ROLES), idx = L.regionIndex(REGIONS);
const now = new Date("2026-11-07T12:00:00Z"), ctx = { roles, idx, fetchedAt: now.toISOString(), now };
const item = (d: Record<string, unknown>) => ({ MatchedObjectId: "812345", MatchedObjectDescriptor: {
  PositionTitle: "Data Scientist", PositionURI: "https://www.usajobs.gov:443/GetJob/ViewDetails/812345",
  OrganizationName: "Census Bureau", PositionLocationDisplay: "Suitland, Maryland",
  PositionLocation: [{ CityName: "Suitland, Maryland", CountryCode: "United States", CountrySubDivisionCode: "Maryland" }],
  PositionRemuneration: [{ MinimumRange: "99200", MaximumRange: "153354", RateIntervalCode: "PA" }],
  PositionSchedule: [{ Name: "Full-time" }], PublicationStartDate: "2026-11-02T00:00:00.0000",
  ApplicationCloseDate: "2026-11-20T23:59:59.9970", ...d } });

Deno.test("a federal posting becomes a usajobs.gov-linked row with stated pay", () => {
  const n = normalize(item({}), ctx);
  assert(n.row, JSON.stringify(n));
  assertEquals(n.row.state_code, "MD");
  assertEquals(n.row.canonical_role, "data-scientist");
  assertEquals(n.row.salary, "$99,200–$153,354");
  assertEquals(n.row.company, "Census Bureau");
  assertEquals(n.row.employment_type, "Full-time");
  assert(String(n.row.apply_url).includes("usajobs.gov"));
  assertEquals(n.row.job_description, null);
});

Deno.test("closed, foreign, non-usajobs links and hourly pay are handled honestly", () => {
  assertEquals(normalize(item({ ApplicationCloseDate: "2026-11-01T00:00:00" }), ctx).reject, "closed");
  assertEquals(normalize(item({ PositionURI: "https://example.com/x" }), ctx).reject, "not_usajobs_link");
  assertEquals(normalize(item({ PositionLocation: [{ CountryCode: "Germany", CountrySubDivisionCode: "Bavaria" }] }), ctx).reject, "no_us_state");
  assertEquals(salaryOf([{ MinimumRange: "30", MaximumRange: "40", RateIntervalCode: "PH" }]), null);
  assertEquals(normalize(item({ PositionLocation: [{ CountrySubDivisionCode: "District of Columbia" }] }), ctx).row?.state_code, "DC");
});

Deno.test("search asks for IT series, newest first, max page size", () => {
  const u = new URL(searchUrl("2210", 2));
  assertEquals(u.hostname, "data.usajobs.gov");
  assertEquals(u.searchParams.get("JobCategoryCode"), "2210");
  assertEquals(u.searchParams.get("ResultsPerPage"), "500");
  assertEquals(u.searchParams.get("Page"), "2");
});
