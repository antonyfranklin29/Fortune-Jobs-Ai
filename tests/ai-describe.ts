// Live job descriptions for AI Coach (supabase/functions/ai-assist/describe.ts). Offline.
//   deno test tests/ai-describe.ts
import { assert, assertEquals } from "./deno/assert.ts";
import { fetchDescription, locate, toText } from "../supabase/functions/ai-assist/describe.ts";

Deno.test("toText turns escaped HTML into readable text", () => {
  assertEquals(toText("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;"), "Hello & welcome\n\n• SQL");
  assertEquals(toText("<script>x()</script><b>Go</b>&nbsp;now"), "Go now");
});

Deno.test("locate knows each board's slug and id", () => {
  assertEquals(locate("lever", "palantir:1b69", ""), { source: "lever", slug: "palantir", id: "1b69" });
  assertEquals(locate("usajobs", "887072000", ""), { source: "usajobs", slug: "", id: "887072000" });
  assertEquals(locate("usajobs", null, "https://www.usajobs.gov/job/123"), { source: "usajobs", slug: "", id: "123" });
  assertEquals(locate("dice", null, "https://www.dice.com/job-detail/x"), null);
  assertEquals(locate("greenhouse", "nojobid", ""), null);
});

Deno.test("fetchDescription reads each provider's format", async () => {
  const calls: string[] = [];
  const data: Record<string, unknown> = {
    "https://api.lever.co/v0/postings/p/1?mode=json": { descriptionPlain: "Intro", lists: [{ text: "You will", content: "<li>Ship</li>" }], additionalPlain: "Benefits" },
    "https://api.ashbyhq.com/posting-api/job-board/n": { jobs: [{ id: "a", descriptionPlain: "Other" }, { id: "b", descriptionPlain: "Ashby text" }] },
    "https://api.smartrecruiters.com/v1/companies/S/postings/9": { jobAd: { sections: { jobDescription: { title: "Job", text: "<p>Do X</p>" }, qualifications: { title: "Quals", text: "<p>Y</p>" } } } },
    "https://data.usajobs.gov/api/search?ControlNumber=7": { SearchResult: { SearchResultItems: [{ MatchedObjectDescriptor: { QualificationSummary: "GS-12", UserArea: { Details: { JobSummary: "Serve", MajorDuties: ["Duty 1", "Duty 2"] } } } }] } },
  };
  const get = async (url: string, headers?: Record<string, string>) => { calls.push(url + (headers?.["Authorization-Key"] ? " +key" : "")); if (!(url in data)) throw new Error("404"); return data[url]; };
  const lever = await fetchDescription({ source: "lever", slug: "p", id: "1" }, get);
  assert(lever.includes("Intro") && lever.includes("• Ship") && lever.includes("Benefits"));
  assertEquals(await fetchDescription({ source: "ashby", slug: "n", id: "b" }, get), "Ashby text");
  assertEquals(await fetchDescription({ source: "smartrecruiters", slug: "S", id: "9" }, get), "Job\nDo X\n\nQuals\nY");
  const usa = await fetchDescription({ source: "usajobs", slug: "", id: "7" }, get, { key: "k", email: "e" });
  assert(usa.includes("Serve") && usa.includes("Duty 2") && usa.includes("GS-12"));
  assert(calls.includes("https://data.usajobs.gov/api/search?ControlNumber=7 +key"), "USAJOBS call carries the key");
  assertEquals(await fetchDescription({ source: "greenhouse", slug: "gone", id: "1" }, get), "", "a failed board read gives an empty description, not an error");
  assertEquals(await fetchDescription({ source: "usajobs", slug: "", id: "7" }, get), "", "no USAJOBS key, no call");
});
