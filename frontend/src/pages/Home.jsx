import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { AgentStage } from "../components/Agent.jsx";
import "../course.css";

function Bar({ done, total, label }) {
  const pct = total ? Math.round((100 * done) / total) : 0;
  return (
    <div>
      <div className="progress-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <p className="small muted" style={{ margin: "6px 0 0" }}>{done} of {total} items done</p>
    </div>
  );
}

function Ring({ pct }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r={r} className="ring-track" />
      <circle cx="32" cy="32" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
    </svg>
  );
}

const HOW = [
  { icon: "M4 5h16v11H8l-4 4z", title: "Learn the ideas", text: "Short lessons with diagrams, from how an app works to how a voice agent hears, thinks and speaks." },
  { icon: "M14 4l6 6-10 10H4v-6z", title: "Build real things", text: "Each week ends with a project you ship: a call-log app, your own voice bot, and more." },
  { icon: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3", title: "Explain it out loud", text: "A voice coach quizzes you like a client would, then tells you what you covered and what you missed." },
];

export default function Home() {
  const { user } = useAuth();
  const [course, setCourse] = useState(null);
  const [progress, setProgress] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    api("/course").then(setCourse).catch((e) => setError(e.message));
    api("/course/progress").then(setProgress).catch(() => {});
  }, []);

  const totals = Object.values(progress).reduce((a, p) => ({ done: a.done + p.done, total: a.total + p.total }), { done: 0, total: 0 });
  const pct = totals.total ? Math.round((100 * totals.done) / totals.total) : 0;
  const openWeeks = course?.weeks.filter((w) => w.open) || [];
  const nextWeek = openWeeks.find((w) => !progress[w.id] || progress[w.id].done < progress[w.id].total) || openWeeks[0];

  // The phone mock shows the learner's real weeks, like an agent filling a form.
  const fields = (course?.weeks.slice(0, 3) || []).map((w) => {
    const p = progress[w.id];
    const state = p && p.total && p.done === p.total ? "done" : w.open ? "active" : "idle";
    return { label: `Week ${w.number}`, value: w.title, state };
  });
  const first = user.name.trim().split(" ")[0];

  return (
    <div className="stack-lg">
      <section className="home-hero">
        <div className="home-hero-text">
          <span className="eyebrow">FDE training · {course?.weeks.length || 6} weeks</span>
          <h1 className="display">Hi {first}. Let's build <span className="grad-text">agents</span> that talk.</h1>
          <p className="lead">{course?.subtitle || "Six weeks from how apps work to scoping a client's solution."}</p>
          <div className="hero-actions">
            {nextWeek && (
              <Link className="btn primary" to={`/weeks/${nextWeek.id}`}>
                {totals.done ? "Continue learning" : "Start week " + nextWeek.number}
                <span aria-hidden="true">→</span>
              </Link>
            )}
            <a className="btn" href="#syllabus">See the syllabus</a>
          </div>
          {totals.total > 0 && (
            <div className="stat-row">
              <div className="stat">
                <Ring pct={pct} />
                <div><strong>{pct}%</strong><span>course complete</span></div>
              </div>
              <div className="stat"><div><strong>{totals.done}/{totals.total}</strong><span>items done</span></div></div>
              <div className="stat"><div><strong>{openWeeks.length}</strong><span>weeks open</span></div></div>
            </div>
          )}
        </div>
        {fields.length > 0 && (
          <AgentStage
            label="An agent screen showing your weeks as form fields and a voice coach speaking"
            fields={fields}
            bubble={`Nice work, ${first}. Ready for the next lesson? I'll quiz you when you're done.`}
            name="Voice coach"
            status="Speaking"
          />
        )}
      </section>

      {error && <p className="notice error" role="alert">{error}</p>}

      <section aria-labelledby="how-heading">
        <div className="section-head">
          <span className="eyebrow">How it works</span>
          <h2 id="how-heading" className="section-title">One loop, every week</h2>
        </div>
        <div className="grid-3">
          {HOW.map((h) => (
            <div key={h.title} className="card feature">
              <span className="feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d={h.icon} /></svg></span>
              <h3>{h.title}</h3>
              <p className="muted small">{h.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="syllabus" aria-labelledby="syllabus-heading">
        <div className="section-head">
          <span className="eyebrow">Syllabus</span>
          <h2 id="syllabus-heading" className="section-title">Your six weeks</h2>
        </div>
        {!course && !error && <p className="muted">Loading the syllabus…</p>}
        <div className="stack">
          {course?.weeks.map((w) => {
            const p = progress[w.id];
            const started = p && p.done > 0;
            const finished = p && p.total && p.done === p.total;
            return (
              <article key={w.number} className={`card syllabus-week${w.open ? "" : " locked"}`} aria-labelledby={`wk-${w.number}`}>
                <div className={`week-badge${finished ? " done" : ""}`} aria-hidden="true">{String(w.number).padStart(2, "0")}</div>
                <div>
                  <div className="week-label">Week {w.number}{finished ? " · completed" : ""}</div>
                  <h3 id={`wk-${w.number}`} className="week-title">{w.title}</h3>
                  <p className="muted" style={{ marginBottom: 8 }}>{w.focus}</p>
                  <p className="small" style={{ marginBottom: 0 }}>
                    <span className="build-tag">Build</span> {w.build}{w.due ? ` · due ${w.due}` : ""}
                  </p>
                  {w.modules && (
                    <ul className="module-list">
                      {w.modules.map((m) => <li key={m.id}>{m.title} <span className="muted small">· {m.items} item{m.items > 1 ? "s" : ""}</span></li>)}
                    </ul>
                  )}
                  {p && <div style={{ marginTop: 14, maxWidth: 380 }}><Bar {...p} label={`Week ${w.number} progress`} /></div>}
                </div>
                <div className="week-action">
                  {w.open ? (
                    <Link className={`btn${finished ? "" : " primary"}`} to={`/weeks/${w.id}`} aria-label={`${finished ? "Review" : started ? "Continue" : "Start"} week ${w.number}`}>
                      {finished ? "Review" : started ? "Continue" : "Start"}
                    </Link>
                  ) : (
                    <span className="pill muted-pill">Opens at the week {w.number} kickoff</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
