// Small shared pieces for the account and employer pages.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccountServices } from './services.jsx';

export function LogoMark() {
  return (
    <span className="logo-icon">
      <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <path d="M3 14 L7 8 L11 14 L15 9 L19 15" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="8" r="2" fill="#0F172A" /><circle cx="15" cy="9" r="2" fill="#0F172A" /><circle cx="19" cy="15" r="2" fill="#0F172A" />
      </svg>
    </span>
  );
}

/** Top bar used by the account pages. `children` are the right-hand links. */
export function AccountNav({ children }) {
  return (
    <nav className="top-nav">
      <a href="index.html" className="logo"><LogoMark /><span className="logo-text">Fortune Jobs AI</span></a>
      {children}
    </nav>
  );
}

/** The legacy `.msg` box. kind: error | ok | info. Hidden when text is empty. */
export function StatusMessage({ text, kind = 'error', role = 'alert', id, live }) {
  return (
    <div id={id} className={`msg${text ? ` show ${kind}` : ''}`} role={role} aria-live={live}>{text}</div>
  );
}

export function Spinner() { return <span className="spinner" />; }

/** Toast with the legacy 2.6 s timing. */
export function useToast() {
  const [state, setState] = useState({ text: '', show: false });
  const timer = useRef(null);
  const toast = useCallback((text) => {
    setState({ text, show: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState((s) => ({ ...s, show: false })), 2600);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = <div className={`toast${state.show ? ' show' : ''}`} role="status">{state.text}</div>;
  return [toast, node];
}

/** Profile photo, or initials when there is no photo from our own storage. */
export function Avatar({ profile, user, className }) {
  const fj = useAccountServices();
  const url = fj.safeAvatarUrl(profile, user);
  return url
    ? <img className={className} src={url} alt="" referrerPolicy="no-referrer" />
    : <span className={className} aria-hidden="true">{fj.initials(profile && profile.full_name, user && user.email)}</span>;
}

/** "Job source Adzuna" credit with Adzuna's required size, for Adzuna listings. */
export function AdzunaCredit() {
  return (
    <div className="job-source" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid #e5e7eb', color: '#596575' }}>
      <span style={{ fontSize: 11, lineHeight: 1.4 }}>Job source</span>
      <a href="https://www.adzuna.com/" target="_blank" rel="noopener" aria-label="Jobs supplied by Adzuna"
        style={{ display: 'inline-block', minWidth: 116, minHeight: 23, font: 'normal 16px/23px Arial,sans-serif', color: 'inherit', textDecoration: 'none' }}>Adzuna</a>
    </div>
  );
}

/** Keeps document.title while a page is mounted. */
export function useDocumentTitle(title) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);
}
