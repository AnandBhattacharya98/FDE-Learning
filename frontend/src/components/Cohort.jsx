import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import "../cohort.css";

// God mode's cohort view: every learner's progress, quiz scores and who looks stuck.
// Data: GET /admin/learners (list) and /admin/learners/:id (drill-down). Admin only on the server.

const STATE = { stuck: "Stuck", not_started: "Not started", on_track: "On track", done: "Finished" };
const FILTERS = [["all", "All"], ["stuck", "Stuck"], ["not_started", "Not started"], ["on_track", "On track"], ["done", "Finished"]];
const KIND = { mcq: "Graded quiz", practice: "Practice", voice: "Voice quiz" };

function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const pct = (s) => (s && s.total ? Math.round((100 * s.score) / s.total) : null);

function Score({ s, passed }) {
  if (!s) return <span className="gm-meta">–</span>;
  const p = pct(s);
  return (
    <span className={`co-score ${passed === undefined ? "" : passed ? "ok" : "bad"}`} title={s.attempts ? `${s.attempts} attempt${s.attempts === 1 ? "" : "s"}` : undefined}>
      {s.score}/{s.total} <small>{p}%</small>
    </span>
  );
}

function Bar({ n, of, label }) {
  const p = of ? Math.round((100 * n) / of) : 0;
  return (
    <div className="co-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}>
      <div style={{ width: `${p}%` }} />
    </div>
  );
}

function Grades({ grades }) {
  if (!grades) return null;
  return Object.entries(grades).map(([id, g]) => (
    <span key={id} className={`co-chip ${g.status === "passed" ? "ok" : g.status === "failed" ? "bad" : ""}`}>
      {id} {g.score ?? "–"}/{g.max ?? "–"}
    </span>
  ));
}

function Detail({ id, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [calls, setCalls] = useState([]);
  useEffect(() => {
    setD(null);
    setCalls([]);
    api(`/admin/learners/${id}`).then(setD).catch((e) => setErr(e.message));
    api(`/admin/voice-scorecards?user_id=${id}&limit=10`).then((r) => setCalls(r.scorecards || [])).catch(() => setCalls([]));
  }, [id]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portal to <body> so the drawer covers the viewport; the gm class carries the theme tokens.
  return createPortal(
    <div className="gm co-drawer-wrap" onClick={onClose}>
      <aside className="co-drawer" role="dialog" aria-modal="true" aria-label="Learner detail" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="co-close" onClick={onClose} aria-label="Close">×</button>
        {err && <p className="notice error">{err}</p>}
        {!d && !err && <p className="gm-meta">Loading…</p>}
        {d && (
          <>
            <p className="gm-meta">Joined {ago(d.joined_at)} · last active {ago(d.last_active)}</p>
            <h3 className="co-name">{d.name}{d.is_you && <span className="co-chip">you</span>}</h3>
            <p><span className={`gm-status co-state ${d.state}`}>{STATE[d.state]}</span> <strong>{d.percent}%</strong> <span className="gm-meta">({d.done}/{d.total} items)</span></p>
            {d.flags.length > 0 && <ul className="co-flags">{d.flags.map((f) => <li key={f.code + f.label}>{f.label}</li>)}</ul>}
            {d.next_up && <p className="gm-meta">Next up: week {d.next_up.week} · {d.next_up.title}</p>}
            {d.voice?.weak_topics?.length > 0 && (
              <p>Weak topics (voice): {d.voice.weak_topics.map((t) => <span key={t} className="co-chip bad">{t}</span>)}</p>
            )}
            {d.grades && <p>Project grades: <Grades grades={d.grades} /></p>}

            {d.weeks.map((w) => (
              <section key={w.id} className="co-week">
                <h4>Week {w.number}: {w.title} <span className="gm-meta">{w.done}/{w.total}</span></h4>
                <p className="gm-meta">
                  Graded quiz <Score s={w.quiz} passed={w.quiz ? w.quiz_passed : undefined} /> · Voice <Score s={w.voice} />
                  {w.practice_avg !== null && <> · Practice avg {w.practice_avg}%</>}
                </p>
                {w.modules.map((m) => (
                  <div key={m.title} className="co-module">
                    <span className="gm-meta">{m.title}</span>
                    <div className="co-dots">
                      {m.items.map((i) => <span key={i.id} className={`co-dot ${i.done ? "on" : ""}`} title={`${i.title}${i.done ? " (done)" : ""}`} />)}
                    </div>
                  </div>
                ))}
                {w.projects.map((p) => (
                  <div key={p.id} className="co-project">
                    <span className="gm-meta">{p.title}: {p.steps_done}/{p.steps_total} steps</span>
                    <ul>
                      {p.submission.map((s) => (
                        <li key={s.label}>
                          <span className="gm-meta">{s.label}:</span>{" "}
                          {!s.value ? <em className="gm-meta">empty</em>
                            : s.kind === "url" ? <a href={s.value} target="_blank" rel="noreferrer noopener">{s.value}</a>
                              : s.value}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}

            {calls.length > 0 && (
              <section className="co-week">
                <h4>Voice quiz calls</h4>
                {calls.map((c) => (
                  <details key={c.id} className="co-call">
                    <summary>
                      <span className="gm-meta">{ago(c.created_at)} · {c.week_id}</span>{" "}
                      {c.complete ? <strong>{c.score}/{c.total}</strong> : <em className="gm-meta">ended early</em>}
                      {c.weak_topics.map((t) => <span key={t} className="co-chip bad">{t}</span>)}
                    </summary>
                    <ul className="co-transcript">
                      {c.transcript.map((t, i) => <li key={i} className={t.role}><span className="gm-meta">{t.role}:</span> {t.text}</li>)}
                    </ul>
                  </details>
                ))}
              </section>
            )}

            <section className="co-week">
              <h4>Quiz attempts</h4>
              {d.attempts.length === 0 && <p className="gm-meta">None yet.</p>}
              <ul className="co-attempts">
                {d.attempts.map((a, i) => (
                  <li key={i}><span className="gm-meta">{ago(a.at)}</span> {KIND[a.kind] || a.kind} · {a.week_id}{a.item && ` · ${a.item}`} <strong>{a.score}/{a.total}</strong></li>
                ))}
              </ul>
            </section>
          </>
        )}
      </aside>
    </div>,
    document.body,
  );
}

export default function Cohort() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);

  const load = useCallback(() => api("/admin/learners").then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.learners.filter((r) => (filter === "all" || (filter === "not_started" ? !r.last_active : r.state === filter)) && (!needle || r.name.toLowerCase().includes(needle)));
  }, [data, filter, q]);

  const close = useCallback(() => setOpen(null), []);
  const s = data?.summary;
  const weekNums = data?.learners[0]?.weeks.map((w) => w.number) || [];

  return (
    <section className="gm-panel co" aria-labelledby="co-title">
      <div className="gm-board-head">
        <h2 id="co-title">Cohort</h2>
        {s && <span className="gm-meta">rules: idle {data.rules.inactive_days}d · not started {data.rules.not_started_days}d · {data.rules.quiz_fails} failed quizzes · practice &lt; {data.rules.practice_low_percent}%</span>}
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!data && !error && <p className="gm-meta">Counting learners…</p>}
      {s && (
        <>
          <div className="co-tiles">
            {[
              ["Learners", s.learners, `avg ${s.avg_percent ?? 0}% through`],
              ["Stuck", s.stuck, "need a nudge", "bad"],
              ["Not started", s.not_started, "no activity at all"],
              ["On track", s.on_track, `${s.done} finished`, "ok"],
            ].map(([label, n, sub, tone]) => (
              <button key={label} type="button" className={`gm-tile co-tile ${tone || ""}`}
                onClick={() => setFilter({ Learners: "all", Stuck: "stuck", "Not started": "not_started", "On track": "on_track" }[label])}>
                <span className="gm-meta">{label}</span><strong>{n}</strong><span className="gm-meta">{sub}</span>
              </button>
            ))}
          </div>
          <div className="co-controls">
            <div className="gm-seg" role="group" aria-label="Filter learners">
              {FILTERS.map(([k, l]) => (
                <button key={k} type="button" className={filter === k ? "active" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            <input type="search" className="co-search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search learners" />
          </div>

          <div className="co-table-wrap">
            <table className="co-table">
              <thead>
                <tr>
                  <th scope="col">Learner</th>
                  <th scope="col">Progress</th>
                  {weekNums.map((n) => <th key={n} scope="col">Wk {n} quiz</th>)}
                  <th scope="col">Voice</th>
                  <th scope="col">Last active</th>
                  <th scope="col">Why flagged / next up</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5 + weekNums.length} className="gm-meta">Nobody here.</td></tr>}
                {rows.map((r) => {
                  const bestVoice = r.voice?.latest || r.weeks.map((w) => w.voice).filter(Boolean).sort((a, b) => pct(b) - pct(a))[0];
                  return (
                    <tr key={r.id} className={`co-row ${r.state}`} tabIndex={0} onClick={() => setOpen(r.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(r.id))}>
                      <th scope="row">
                        <span className={`co-led ${r.state}`} aria-hidden="true" />
                        {r.name}{r.is_you && <span className="co-chip">you</span>}
                        <div><span className={`gm-status co-state ${r.state}`}>{STATE[r.state]}</span></div>
                      </th>
                      <td className="co-progress"><strong>{r.percent}%</strong> <span className="gm-meta">{r.done}/{r.total}</span><Bar n={r.done} of={r.total} label={`${r.name} progress`} /></td>
                      {r.weeks.map((w) => <td key={w.id}><Score s={w.quiz} passed={w.quiz ? w.quiz_passed : undefined} /></td>)}
                      <td><Score s={bestVoice} />{r.voice?.weak_topics?.slice(0, 2).map((t) => <span key={t} className="co-chip bad">{t}</span>)}</td>
                      <td className="gm-meta">{ago(r.last_active)}</td>
                      <td>
                        {r.flags.length > 0
                          ? <ul className="co-flags">{r.flags.map((f) => <li key={f.code + f.label}>{f.label}</li>)}</ul>
                          : r.next_up ? <span className="gm-meta">Next: wk {r.next_up.week} · {r.next_up.title}</span> : <span className="gm-meta">All done</span>}
                        <Grades grades={r.grades} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="gm-meta">Click a learner for every item, project link and quiz attempt.</p>
        </>
      )}
      {open !== null && <Detail id={open} onClose={close} />}
    </section>
  );
}
