// ATS readiness score panel, shared by the résumé builder and the upload page.
// The pasted job description stays in this tab; nothing is sent anywhere.
export function AtsPanel({ ats, jobText, onJobText, intro }) {
  const tone = ats.score >= 85 ? 'strong' : ats.score >= 70 ? 'good' : ats.score >= 50 ? 'work' : 'start';
  return (
    <section className="ats-card" aria-labelledby="atsTitle">
      <div className="ats-head">
        <div className={'ats-score ats-' + tone} aria-hidden="true"><span>{ats.score}</span></div>
        <div>
          <h2 id="atsTitle">ATS readiness score</h2>
          <p id="atsScore" role="status" aria-live="polite"><strong>{ats.score}/100 · {ats.grade}</strong></p>
          <p className="small">{intro || 'Checks what applicant tracking systems (ATS) and recruiters commonly look for.'} Every employer’s ATS is different, so no tool can predict your exact result.</p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="jobText">Paste a job description to check keywords (optional)</label>
        <textarea className="input" id="jobText" rows={3} maxLength={20000} value={jobText} onChange={(e) => onJobText(e.target.value)} placeholder="Paste the full job listing here. It stays in this browser tab." />
      </div>
      {ats.keywords && (
        <div id="atsKeywords" className="ats-keywords">
          <p><strong>Job keywords on your résumé:</strong> {ats.keywords.matched.length ? ats.keywords.matched.join(', ') : 'none yet'}</p>
          {ats.keywords.missing.length > 0 && <p><strong>Missing:</strong> {ats.keywords.missing.join(', ')}. Add only the ones you really have.</p>}
        </div>
      )}
      <ul id="atsChecks" className="ats-checks">
        {ats.checks.map((c) => (
          <li key={c.id} className={c.ok ? 'ok' : 'todo'}>
            <span className="ats-mark" aria-hidden="true">{c.ok ? '✓' : '!'}</span>
            <span><strong>{c.label}</strong> <span className="small">{c.points}/{c.max}</span>{c.tip && <><br /><span className="ats-tip">{c.tip}</span></>}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
