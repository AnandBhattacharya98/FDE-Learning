import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import "../godmode.css";
import Cohort from "../components/Cohort.jsx";

// God mode. The API decides who gets in (ADMIN_EMAILS + Google sign-in); this page only
// hides itself from everyone else.

const WEEKS = ["1–2", "3", "4", "5", "6"];
const REDUCED = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const STATUS_LABEL = { todo: "Not started", doing: "In progress", done: "Done" };
const KIND_LABEL = { build: "Build", explain: "Explain", session: "Session" };

function useScramble(text, run = true) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (!run || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setOut(text); return; }
    const glyphs = "01<>/{}[]#$%&*+=?";
    let frame = 0;
    const id = setInterval(() => {
      frame += 1;
      setOut(text.split("").map((c, i) => (c === " " || i < frame / 2 ? c : glyphs[(Math.random() * glyphs.length) | 0])).join(""));
      if (frame / 2 > text.length) clearInterval(id);
    }, 35);
    return () => clearInterval(id);
  }, [text, run]);
  return out;
}

function fmtUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/* ---------- The reactor: assignments as a machine core ---------- */

function Reactor({ assignments }) {
  const done = assignments.filter((a) => a.status === "done").length;
  const doing = assignments.filter((a) => a.status === "doing").length;
  const total = assignments.length || 1;
  const pct = Math.round((100 * done) / total);
  const C = 2 * Math.PI * 92;
  const nodes = WEEKS.map((w, i) => {
    const angle = (-90 + (360 / WEEKS.length) * i) * (Math.PI / 180);
    const items = assignments.filter((a) => a.week === w);
    const d = items.filter((a) => a.status === "done").length;
    const state = items.length && d === items.length ? "done" : items.some((a) => a.status !== "todo") ? "doing" : "todo";
    return { w, x: 250 + 205 * Math.cos(angle), y: 250 + 205 * Math.sin(angle), d, n: items.length, state, angle };
  });

  return (
    <figure className="gm-reactor" aria-label={`Machine core: ${done} of ${assignments.length} assignments done, ${doing} in progress`}>
      <svg viewBox="0 0 500 500" role="img" aria-hidden="true">
        <defs>
          <radialGradient id="gm-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--gm-core-hot)" />
            <stop offset="55%" stopColor="var(--gm-accent)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--gm-accent)" stopOpacity="0" />
          </radialGradient>
          <filter id="gm-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* circuit traces from the core to each week, with data packets riding them */}
        {nodes.map((n, i) => {
          const elbowR = 150;
          const ex = 250 + elbowR * Math.cos(n.angle), ey = 250 + elbowR * Math.sin(n.angle);
          const path = `M ${250 + 112 * Math.cos(n.angle)} ${250 + 112 * Math.sin(n.angle)} L ${ex} ${ey} L ${n.x} ${ey} L ${n.x} ${n.y}`;
          return (
            <g key={n.w} className={`gm-trace ${n.state}`}>
              <path d={path} id={`gm-trace-${i}`} />
              {n.state !== "todo" && !REDUCED && [0, 1].map((k) => (
                <circle key={k} r="3.5" className="gm-packet" filter="url(#gm-glow)">
                  <animateMotion dur={`${2.4 + i * 0.3}s`} begin={`${k * 1.2 + i * 0.2}s`} repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1" calcMode="linear">
                    <mpath href={`#gm-trace-${i}`} />
                  </animateMotion>
                </circle>
              ))}
            </g>
          );
        })}

        {/* outer gear */}
        <g className="gm-spin slow">
          <circle cx="250" cy="250" r="128" className="gm-ring faint" />
          {Array.from({ length: 48 }, (_, i) => (
            <rect key={i} x="247" y="117" width="6" height="10" rx="1.5" className="gm-tooth" transform={`rotate(${i * 7.5} 250 250)`} />
          ))}
        </g>
        {/* tick ring, counter-rotating */}
        <g className="gm-spin rev">
          {Array.from({ length: 72 }, (_, i) => (
            <line key={i} x1="250" y1="140" x2="250" y2={i % 6 ? 145 : 151} className="gm-tick" transform={`rotate(${i * 5} 250 250)`} />
          ))}
        </g>
        {/* dashed orbit with satellites */}
        <g className="gm-spin fast">
          <circle cx="250" cy="250" r="104" className="gm-ring dashed" />
          <circle cx="250" cy="146" r="4" className="gm-sat" filter="url(#gm-glow)" />
          <circle cx="354" cy="250" r="2.5" className="gm-sat" />
        </g>

        {/* progress arc */}
        <circle cx="250" cy="250" r="92" className="gm-ring track" />
        <circle cx="250" cy="250" r="92" className="gm-arc" filter="url(#gm-glow)"
          strokeDasharray={`${(C * pct) / 100} ${C}`} transform="rotate(-90 250 250)" />

        {/* the core */}
        <circle cx="250" cy="250" r="80" fill="url(#gm-core)" className="gm-pulse" />
        <circle cx="250" cy="250" r="62" className="gm-core-face" />
        <text x="250" y="247" className="gm-core-num">{pct}%</text>
        <text x="250" y="270" className="gm-core-label">{done}/{assignments.length} SHIPPED</text>

        {/* week nodes */}
        {nodes.map((n) => (
          <g key={n.w} className={`gm-node ${n.state}`} transform={`translate(${n.x} ${n.y})`}>
            <rect x="-40" y="-22" width="80" height="44" rx="10" />
            <circle cx="31" cy="-13" r="3.5" className="gm-led" />
            <text y="-2" className="gm-node-title">WK {n.w}</text>
            <text y="13" className="gm-node-sub">{n.d}/{n.n}</text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

/* ---------- Live system schematic ---------- */

function Schematic({ machine }) {
  const s = machine.services, c = machine.counts;
  const nodes = [
    { id: "web", x: 72, y: 110, label: "Browser", sub: `${c.users} users`, on: true },
    { id: "api", x: 300, y: 110, label: "FastAPI", sub: `up ${fmtUptime(machine.uptime_s)}`, on: s.api },
    { id: "db", x: 528, y: 110, label: machine.database === "postgres" ? "Postgres" : "SQLite", sub: `${c.quiz_attempts + c.steps_done + c.items_done} writes`, on: s.database },
    { id: "google", x: 300, y: 30, label: "Google", sub: s.google_sign_in ? "OAuth live" : "not set up", on: s.google_sign_in },
    { id: "lk", x: 300, y: 195, label: "LiveKit", sub: s.livekit_voice ? `${c.voice_calls} calls` : "keys missing", on: s.livekit_voice },
    { id: "claude", x: 528, y: 195, label: "Coach AI", sub: s.coach_ai ? `${c.coach_questions} questions` : "search only", on: s.coach_ai },
  ];
  const at = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const links = [["web", "api"], ["api", "db"], ["api", "google"], ["api", "lk"], ["api", "claude"]];
  return (
    <svg viewBox="0 0 600 230" className="gm-schematic" role="img"
      aria-label={`System: API online, database ${machine.database}, Google sign-in ${s.google_sign_in ? "on" : "off"}, LiveKit ${s.livekit_voice ? "on" : "off"}, coach AI ${s.coach_ai ? "on" : "off"}`}>
      {links.map(([a, b], i) => {
        const on = at[a].on && at[b].on;
        const d = `M ${at[a].x} ${at[a].y} L ${at[b].x} ${at[b].y}`;
        return (
          <g key={i} className={`gm-link ${on ? "on" : "off"}`}>
            <path d={d} id={`gm-link-${i}`} />
            {on && !REDUCED && [0, 1, 2].map((k) => (
              <circle key={k} r="3" className="gm-packet">
                <animateMotion dur="1.8s" begin={`${k * 0.6}s`} repeatCount="indefinite" keyPoints={i % 2 ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear">
                  <mpath href={`#gm-link-${i}`} />
                </animateMotion>
              </circle>
            ))}
          </g>
        );
      })}
      {nodes.map((n) => (
        <g key={n.id} className={`gm-chip ${n.on ? "on" : "off"}`} transform={`translate(${n.x} ${n.y})`}>
          {[-24, -8, 8, 24].map((p) => <line key={p} x1={p} y1="-28" x2={p} y2="-22" className="gm-pin" />)}
          {[-24, -8, 8, 24].map((p) => <line key={-p} x1={p} y1="22" x2={p} y2="28" className="gm-pin" />)}
          <rect x="-68" y="-22" width="136" height="44" rx="6" />
          <circle cx="-56" cy="-10" r="4" className="gm-led" />
          <text x="6" y="-2" className="gm-chip-title">{n.label}</text>
          <text x="6" y="14" className="gm-chip-sub">{n.sub}</text>
        </g>
      ))}
    </svg>
  );
}

/* ---------- Assignment modules ---------- */

function AssignmentCard({ a, onSave, features }) {
  const [note, setNote] = useState(a.note);
  const [busy, setBusy] = useState(false);
  useEffect(() => setNote(a.note), [a.note]);
  const save = async (status) => {
    setBusy(true);
    try { await onSave(a.id, status, note); } finally { setBusy(false); }
  };
  const p = a.progress;
  return (
    <article className={`gm-module ${a.status}`}>
      <header>
        <span className="gm-led" aria-hidden="true" />
        <div style={{ flex: 1 }}>
          <p className="gm-meta">{KIND_LABEL[a.kind] || a.kind} · due {a.due}</p>
          <h3>{a.title}</h3>
        </div>
        <span className={`gm-status ${a.status}`}>{STATUS_LABEL[a.status]}</span>
      </header>
      <ul className="gm-deliver">{a.deliver.map((d) => <li key={d}>{d}</li>)}</ul>
      {a.done_when && <p className="gm-done-when"><strong>Done when:</strong> {a.done_when}</p>}
      {p && (
        <div className="gm-gauges">
          <Gauge label="Steps" n={p.steps_done} of={p.steps_total} />
          <Gauge label="Submission" n={p.fields_done} of={p.fields_total} />
        </div>
      )}
      <div className="gm-controls">
        <div className="gm-seg" role="group" aria-label={`Status for ${a.title}`}>
          {["todo", "doing", "done"].map((s) => (
            <button key={s} type="button" disabled={busy} aria-pressed={a.manual_status === s}
              className={a.status === s ? "active" : ""} onClick={() => save(s)}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
        {a.status_source === "manual" && (
          <button type="button" className="btn link small" disabled={busy} onClick={() => save(null)}>Back to automatic</button>
        )}
        {a.status_source === "course" && <span className="gm-meta">Auto from your course checklist</span>}
      </div>
      {a.status_source === "build-log" && a.status_by && (
        <div className="gm-shipped">
          <p className="gm-meta">
            Updated by shipped work · {a.status_by.title}
            {a.status_by.pr ? <> · <a href={`${REPO}/pull/${a.status_by.pr}`} target="_blank" rel="noreferrer">PR #{a.status_by.pr}</a></> : null}
            {a.updated_at ? <> · {ago(a.updated_at)}</> : null}
          </p>
          {a.status_by.note && <p>{a.status_by.note}</p>}
        </div>
      )}
      {features.length > 0 && (
        <details className="gm-built">
          <summary>Built on this site · {features.length}</summary>
          {features.map((e) => <FeatureEntry key={e.id} e={e} />)}
        </details>
      )}
      <label className="gm-note">
        <span className="gm-meta">Note</span>
        <textarea rows={2} value={note} maxLength={2000} placeholder="Links, blockers, what's left…"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== a.note && save(a.manual_status)} />
      </label>
    </article>
  );
}

function Gauge({ label, n, of }) {
  const pct = of ? Math.round((100 * n) / of) : 0;
  return (
    <div className="gm-gauge">
      <div className="gm-gauge-head"><span>{label}</span><span>{n}/{of}</span></div>
      <div className="gm-gauge-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ---------- Build log: where and how each feature was added ---------- */

const REPO = "https://github.com/AnandBhattacharya98/FDE-Learning";

function DemoPlayer({ demo }) {
  const [shown, setShown] = useState(demo.lines.length);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);
  const play = () => {
    clearInterval(timer.current);
    if (REDUCED) { setShown(demo.lines.length); return; }
    setShown(0);
    timer.current = setInterval(() => setShown((n) => {
      if (n + 1 >= demo.lines.length) clearInterval(timer.current);
      return n + 1;
    }), 650);
  };
  return (
    <div className="gm-demo">
      <div className="gm-demo-bar">
        <span>demo · {demo.title}</span>
        <button type="button" onClick={play} aria-label={`Replay demo: ${demo.title}`}>▶ Replay</button>
      </div>
      <div className="gm-demo-body" aria-live="polite">
        {demo.lines.slice(0, shown).map((l, i) => (
          <p key={i} className={`gm-demo-${l.kind}`}>
            {l.kind === "cmd" ? "$ " : l.kind === "note" ? "# " : ""}{l.text}
          </p>
        ))}
        {shown < demo.lines.length && <p><span className="gm-caret" /></p>}
      </div>
    </div>
  );
}

function FeatureEntry({ e, inTimeline = false }) {
  const pr = e.pr ? <a href={`${REPO}/pull/${e.pr}`} target="_blank" rel="noreferrer">PR #{e.pr}</a> : null;
  return (
    <div className="gm-feature">
      {inTimeline ? (pr && <p className="gm-meta">{pr}</p>) : (
        <>
          <p className="gm-meta">{e.date}{pr && <> · {pr}</>}</p>
          <h4>{e.title}</h4>
        </>
      )}
      <div className="gm-where" aria-label="Where in the code">
        {e.where.map((w) => <code key={w}>{w}</code>)}
      </div>
      <ul className="gm-how">{e.how.map((h) => <li key={h}>{h}</li>)}</ul>
      <DemoPlayer demo={e.demo} />
    </div>
  );
}

function BuildLog({ entries }) {
  return (
    <section className="gm-panel">
      <div className="gm-board-head">
        <h2>Build log</h2>
        <span className="gm-meta">{entries.length} features shipped · newest first</span>
      </div>
      <ol className="gm-timeline">
        {entries.map((e, i) => (
          <li key={e.id}>
            <details open={i === 0}>
              <summary>
                <span className="gm-meta">{e.date}{e.pr ? ` · #${e.pr}` : ""}</span>
                <strong>{e.title}</strong>
              </summary>
              <FeatureEntry e={e} inTimeline />
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- Event log ---------- */

function Terminal({ events }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setShown(events.length); return; }
    setShown(0);
    const id = setInterval(() => setShown((s) => (s >= events.length ? (clearInterval(id), s) : s + 1)), 120);
    return () => clearInterval(id);
  }, [events]);
  return (
    <div className="gm-terminal" role="log" aria-label="Recent activity">
      <div className="gm-term-bar"><i /><i /><i /><span>activity.log</span></div>
      <div className="gm-term-body">
        {events.length === 0 && <p>&gt; waiting for the first learner…<span className="gm-caret" /></p>}
        {events.slice(0, shown).map((e, i) => (
          <p key={i}><span className="t">[{ago(e.at)}]</span> <span className={`k k-${e.kind}`}>{e.kind}</span> {e.who} {e.what}</p>
        ))}
        {events.length > 0 && <p>&gt;<span className="gm-caret" /></p>}
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

export default function GodMode() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const title = useScramble("GOD MODE", !!data);
  const timer = useRef(null);

  const load = useCallback(() => api("/admin/overview").then(setData).catch((e) => setError(e.status === 404 ? "denied" : e.message)), []);
  useEffect(() => {
    if (!user?.admin) return;
    load();
    timer.current = setInterval(load, 30000);
    return () => clearInterval(timer.current);
  }, [user, load]);

  const save = useCallback(async (id, status, note) => {
    await api(`/admin/assignments/${id}`, { method: "PUT", body: { status, note } });
    await load();
  }, [load]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const list = data.assignments.filter((a) => filter === "all" || a.status === filter);
    return WEEKS.map((w) => ({ w, items: list.filter((a) => a.week === w) })).filter((g) => g.items.length);
  }, [data, filter]);

  const featureById = useMemo(() => Object.fromEntries((data?.build_log || []).map((e) => [e.id, e])), [data]);

  if (!user?.admin || error === "denied") return <Navigate to="/" replace />;

  const c = data?.machine.counts;
  return (
    <div className="gm">
      <div className="gm-grid-bg" aria-hidden="true" />
      <div className="gm-scan" aria-hidden="true" />

      <section className="gm-head">
        <div>
          <p className="gm-meta">Root access · {data ? data.admin.name : "…"}</p>
          <h1 className="gm-title" aria-label="God mode">{title}</h1>
          <p className="gm-sub">Inside the machine: your required FDE assignments, and every moving part of this site, live.</p>
        </div>
        {data && (
          <div className="gm-status-line">
            <span className="gm-led on" aria-hidden="true" /> core online · {data.machine.database} · refreshes every 30s
          </div>
        )}
      </section>

      {error && <p className="notice error" role="alert">{error}</p>}
      {!data && !error && <p className="gm-meta">Booting the core…</p>}

      {data && (
        <>
          <section className="gm-hero">
            <Reactor assignments={data.assignments} />
            <div className="gm-side">
              <div className="gm-panel">
                <h2>System schematic</h2>
                <Schematic machine={data.machine} />
              </div>
              <div className="gm-tiles">
                {[
                  ["Learners", c.users, `+${c.users_24h} today · ${c.coach_questions} coach Qs`],
                  ["Quiz attempts", c.quiz_attempts, `${c.voice_calls} by voice`],
                  ["Items finished", c.items_done, `${c.steps_done} project steps`],
                  ["Submissions", c.submissions, `${data.machine.content.weeks_open}/${data.machine.content.weeks_planned} weeks open`],
                ].map(([label, n, sub]) => (
                  <div key={label} className="gm-tile"><span className="gm-meta">{label}</span><strong>{n}</strong><span className="gm-meta">{sub}</span></div>
                ))}
              </div>
            </div>
          </section>

          <Cohort />

          <section className="gm-panel">
            <div className="gm-board-head">
              <h2>Assignment bus</h2>
              <div className="gm-seg" role="group" aria-label="Filter assignments">
                {[["all", "All"], ["todo", "Not started"], ["doing", "In progress"], ["done", "Done"]].map(([k, l]) => (
                  <button key={k} type="button" className={filter === k ? "active" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
            </div>
            {grouped.length === 0 && <p className="gm-meta">Nothing here.</p>}
            {grouped.map((g) => (
              <div key={g.w} className="gm-board">
                <div className="gm-board-label"><span>WEEK {g.w}</span></div>
                <div className="gm-modules">{g.items.map((a) => <AssignmentCard key={a.id} a={a} onSave={save}
                  features={a.features.map((id) => featureById[id]).filter(Boolean)} />)}</div>
              </div>
            ))}
          </section>

          <BuildLog entries={data.build_log} />

          <Terminal events={data.machine.events} />
        </>
      )}
    </div>
  );
}
