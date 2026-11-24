// Small shared pieces for the account and employer pages.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccountServices } from './services.jsx';
import { avatarPath } from './lib/dataSafety.js';
import logo from '../../../newsletter-logo.png';

export function LogoMark({ size = 38 }) {
  return <img className="brand-mark" src={logo} width={size} height={size} alt="" style={{ borderRadius: 10, display: 'block' }} />;
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
  const stored = fj.safeAvatarUrl(profile, user);
  // The avatars bucket is private: show the photo through a short-lived signed link.
  const path = stored ? avatarPath(stored, fj.config?.url, user && user.id) : '';
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    setSrc('');
    if (path && fj.sb?.storage) {
      fj.sb.storage.from('avatars').createSignedUrl(path, 3600)
        .then(({ data }) => { if (live && data?.signedUrl) setSrc(data.signedUrl); })
        .catch(() => {});
    }
    return () => { live = false; };
  }, [path, fj]);
  return src
    ? <img className={className} src={src} alt="" referrerPolicy="no-referrer" />
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
