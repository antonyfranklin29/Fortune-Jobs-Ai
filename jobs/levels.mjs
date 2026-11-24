// One conservative matcher for entry-level/new-grad classification; no inferred experience.
export function entryEvidence(job = {}) {
 const title=String(job.job_title || ''),description=String(job.job_description || '').replace(/<[^>]*>/g,' ');
 const internship=/\bintern(?:ship)?\b/i.test(title) || /\bintern(?:ship)?\b/i.test(job.employment_type || '');
 const senior=/\b(?:senior|sr|principal|staff|director|lead|manager|head|vice president)\b/i.test(title);
 const titleMatch=/\b(?:entry[ -]level|junior|jr|new[ -]grad(?:uate)?|graduate|associate|early[ -]career|apprentice|intern(?:ship)?)\b/i.test(title);
 const years=/\b0\s*(?:-|–|—|to)\s*2\s*(?:years?|yrs?)\b/i.test(description);
 const noExperience=/\bno experience required\b/i.test(description);
 return {entry:!senior && (titleMatch || years || noExperience),internship,years:!senior && years,noExperience:!senior && noExperience};
}
