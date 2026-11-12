import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import "../grader.css";

// The learner's auto-grade for one project. Data: GET /grading/:week/:project.
// Grading starts on its own when the repo link is saved; "Grade again" re-runs it.

export const STAGES = [
  ["queued", "Queued"],
  ["running", "Sandbox checks"],
  ["reviewing", "Rubric review"],
  ["done", "Scored"],
];
const ACTIVE = ["queued", "running", "reviewing"];

export function ScoreRing({ score, passMark = 70, size = 64 }) {
  const r = 26, C = 2 * Math.PI * r;
  const p = score == null ? 0 : score;
  const cls = score == null ? "" : p >= passMark ? "ok" : "bad";
  return (
    <svg className={`gr-ring ${cls}`} width={size} height={size} viewBox="0 0 64 64" role="img"
      aria-label={score == null ? "Not scored yet" : `Score ${score} out of 100`}>
      <circle cx="32" cy="32" r={r} className="gr-ring-track" />
      <circle cx="32" cy="32" r={r} className="gr-ring-arc" strokeDasharray={`${(C * p) / 100} ${C}`} transform="rotate(-90 32 32)" />
      <text x="32" y="37" textAnchor="middle">{score == null ? "–" : score}</text>
    </svg>
  );
}

export function Pipeline({ status }) {
  const at = STAGES.findIndex(([s]) => s === status);
  const failed = status === "error" || status === "not_configured";
  return (
    <ol className={`gr-pipe ${failed ? "failed" : ""}`} aria-label="Grading steps">
      {STAGES.map(([s, label], i) => {
        const state = failed ? "off" : i < at || status === "done" ? "done" : i === at ? "now" : "off";
        return <li key={s} className={state}><span className="gr-dot" aria-hidden="true" />{label}</li>;
      })}
    </ol>
  );
}

export function Checks({ checks }) {
  return (
    <ul className="gr-checks">
      {checks.map((c) => (
        <li key={c.id} className={c.status}>
          <span className="gr-mark" aria-label={c.status}>{c.status === "pass" ? "✓" : c.status === "skip" ? "–" : "✕"}</span>
          <span><strong>{c.label}</strong> <span className="gr-pts">{c.status === "skip" ? "not counted" : `${c.status === "pass" ? c.points : 0}/${c.points}`}</span>
            {c.detail && <span className="gr-detail">{c.detail}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

export function Review({ review }) {
  if (!review) return null;
  return (
    <div className="gr-review">
      {review.summary && <p>{review.summary}</p>}
      <ul className="gr-criteria">
        {review.criteria.map((c) => (
          <li key={c.id}>
            <div className="gr-crit-head"><strong>{c.label}</strong><span>{c.score}/{c.max}</span></div>
            <div className="gr-bar"><div style={{ width: `${(100 * c.score) / (c.max || 1)}%` }} /></div>
            <span className="gr-detail">{c.comment}</span>
          </li>
        ))}
      </ul>
      <div className="gr-two">
        {review.strengths?.length > 0 && <div><h5>What's working</h5><ul>{review.strengths.map((s) => <li key={s}>{s}</li>)}</ul></div>}
        {review.improvements?.length > 0 && <div><h5>To improve</h5><ul>{review.improvements.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      </div>
    </div>
  );
}

export default function GradeCard({ weekId, projectId, refreshKey }) {
  const [data, setData] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/grading/${weekId}/${projectId}`).then(setData)
    .catch((e) => (e.status === 404 ? setHidden(true) : setMsg(e.message))), [weekId, projectId]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const run = data?.run;
  useEffect(() => {
    if (!run || !ACTIVE.includes(run.status)) return undefined;
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [run, load]);

  if (hidden || !data) return null;

  async function again() {
    setBusy(true); setMsg("");
    try { await api(`/grading/${weekId}/${projectId}`, { method: "POST" }); await load(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="gr-card" aria-labelledby={`grade-${projectId}`}>
      <header className="gr-head">
        <ScoreRing score={run?.status === "done" ? run.score : null} passMark={data.rubric.pass_mark} />
        <div style={{ flex: 1 }}>
          <h4 id={`grade-${projectId}`} style={{ margin: 0 }}>Automatic review</h4>
          {!run && <p className="small muted" style={{ margin: "4px 0 0" }}>Save your GitHub repo link above and your project is checked automatically: it's cloned, installed, built and tested in a sandbox, then reviewed against the rubric. Pass mark {data.rubric.pass_mark}/100.</p>}
          {run && <p className="small muted" style={{ margin: "4px 0 0" }} role="status">
            {run.status === "done" ? (run.passed ? `Passed: ${run.score}/100.` : `${run.score}/100. The pass mark is ${run.pass_mark}.`) : ""} {run.message}
          </p>}
        </div>
        {run && !ACTIVE.includes(run.status) && (
          <button type="button" className="btn small" disabled={busy} onClick={again}>{busy ? "Starting…" : "Grade again"}</button>
        )}
      </header>
      {run && <Pipeline status={run.status} />}
      {msg && <p className="notice error" role="alert">{msg}</p>}
      {run?.checks?.length > 0 && <Checks checks={run.checks} />}
      {run?.status === "done" && <Review review={run.review} />}
    </section>
  );
}
