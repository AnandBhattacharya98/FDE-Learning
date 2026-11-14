import { useCallback, useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import "../godmode.css";
import "../teacher.css";
import Cohort from "../components/Cohort.jsx";
import Materials from "../components/teacher/Materials.jsx";
import Quizzes from "../components/teacher/Quizzes.jsx";
import Submissions from "../components/teacher/Submissions.jsx";
import { Icon, ago } from "../components/teacher/common.jsx";

// Teacher mode. The API decides who gets in (TEACHER_EMAILS, teachers added in God mode, or the
// admin, all signed in with Google); this page only hides itself from everyone else.

const TABS = [["overview", "Overview"], ["materials", "Materials"], ["quizzes", "Quizzes"], ["submissions", "Submissions"],
  ["cohort", "Cohort"], ["announcements", "Announcements"]];

function Overview({ data, go }) {
  const c = data.counts;
  const todo = [
    c.needs_review && [`${c.needs_review} project submission${c.needs_review === 1 ? "" : "s"} to review`, "submissions"],
    c.quizzes_draft && [`${c.quizzes_draft} quiz draft${c.quizzes_draft === 1 ? "" : "s"} to check and publish`, "quizzes"],
    c.materials - c.materials_published > 0 && [`${c.materials - c.materials_published} unpublished material${c.materials - c.materials_published === 1 ? "" : "s"}`, "materials"],
    c.stuck && [`${c.stuck} learner${c.stuck === 1 ? " looks" : "s look"} stuck`, "cohort"],
  ].filter(Boolean);
  return (
    <div className="tc-grid">
      <section className="tc-card" aria-labelledby="todo-h">
        <h2 id="todo-h">Needs you</h2>
        {todo.length === 0 ? <p className="muted">You're all caught up.</p> : (
          <ul className="tc-feed">
            {todo.map(([text, tab]) => (
              <li key={tab}><button type="button" className="btn link" onClick={() => go(tab)}>{text} →</button></li>
            ))}
          </ul>
        )}
        {!data.setup.quiz_ai && <p className="notice warn small" style={{ marginTop: 14 }}>Quiz generation is off until <code>ANTHROPIC_API_KEY</code> is set on the server.</p>}
        <h3 style={{ marginTop: 20, fontSize: "0.95rem" }}>How teacher mode works</h3>
        <ol className="small muted" style={{ paddingLeft: "1.1rem", margin: 0 }}>
          <li>Add the week's videos and slides in <strong>Materials</strong>, then publish them.</li>
          <li>In <strong>Quizzes</strong>, have Claude write a quiz from them, fix anything, publish.</li>
          <li>Review GitHub projects in <strong>Submissions</strong>; your score and feedback reach the learner.</li>
          <li>Watch <strong>Cohort</strong> for stuck learners, and post news in <strong>Announcements</strong>.</li>
        </ol>
      </section>
      <section className="tc-card" aria-labelledby="ask-h">
        <h2 id="ask-h">What learners ask the coach</h2>
        <p className="muted small">The latest questions to Ask the coach. Repeats are a sign a lesson needs more.</p>
        {data.coach_questions.length === 0 ? <p className="tc-empty">No questions yet.</p> : (
          <ul className="tc-feed">
            {data.coach_questions.map((q, i) => (
              <li key={i}><strong>{q.who}</strong> <span className="muted small">· {ago(q.at)}{q.week_id ? ` · ${q.week_id}` : ""}</span><br />{q.question}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Announcements({ weeks, onChange }) {
  const [list, setList] = useState(null);
  const [f, setF] = useState({ title: "", body: "", week_id: "", pinned: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api("/announcements").then((r) => setList(r.announcements)).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function post(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api("/teacher/announcements", { method: "POST", body: { ...f, week_id: f.week_id || null } });
      setF({ title: "", body: "", week_id: "", pinned: false });
      load(); onChange?.();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  async function remove(id) {
    await api(`/teacher/announcements/${id}`, { method: "DELETE" });
    load(); onChange?.();
  }
  async function pin(a) {
    await api(`/teacher/announcements/${a.id}`, { method: "PATCH", body: { title: a.title, body: a.body, week_id: a.week_id, pinned: !a.pinned } });
    load();
  }

  return (
    <div className="tc-grid">
      <form className="tc-card tc-form" onSubmit={post} aria-labelledby="ann-h">
        <div>
          <h2 id="ann-h">Post an announcement</h2>
          <p className="muted small" style={{ margin: 0 }}>Learners see it at the top of their home page.</p>
        </div>
        <div><label htmlFor="ann-title">Title</label><input id="ann-title" type="text" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div><label htmlFor="ann-body">Message</label><textarea id="ann-body" rows={4} maxLength={8000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
        <div className="tc-row2">
          <div>
            <label htmlFor="ann-week">About</label>
            <select id="ann-week" className="tc-select" value={f.week_id} onChange={(e) => setF({ ...f, week_id: e.target.value })}>
              <option value="">The whole course</option>
              {weeks.map((w) => <option key={w.id} value={w.id}>Week {w.number}</option>)}
            </select>
          </div>
          <label className="tc-check" style={{ alignSelf: "end" }}><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> Pin to the top</label>
        </div>
        {err && <p className="notice error" role="alert">{err}</p>}
        <button className="btn primary" type="submit" disabled={busy}>Post</button>
      </form>
      <section className="tc-card" aria-labelledby="ann-list">
        <h2 id="ann-list">Posted</h2>
        {!list && <p className="muted">Loading…</p>}
        {list?.length === 0 && <p className="tc-empty">No announcements yet.</p>}
        <div className="tc-list">
          {list?.map((a) => (
            <div key={a.id} className="tc-rowi">
              <span className="tc-row-main" style={{ cursor: "default" }}>
                <Icon name="megaphone" />
                <span style={{ minWidth: 0 }}><span className="t">{a.title}</span><span className="s">{a.author} · {ago(a.created_at)}{a.body ? ` · ${a.body}` : ""}</span></span>
              </span>
              <span className="r">
                <button type="button" className={`tc-pill tc-pill-btn ${a.pinned ? "accent" : ""}`} aria-pressed={a.pinned} onClick={() => pin(a)}>{a.pinned ? "Pinned" : "Pin"}</button>
                <button type="button" className="tc-pill tc-pill-btn bad" onClick={() => remove(a.id)} aria-label={`Delete ${a.title}`}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function Teach() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : "overview";
  const go = useCallback((t) => setParams(t === "overview" ? {} : { tab: t }), [setParams]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api("/teacher/overview").then(setData).catch((e) => setError(e.status === 404 ? "denied" : e.message)), []);
  useEffect(() => { if (user?.teacher) load(); }, [user, load]);

  if (!user?.teacher || error === "denied") return <Navigate to="/" replace />;
  const c = data?.counts;
  return (
    <div>
      <header className="tc-head">
        <div>
          <span className="eyebrow">Teacher mode</span>
          <h1>Teach</h1>
          <p className="lead" style={{ maxWidth: "60ch" }}>Add materials, turn them into quizzes, review projects and keep an eye on the cohort.</p>
        </div>
      </header>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="tc-tiles">
            {[
              ["Learners", c.learners, `${c.stuck} stuck`, "cohort", c.stuck > 0],
              ["To review", c.needs_review, `${c.submissions} projects in`, "submissions", c.needs_review > 0],
              ["Quizzes live", c.quizzes_published, `${c.quizzes_draft} draft${c.quizzes_draft === 1 ? "" : "s"}`, "quizzes", false],
              ["Materials", c.materials_published, `${c.materials - c.materials_published} unpublished`, "materials", false],
            ].map(([label, n, sub, t, alert]) => (
              <button key={label} type="button" className={`tc-tile${alert ? " alert" : ""}`} onClick={() => go(t)}>
                <span>{label}</span><strong>{n}</strong><span>{sub}</span>
              </button>
            ))}
          </div>
          <div className="tc-tabs" role="tablist" aria-label="Teacher tools">
            {TABS.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)}>
                {l}{k === "submissions" && c.needs_review > 0 && <span className="tc-badge">{c.needs_review}</span>}
              </button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === "overview" && <Overview data={data} go={go} />}
            {tab === "materials" && <Materials weeks={data.weeks} maxMb={data.setup.max_upload_mb} onChange={load} />}
            {tab === "quizzes" && <Quizzes weeks={data.weeks} onChange={load} />}
            {tab === "submissions" && <Submissions onChange={load} />}
            {tab === "cohort" && <div className="gm tc-cohort"><Cohort base="/teacher" /></div>}
            {tab === "announcements" && <Announcements weeks={data.weeks} onChange={load} />}
          </div>
        </>
      )}
    </div>
  );
}
