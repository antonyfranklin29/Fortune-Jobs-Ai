import React, { useState } from 'react';
import { applicationText, downloadApplication } from './applicationDocuments.js';

export function MaterialActions({ kind, result, identity, job }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(applicationText(kind, result, identity)); setMessage('Copied'); }
    catch { setMessage('Could not copy. Select and copy the text, or download the document.'); }
  }
  async function download() {
    setBusy(true); setMessage('');
    try { await downloadApplication(kind, result, identity, job); setMessage('Downloaded. Review the document and complete any placeholders before sending.'); }
    catch { setMessage('Could not download. Please try again.'); }
    finally { setBusy(false); }
  }
  return <><div className="ai-actions">
    <button type="button" onClick={copy}>Copy</button>
    <button type="button" onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download .docx'}</button>
  </div><p className="ai-disclaimer" role="status">{message || 'Review every line and complete any placeholders before sending. AI can make mistakes.'}</p></>;
}
