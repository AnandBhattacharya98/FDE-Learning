import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import "../course.css";

function Bar({ done, total, label }) {
  const pct = total ? Math.round((100 * done) / total) : 0;
  return (
    <div>
      <div className="progress-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <p className="small muted" style={{ margin: "4px 0 0" }}>{done} of {total} items done</p>
    </div>
  );
}

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

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <p className="muted" style={{ marginBottom: 4 }}>Welcome back, {user.name.split(" ")[0]}</p>
          <h1>{course?.title || "FDE Training"}</h1>
          {course && <p className="muted">{course.subtitle}</p>}
        </div>
        {totals.total > 0 && (
          <div className="card small"><p style={{ marginBottom: 8 }}><strong>Your progress</strong></p><Bar {...totals} label="Course progress" /></div>
        )}
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!course && !error && <p className="muted">Loading the syllabus…</p>}

      <h2 style={{ marginTop: 8 }}>Syllabus</h2>
      {course?.weeks.map((w) => {
        const p = progress[w.id];
        const started = p && p.done > 0;
        const finished = p && p.done === p.total;
        return (
          <section key={w.number} className={`card syllabus-week${w.open ? "" : " locked"}`} aria-labelledby={`wk-${w.number}`}>
            <div className="week-label">Week {w.number}</div>
            <div>
              <h3 id={`wk-${w.number}`} style={{ fontSize: "1.2rem" }}>{w.title}</h3>
              <p className="muted" style={{ marginBottom: 6 }}>{w.focus}</p>
              <p className="small" style={{ marginBottom: 0 }}><strong>Build:</strong> {w.build}{w.due ? ` · due ${w.due}` : ""}</p>
              {w.modules && (
                <ul className="module-list">
                  {w.modules.map((m) => <li key={m.id}>{m.title} <span className="muted small">· {m.items} item{m.items > 1 ? "s" : ""}</span></li>)}
                </ul>
              )}
              {p && <div style={{ marginTop: 12, maxWidth: 360 }}><Bar {...p} label={`Week ${w.number} progress`} /></div>}
            </div>
            <div>
              {w.open ? (
                <Link className={`btn${finished ? "" : " primary"}`} to={`/weeks/${w.id}`}>
                  {finished ? "Review" : started ? "Continue" : "Start"}
                </Link>
              ) : (
                <span className="pill">Opens at the week {w.number} kickoff</span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
