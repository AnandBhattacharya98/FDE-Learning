import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Checks, Pipeline, Review, ScoreRing } from "./GradeCard.jsx";
import "../grader.css";

// God mode: every learner's P1/P2 submission, graded automatically.
// Data: GET /admin/grading, /admin/grading/runs/:id, POST .../regrade. Admin only on the server.

const STATUS = { queued: "Queued", running: "Sandbox", reviewing: "Reviewing", done: "Scored", error: "Error", not_configured: "Grader off" };
const ACTIVE = ["queued", "running", "reviewing"];

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Detail({ id }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api(`/admin/grading/runs/${id}`).then(setD).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <p className="notice error">{err}</p>;
  if (!d) return <p className="gm-meta">Loading the run…</p>;
  const b = d.breakdown;
  return (
    <div className="gr-detail-panel">
      <div className="gr-links">
        <a href={d.repo_url} target="_blank" rel="noreferrer">Repo ↗</a>
        {d.run_url && <a href={d.run_url} target="_blank" rel="noreferrer">GitHub Actions run ↗</a>}
        {d.repo?.commit && <span className="gm-meta">commit {d.repo.commit.slice(0, 7)} · {d.repo.files} files</span>}
        {d.seconds != null && <span className="gm-meta">{d.seconds}s in the sandbox</span>}
      </div>
      {b && <p className="gm-meta">Checks {b.checks}/{b.checks_max} · Rubric {b.review ?? "off"}{b.review != null ? `/${b.review_max}` : ""}</p>}
      {d.grader_error && <p className="notice warn">Grader fault: {d.grader_error}</p>}
      <div className="gr-two">
        <div><h5>Sandbox checks</h5>{d.checks.length ? <Checks checks={d.checks} /> : <p className="gm-meta">No checks yet.</p>}</div>
        <div><h5>Rubric review</h5>{d.review ? <Review review={d.review} /> : <p className="gm-meta">{d.status === "done" ? "Off for this run; scored on checks only." : "Waiting for the checks."}</p>}</div>
      </div>
      {Object.keys(d.submission || {}).length > 0 && (
        <details><summary>What they submitted</summary>
          <dl className="gr-sub">{Object.entries(d.submission).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
        </details>
      )}
      {d.logs?.length > 0 && (
        <details><summary>Sandbox logs ({d.logs.length})</summary>
          {d.logs.map((l, i) => <div key={i}><p className="gm-meta">$ {l.step}</p><pre className="gr-log">{l.tail || "(no output)"}</pre></div>)}
        </details>
      )}
    </div>
  );
}

export default function GraderPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [project, setProject] = useState("all");
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => api("/admin/grading").then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const active = data?.submissions.some((s) => ACTIVE.includes(s.status));
  useEffect(() => {
    const id = setInterval(load, active ? 10000 : 30000);
    return () => clearInterval(id);
  }, [load, active]);

  const rows = useMemo(() => (data?.submissions || []).filter((s) => project === "all" || s.project_id === project), [data, project]);

  async function regrade(id) {
    setBusy(id);
    try { await api(`/admin/grading/runs/${id}/regrade`, { method: "POST" }); setOpen(null); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }

  if (!data) return err ? <section className="gm-panel"><h2>Project grader</h2><p className="notice error">{err}</p></section> : null;
  const st = data.stats, setup = data.setup;
  const live = setup.github && setup.callback_key;

  return (
    <section className="gm-panel gr-panel" aria-labelledby="gr-title">
      <div className="gm-board-head">
        <h2 id="gr-title">Project grader</h2>
        <div className="gm-seg" role="group" aria-label="Filter by project">
          {[["all", "All"], ...Object.keys(data.projects).map((p) => [p, p])].map(([k, l]) => (
            <button key={k} type="button" className={project === k ? "active" : ""} aria-pressed={project === k} onClick={() => setProject(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="gr-setup">
        {[["GitHub Actions sandbox", setup.github], ["Callback key", setup.callback_key], ["Claude rubric review", setup.rubric_review]].map(([l, on]) => (
          <span key={l} className={`gr-led ${on ? "on" : "off"}`}><i aria-hidden="true" />{l}{on ? "" : " · off"}</span>
        ))}
        {!live && <span className="gm-meta">Set GRADER_GITHUB_TOKEN and GRADER_CALLBACK_KEY on Render to switch grading on (docs/project-grading.md).</span>}
      </div>

      <div className="gm-tiles gr-tiles">
        {[["Graded", st.graded, `pass mark ${data.pass_mark}`], ["Passed", st.passed, st.graded ? `${Math.round((100 * st.passed) / st.graded)}%` : "–"],
          ["Average", st.average ?? "–", "out of 100"], ["In the sandbox", st.in_progress, active ? "refreshing every 10s" : "idle"]].map(([l, n, sub]) => (
          <div key={l} className="gm-tile"><span className="gm-meta">{l}</span><strong>{n}</strong><span className="gm-meta">{sub}</span></div>
        ))}
      </div>

      {err && <p className="notice error" role="alert">{err}</p>}
      {rows.length === 0 && <p className="gm-meta">No submissions yet. A learner's project appears here the moment they save their repo link.</p>}
      <ul className="gr-rows">
        {rows.map((s) => (
          <li key={s.id} className={`gr-row ${s.status}`}>
            <div className="gr-row-main">
              <ScoreRing score={s.status === "done" ? s.score : null} passMark={data.pass_mark} size={52} />
              <div className="gr-who">
                <strong>{s.learner}</strong>
                <span className="gm-meta">{s.project_id} · {data.projects[s.project_id]?.title.replace(/^P\d: /, "")} · {s.attempts} run{s.attempts === 1 ? "" : "s"} · {ago(s.updated_at)}</span>
              </div>
              <Pipeline status={s.status} />
              <span className={`gm-status gr-status ${s.status} ${s.status === "done" ? (s.passed ? "pass" : "fail") : ""}`}>
                {s.status === "done" ? (s.passed ? "Pass" : "Below pass") : STATUS[s.status]}
              </span>
              <div className="gr-actions">
                <button type="button" className="btn link small" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? "Hide" : "Details"}</button>
                <button type="button" className="btn small" disabled={busy === s.id} onClick={() => regrade(s.id)}>{busy === s.id ? "…" : "Regrade"}</button>
              </div>
            </div>
            {s.status !== "done" && s.message && <p className="gm-meta gr-msg">{s.message}</p>}
            {open === s.id && <Detail id={s.id} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
