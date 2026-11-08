// Full job descriptions for AI Coach, read live from the employer's own public job board when our
// catalogue has only a link (company career boards and USAJOBS). Nothing fetched here is stored:
// it is used for this one AI request and then dropped.

export const MIN_DESCRIPTION = 200; // shorter text is a snippet, not a description

/** HTML (possibly entity-escaped, as Greenhouse sends it) to plain text with line breaks kept. */
export function toText(html: string): string {
  let s = String(html || "");
  for (let i = 0; i < 2 && /&lt;|&gt;/.test(s); i++) s = decode(s);
  s = s.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d|\/ul|\/ol|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ");
  return decode(s).replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function decode(s: string) {
  return s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
}

// deno-lint-ignore no-explicit-any
type Get = (url: string, headers?: Record<string, string>) => Promise<any>;

/** Where to read a listing's description: provider plus the board slug and job id. */
export function locate(source: string, listingId: string | null, applyUrl: string) {
  const [slug, ...rest] = String(listingId || "").split(":");
  const id = rest.join(":");
  if (["greenhouse", "lever", "ashby", "smartrecruiters"].includes(source) && slug && id) return { source, slug, id };
  if (source === "usajobs") {
    const m = String(listingId || "").match(/^\d+$/) ? listingId : applyUrl.match(/usajobs\.gov\/job\/(\d+)/)?.[1];
    if (m) return { source, slug: "", id: String(m) };
  }
  return null;
}

/** Plain-text description from the provider's public API, or "" when it can't be read. */
export async function fetchDescription(where: { source: string; slug: string; id: string; title?: string }, get: Get, usajobs?: { key: string; email: string }): Promise<string> {
  const e = encodeURIComponent;
  const { source, slug, id } = where;
  try {
    if (source === "greenhouse") {
      const j = await get(`https://boards-api.greenhouse.io/v1/boards/${e(slug)}/jobs/${e(id)}`);
      return toText(j?.content || "");
    }
    if (source === "lever") {
      const j = await get(`https://api.lever.co/v0/postings/${e(slug)}/${e(id)}?mode=json`);
      const lists = (j?.lists || []).map((l: { text?: string; content?: string }) => `${l.text || ""}\n${toText(l.content || "")}`).join("\n\n");
      return [j?.descriptionPlain || toText(j?.description || ""), lists, j?.additionalPlain || ""].filter(Boolean).join("\n\n").trim();
    }
    if (source === "ashby") {
      const board = await get(`https://api.ashbyhq.com/posting-api/job-board/${e(slug)}`);
      const j = (board?.jobs || []).find((x: { id?: string }) => x.id === id);
      return String(j?.descriptionPlain || toText(j?.descriptionHtml || "")).trim();
    }
    if (source === "smartrecruiters") {
      const j = await get(`https://api.smartrecruiters.com/v1/companies/${e(slug)}/postings/${e(id)}`);
      const s = j?.jobAd?.sections || {};
      return ["jobDescription", "qualifications", "additionalInformation", "companyDescription"]
        .map((k) => s[k]?.text ? `${s[k].title || ""}\n${toText(s[k].text)}` : "").filter(Boolean).join("\n\n").trim();
    }
    if (source === "usajobs" && usajobs?.key) {
      // The search API has no lookup by job number, so search the title and keep only the result
      // whose job number matches. Never fall back to another job's text.
      const q = String(where.title || "").trim();
      if (!q) return "";
      const r = await get(`https://data.usajobs.gov/api/search?Keyword=${e(q)}&ResultsPerPage=250`, { Host: "data.usajobs.gov", "User-Agent": usajobs.email, "Authorization-Key": usajobs.key });
      // deno-lint-ignore no-explicit-any
      const d = (r?.SearchResult?.SearchResultItems || []).map((x: { MatchedObjectId?: string; MatchedObjectDescriptor?: Record<string, any> }) => ({ ...x.MatchedObjectDescriptor, _id: String(x.MatchedObjectId || "") }))
        .find((x: { _id: string; PositionURI?: string }) => x._id === id || String(x.PositionURI || "").endsWith("/" + id));
      if (!d) return "";
      const det = d.UserArea?.Details || {};
      const duties = Array.isArray(det.MajorDuties) ? det.MajorDuties.join("\n") : String(det.MajorDuties || "");
      return [det.JobSummary && `Summary\n${det.JobSummary}`, duties && `Major duties\n${duties}`, d.QualificationSummary && `Qualifications\n${d.QualificationSummary}`,
        det.Requirements && `Requirements\n${det.Requirements}`].filter(Boolean).map((t) => toText(String(t))).join("\n\n").trim();
    }
  } catch { /* fall through */ }
  return "";
}
