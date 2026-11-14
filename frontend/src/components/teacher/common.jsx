import { useEffect } from "react";
import { createPortal } from "react-dom";
import { BASE } from "../../api.js";

export const KIND_LABEL = { video: "Video", slides: "Slides", doc: "Document", link: "Link" };

const ICONS = {
  video: "M4 6h11v12H4zM15 10l5-3v10l-5-3",
  slides: "M3 4h18v12H3zM12 16v4M8 20h8",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  quiz: "M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15M12 19h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  repo: "M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.7 4.7 0 0 0-1.3-3.2 4.4 4.4 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.4 4.4 0 0 0-.1 3.2A4.7 4.7 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 8a5 5 0 0 1 0 8M18 5a9 9 0 0 1 0 14",
};

export function Icon({ name }) {
  return (
    <span className="tc-ico" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d={ICONS[name] || ICONS.doc} /></svg>
    </span>
  );
}

export function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Signed file links come back as API paths; make them absolute for <video>/<iframe>.
export const fileHref = (path) => (path ? BASE + path : null);

export function Drawer({ label, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className="tc-drawer-wrap" onClick={onClose}>
      <aside className="tc-drawer" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="tc-close" onClick={onClose} aria-label="Close">×</button>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

export function Seg({ value, onChange, options, label }) {
  return (
    <div className="tc-seg" role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

export function WeekModuleSelect({ weeks, weekId, moduleId, onWeek, onModule, allowAll = true, idPrefix }) {
  const week = weeks.find((w) => w.id === weekId);
  return (
    <div className="tc-row2">
      <div>
        <label htmlFor={`${idPrefix}-week`}>Week</label>
        <select id={`${idPrefix}-week`} className="tc-select" value={weekId} onChange={(e) => onWeek(e.target.value)}>
          {weeks.map((w) => <option key={w.id} value={w.id}>Week {w.number}: {w.title}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-module`}>Module</label>
        <select id={`${idPrefix}-module`} className="tc-select" value={moduleId || ""} onChange={(e) => onModule(e.target.value)}>
          {allowAll && <option value="">Whole week</option>}
          {week?.modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
      </div>
    </div>
  );
}
