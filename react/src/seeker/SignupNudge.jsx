import React, { useState } from 'react';

const KEY = 'fja-signup-nudge-dismissed';
const read = () => { try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; } };

/** A soft, dismissible invitation for signed-out visitors once their first results are on screen. */
export function SignupNudge({ href }) {
  const [hidden, setHidden] = useState(read);
  if (hidden) return null;
  const dismiss = () => {
    try { window.localStorage.setItem(KEY, '1'); } catch { /* private mode: hide for this visit only */ }
    setHidden(true);
  };
  return <aside className="signup-nudge" aria-label="Create a free account">
    <div>
      <strong>Keep this search going.</strong>
      <span>A free account lets you save jobs, track every application and get your ATS resume score. No credit card.</span>
    </div>
    <a className="signup-nudge-cta" href={href}>Create free account</a>
    <button type="button" className="signup-nudge-close" onClick={dismiss} aria-label="Dismiss">×</button>
  </aside>;
}
