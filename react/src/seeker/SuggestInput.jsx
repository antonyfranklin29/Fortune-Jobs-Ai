// An input with a suggestion dropdown (ARIA combobox). Typing still works as
// free text: a suggestion is only used when the person picks it.
import React, { useEffect, useId, useRef, useState } from 'react';

function Highlight({ text, at = 0, len = 0 }) {
  if (!len || at < 0) return text;
  return <>{text.slice(0, at)}<b>{text.slice(at, at + len)}</b>{text.slice(at + len)}</>;
}

/**
 * @param {object} p
 * @param {(q:string)=>Array} p.getItems        instant suggestions
 * @param {(q:string, signal:AbortSignal)=>Promise<Array>} [p.fetchMore]  slower suggestions, merged in later
 * @param {(local:Array, remote:Array)=>Array} [p.merge]
 * @param {(item)=>{ label:string, detail?:string, at?:number, len?:number, aside?:string }} p.describe
 * @param {(item)=>void} p.onPick
 */
export function SuggestInput({ value, onChange, getItems, fetchMore, merge = (a, b) => [...a, ...b], describe, onPick, minChars = 3, listLabel, className = '', ...inputProps }) {
  const uid = useId().replace(/:/g, '');
  const listId = `${inputProps.id || 'suggest'}-${uid}-list`;
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const request = useRef(0);
  const timer = useRef(null);
  const listRef = useRef(null);

  useEffect(() => () => { clearTimeout(timer.current); request.current++; }, []);
  useEffect(() => {
    if (active >= 0) listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function close() { setOpen(false); setActive(-1); }

  function update(text) {
    onChange(text);
    const token = ++request.current;
    clearTimeout(timer.current);
    const q = text.trim();
    if (q.length < minChars) { setItems([]); close(); return; }
    const local = getItems(q);
    setItems(local); setActive(-1); setOpen(local.length > 0);
    if (!fetchMore) return;
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      try {
        const remote = await fetchMore(q, controller.signal);
        if (token !== request.current) return; // a newer keystroke won
        const merged = merge(local, remote);
        setItems(merged); setOpen(merged.length > 0);
      } catch { /* keep the instant suggestions; free text still works */ }
    }, 200);
  }

  function pick(i) {
    const item = items[i];
    if (!item) return;
    request.current++; clearTimeout(timer.current);
    onPick(item);
    setItems([]); close();
  }

  function onKeyDown(event) {
    if (!open || !items.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(active); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Tab') close();
  }

  return <span className={`suggest ${className}`}>
    <input {...inputProps} value={value} autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      onChange={(e) => update(e.target.value)} onKeyDown={onKeyDown} onBlur={() => setTimeout(close, 120)}
      onFocus={() => { if (items.length && value.trim().length >= minChars) setOpen(true); }} />
    <ul className={`suggest-list${open ? ' open' : ''}`} id={listId} role="listbox" aria-label={listLabel} ref={listRef} hidden={!open}
      onMouseDown={(e) => e.preventDefault()}>
      {open && items.map((item, i) => {
        const d = describe(item);
        return <li key={`${d.label}|${d.detail}|${i}`} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
          onMouseEnter={() => setActive(i)} onClick={() => pick(i)}>
          <span className="suggest-text"><span className="suggest-label"><Highlight text={d.label} at={d.at} len={d.len} /></span>{d.detail && <span className="suggest-detail">{d.detail}</span>}</span>
          {d.aside && <span className="suggest-aside" aria-hidden="true">{d.aside}</span>}
        </li>;
      })}
    </ul>
  </span>;
}
