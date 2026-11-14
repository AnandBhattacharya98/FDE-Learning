import { useCallback, useEffect, useState } from "react";
import { api } from "../../api.js";
import { Drawer, Icon, Seg, ago } from "./common.jsx";

// Teacher mode: every learner's GitHub submission, the auto-grader's result, and the teacher's
// own decision (approve, override the score, or ask for changes) with feedback the learner sees.

const STATE = {
  needs_review: ["Needs review", "accent"], not_graded: ["Not graded", "warn"], grading: ["Grading…", ""],
  changes: ["Changes asked", "warn"], reviewed: ["Reviewed", "ok"],
};
const ACTIVE = ["queued", "running", "reviewing"];

function RepoCheck({ url }) {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    try { setR(await api(`/teacher/repo-check?url=${encodeURIComponent(url)}`)); }
    catch (e) { setR({ ok: false, problem: e.message }); } finally { setBusy(false); }
  }
  return (
    <div className="tc-section">
      <h3>Repository</h3>
      <p className="small" style={{ overflowWrap: "anywhere" }}><a href={url} target="_blank" rel="noreferrer">{url}</a></p>
      {!r && <button className="btn small-btn" onClick={check} disabled={busy}>{busy ? "Checking…" : "Check the repo on GitHub"}</button>}
      {r && !r.ok && <p className="notice error small">{r.problem}</p>}
      {r?.ok && (
        <>
          <dl className="tc-kv">
            <dt>Visibility</dt><dd>{r.private ? "Private" : "Public"}{r.fork ? " · fork" : ""}</dd>
            <dt>Language</dt><dd>{r.language || "–"}</dd>
            <dt>Last push</dt><dd>{r.pushed_at ? ago(r.pushed_at) : "–"}</dd>
            {r.last_commit && <><dt>Last commit</dt><dd>“{r.last_commit.message}” by {r.last_commit.author}, {ago(r.last_commit.at)}</dd></>}
            <dt>README</dt><dd>{r.readme ? "Yes" : "No"}</dd>
          </dl>
          {r.warnings.length > 0 && <ul className="small" style={{ color: "var(--warn-text)", marginTop: 8 }}>{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </>
      )}
    </div>
  );
}

function ReviewForm({ runId, autoScore, existing, onSaved }) {
  const [decision, setDecision] = useState(existing?.decision || (autoScore != null ? "approved" : "override"));
  const [score, setScore] = useState(existing?.score ?? autoScore ?? "");
  const [feedback, setFeedback] = useState(existing?.feedback || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      await api(`/teacher/submissions/runs/${runId}/review`, { method: "PUT", body: {
        decision, score: decision === "override" ? Number(score) : null, feedback } });
      setMsg("Saved. The learner sees this on their project page.");
      onSaved();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  async function clear() {
    await api(`/teacher/submissions/runs/${runId}/review`, { method: "DELETE" });
    setMsg("Review removed."); onSaved();
  }

  return (
    <form className="tc-section tc-form" onSubmit={save}>
      <h3>Your review</h3>
      <Seg label="Decision" value={decision} onChange={setDecision} options={[
        ...(autoScore != null ? [["approved", `Approve ${autoScore}/100`]] : []), ["override", "Set my own score"], ["changes", "Ask for changes"]]} />
      {decision === "override" && (
        <div style={{ maxWidth: 200 }}>
          <label htmlFor="rv-score">Score out of 100</label>
          <input id="rv-score" type="number" min={0} max={100} required value={score} onChange={(e) => setScore(e.target.value)} />
        </div>
      )}
      <div>
        <label htmlFor="rv-fb">Feedback for the learner{decision === "changes" ? "" : " (optional)"}</label>
        <textarea id="rv-fb" rows={5} required={decision === "changes"} value={feedback} onChange={(e) => setFeedback(e.target.value)}
          placeholder="What's good, what to fix, and where to look." />
      </div>
      {err && <p className="notice error" role="alert">{err}</p>}
      {msg && <p className="notice ok" role="status">{msg}</p>}
      <div className="tc-actions" style={{ marginTop: 0 }}>
        <button className="btn primary" type="submit" disabled={busy}>Save review</button>
        {existing && <button className="btn ghost" type="button" onClick={clear}>Remove review</button>}
      </div>
    </form>
  );
}

function Detail({ row, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const runId = row.run?.id;
  const load = useCallback(() => {
    if (runId) api(`/teacher/submissions/runs/${runId}`).then(setD).catch((e) => setErr(e.message));
  }, [runId]);
  useEffect(() => { setD(null); load(); }, [load]);

  async function regrade() {
    setBusy(true); setErr("");
    try { await api(`/teacher/submissions/${row.user_id}/${row.project_id}/grade`, { method: "POST" }); onChanged(); onClose(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const run = d || row.run;
  return (
    <Drawer label={`${row.learner}: ${row.project_title}`} onClose={onClose}>
      <span className="eyebrow">{row.project_id} · {row.project_title}</span>
      <h2 style={{ marginTop: 10 }}>{row.learner}</h2>
      <p className="small muted">Submitted {ago(row.submitted_at)} · <span className={`tc-pill ${STATE[row.state][1]}`}>{STATE[row.state][0]}</span></p>
      <RepoCheck url={row.repo_url} />

      <div className="tc-section">
        <h3>Automatic grade</h3>
        {!run && <p className="muted small">This project hasn't been auto-graded yet.</p>}
        {run && (
          <>
            <p className="small">
              {run.status === "done" ? <><strong>{run.score}/100</strong> {run.passed ? "(passes)" : `(pass mark ${run.pass_mark})`}. </> : null}
              {run.message}
              {d?.run_url && <> · <a href={d.run_url} target="_blank" rel="noreferrer">grader run</a></>}
            </p>
            {run.checks?.length > 0 && (
              <ul className="tc-checks">
                {run.checks.map((c) => (
                  <li key={c.id}><span className={`tc-pill ${c.status === "pass" ? "ok" : c.status === "fail" ? "bad" : ""}`}>{c.status}</span><span>{c.label}{c.detail ? <span className="muted"> · {c.detail}</span> : null}</span></li>
                ))}
              </ul>
            )}
            {run.review?.summary && <p className="small" style={{ marginTop: 10 }}>{run.review.summary}</p>}
            {run.review?.criteria?.length > 0 && (
              <ul className="tc-checks" style={{ marginTop: 6 }}>
                {run.review.criteria.map((c) => <li key={c.id}><span className="tc-pill accent">{c.score}/{c.max}</span><span>{c.label}<span className="muted"> · {c.comment}</span></span></li>)}
              </ul>
            )}
          </>
        )}
        {err && <p className="notice error small">{err}</p>}
        <div className="tc-actions">
          <button className="btn small-btn" onClick={regrade} disabled={busy || (run && ACTIVE.includes(run.status))}>{run ? "Regrade" : "Grade now"}</button>
        </div>
      </div>

      {runId && (run?.status === "done" || run?.status === "error" || run?.status === "not_configured") && (
        <ReviewForm key={runId} runId={runId} autoScore={run.status === "done" ? run.score : null} existing={d?.teacher_review ?? row.review}
          onSaved={() => { load(); onChanged(); }} />
      )}
    </Drawer>
  );
}

export default function Submissions({ onChange }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("needs_review");
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api("/teacher/submissions").then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  const changed = useCallback(() => { load(); onChange?.(); }, [load, onChange]);

  const rows = (data?.submissions || []).filter((r) => filter === "all" || r.state === filter);
  const key = (r) => `${r.user_id}-${r.project_id}`;
  const current = data?.submissions.find((r) => key(r) === open);
  const c = data?.counts || {};

  return (
    <section className="tc-card" aria-labelledby="sub-title">
      <div className="tc-toolbar">
        <h2 id="sub-title" style={{ margin: 0 }}>Project submissions</h2>
        <Seg label="Filter submissions" value={filter} onChange={setFilter} options={[
          ["needs_review", `Needs review (${c.needs_review || 0})`], ["changes", `Changes asked (${c.changes || 0})`],
          ["reviewed", `Reviewed (${c.reviewed || 0})`], ["all", "All"]]} />
      </div>
      <p className="muted small">Each GitHub link is cloned and checked in a sandbox, then scored against the rubric. Approve the score, set your own, or ask for changes; the learner sees your feedback on their project page.</p>
      {err && <p className="notice error">{err}</p>}
      {!data && !err && <p className="muted">Loading…</p>}
      {data && rows.length === 0 && <p className="tc-empty">{filter === "needs_review" ? "Nothing waiting for you." : "Nothing here."}</p>}
      <div className="tc-list">
        {rows.map((r) => (
          <div key={key(r)} className="tc-rowi">
            <button type="button" className="tc-row-main" onClick={() => setOpen(key(r))}>
              <Icon name="repo" />
              <span style={{ minWidth: 0 }}>
                <span className="t">{r.learner} · {r.project_id}</span>
                <span className="s">{r.repo_url.replace(/^https?:\/\/(www\.)?github\.com\//, "")} · {ago(r.submitted_at)}</span>
              </span>
            </button>
            <span className="r">
              {r.final_score != null && <span className={`tc-pill ${r.final_score >= r.pass_mark ? "ok" : "bad"}`}>{r.final_score}/100</span>}
              <span className={`tc-pill ${STATE[r.state][1]}`}>{STATE[r.state][0]}</span>
            </span>
          </div>
        ))}
      </div>
      {current && <Detail row={current} onClose={() => setOpen(null)} onChanged={changed} />}
    </section>
  );
}
