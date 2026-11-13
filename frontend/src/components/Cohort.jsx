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

function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function Avatar({ name, state, big }) {
  return <span className={`co-avatar ${state} ${big ? "big" : ""}`} aria-hidden="true">{initials(name)}</span>;
}

// Best graded-quiz result across weeks, as a percent, plus how many weeks were passed.
function quizSummary(weeks) {
  const taken = weeks.filter((w) => w.quiz);
  if (!taken.length) return null;
  const avg = Math.round(taken.reduce((n, w) => n + pct(w.quiz), 0) / taken.length);
  return { avg, passed: taken.filter((w) => w.quiz_passed).length, taken: taken.length, of: weeks.length };
}

function bestVoice(r) {
  return r.voice?.latest || r.weeks.map((w) => w.voice).filter(Boolean).sort((a, b) => pct(b) - pct(a))[0] || null;
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`co-stat ${tone || ""}`}>
      <span className="gm-meta">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="gm-meta">{sub}</span>}
    </div>
  );
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

  const quiz = d && quizSummary(d.weeks);
  const voice = d && bestVoice(d);
  const grades = d?.grades ? Object.entries(d.grades) : [];

  // Portal to <body> so the drawer covers the viewport; the gm class carries the theme tokens.
  return createPortal(
    <div className="gm co-drawer-wrap" onClick={onClose}>
      <aside className="co-drawer" role="dialog" aria-modal="true" aria-label={d ? `${d.name}: stats` : "Learner stats"} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="co-close" onClick={onClose} aria-label="Close">×</button>
        {err && <p className="notice error">{err}</p>}
        {!d && !err && <p className="gm-meta">Loading…</p>}
        {d && (
          <>
            <header className="co-dhead">
              <Avatar name={d.name} state={d.state} big />
              <div>
                <h3 className="co-name">{d.name}{d.is_you && <span className="co-chip">you</span>}</h3>
                <span className={`gm-status co-state ${d.state}`}>{STATE[d.state]}</span>
                <span className="gm-meta"> joined {ago(d.joined_at)} · active {ago(d.last_active)}</span>
              </div>
            </header>

            <div className="co-stats">
              <Stat label="Progress" value={`${d.percent}%`} sub={`${d.done}/${d.total} items`} />
              <Stat label="Graded quizzes" value={quiz ? `${quiz.avg}%` : "–"} sub={quiz ? `${quiz.passed}/${quiz.of} weeks passed` : "none taken"}
                tone={quiz ? (quiz.passed === quiz.taken ? "ok" : "bad") : ""} />
              <Stat label="Voice quiz" value={voice ? `${voice.score}/${voice.total}` : "–"} sub={d.voice ? `${d.voice.calls} call${d.voice.calls === 1 ? "" : "s"}` : "no calls"} />
              <Stat label="Projects" value={grades.length ? grades.map(([, g]) => g.score ?? "…").join(" · ") : "–"}
                sub={grades.length ? grades.map(([k]) => k).join(" · ") + " / 100" : "not graded"}
                tone={grades.length ? (grades.every(([, g]) => g.status === "passed") ? "ok" : grades.some(([, g]) => g.status === "failed") ? "bad" : "") : ""} />
            </div>
            <Bar n={d.done} of={d.total} label={`${d.name} progress`} />

            {d.flags.length > 0 && (
              <div className="co-alert">
                <strong>Needs a nudge</strong>
                <ul className="co-flags">{d.flags.map((f) => <li key={f.code + f.label}>{f.label}</li>)}</ul>
              </div>
            )}
            {d.next_up && <p className="co-next"><span className="gm-meta">Next up</span> Week {d.next_up.week} · {d.next_up.title}</p>}
            {d.voice?.weak_topics?.length > 0 && (
              <p className="co-weak"><span className="gm-meta">Weak topics (voice)</span> {d.voice.weak_topics.map((t) => <span key={t} className="co-chip bad">{t}</span>)}</p>
            )}

            {d.weeks.map((w) => (
              <section key={w.id} className="co-week">
                <div className="co-week-head">
                  <h4>Week {w.number}: {w.title}</h4>
                  <span className="gm-meta">{w.done}/{w.total}</span>
                </div>
                <Bar n={w.done} of={w.total} label={`Week ${w.number} progress`} />
                <dl className="co-kv">
                  <div><dt>Graded quiz</dt><dd><Score s={w.quiz} passed={w.quiz ? w.quiz_passed : undefined} /></dd></div>
                  <div><dt>Voice</dt><dd><Score s={w.voice} /></dd></div>
                  <div><dt>Practice avg</dt><dd>{w.practice_avg !== null ? <span className="co-score">{w.practice_avg}%</span> : <span className="gm-meta">–</span>}</dd></div>
                </dl>
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
                    <span className="gm-meta">{p.title}: {p.steps_done}/{p.steps_total} steps
                      {d.grades?.[p.id] && <Grades grades={{ [p.id]: d.grades[p.id] }} />}</span>
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

          <div className="co-list" role="list" aria-label="Learners">
            <div className="co-list-head" aria-hidden="true">
              <span>Learner</span><span>Progress</span><span>Scores</span><span>Last active</span><span />
            </div>
            {rows.length === 0 && <p className="gm-meta co-empty">Nobody here.</p>}
            {rows.map((r) => {
              const quiz = quizSummary(r.weeks);
              const voice = bestVoice(r);
              const grades = r.grades ? Object.entries(r.grades) : [];
              const note = r.flags[0]?.label || (r.next_up ? `Next: week ${r.next_up.week} · ${r.next_up.title}` : "All done");
              return (
                <button key={r.id} type="button" role="listitem" className={`co-row ${r.state}`} onClick={() => setOpen(r.id)}
                  aria-label={`${r.name}, ${STATE[r.state]}, ${r.percent}% done. Open stats`}>
                  <span className="co-who">
                    <Avatar name={r.name} state={r.state} />
                    <span className="co-who-text">
                      <span className="co-who-name">
                        {r.name}{r.is_you && <span className="co-chip">you</span>}
                        <span className={`gm-status co-state ${r.state}`}>{STATE[r.state]}</span>
                      </span>
                      <span className={`co-note ${r.flags.length ? "bad" : ""}`} title={r.flags.map((f) => f.label).join("\n") || note}>
                        {r.flags.length ? "▲ " : ""}{note}{r.flags.length > 1 && <span className="co-more"> +{r.flags.length - 1}</span>}
                      </span>
                    </span>
                  </span>
                  <span className="co-progress">
                    <span className="co-progress-num"><strong>{r.percent}%</strong> <span className="gm-meta">{r.done}/{r.total}</span></span>
                    <Bar n={r.done} of={r.total} label={`${r.name} progress`} />
                  </span>
                  <span className="co-scores">
                    <span className={`co-pill ${quiz ? (quiz.passed === quiz.taken ? "ok" : "bad") : "off"}`} title="Graded quizzes, average">
                      Quiz {quiz ? `${quiz.avg}%` : "–"}
                    </span>
                    <span className={`co-pill ${voice ? "" : "off"}`} title="Voice quiz, latest">Voice {voice ? `${voice.score}/${voice.total}` : "–"}</span>
                    {grades.map(([k, g]) => (
                      <span key={k} className={`co-pill ${g.status === "passed" ? "ok" : g.status === "failed" ? "bad" : ""}`} title={`Project ${k}`}>{k} {g.score ?? "…"}</span>
                    ))}
                  </span>
                  <span className="co-when gm-meta">{ago(r.last_active)}</span>
                  <span className="co-chev" aria-hidden="true">›</span>
                </button>
              );
            })}
          </div>
          <p className="gm-meta">Click a learner to see all their stats.</p>
        </>
      )}
      {open !== null && <Detail id={open} onClose={close} />}
    </section>
  );
}
