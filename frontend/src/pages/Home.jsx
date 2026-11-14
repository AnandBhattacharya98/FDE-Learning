import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import "../course.css";
import "../teacher.css";
import { Icon } from "../components/teacher/common.jsx";

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

  const [news, setNews] = useState([]);
  const [hidden, setHidden] = useState(() => {
    try { return JSON.parse(localStorage.getItem("fde.hiddenNews") || "[]"); } catch { return []; }
  });
  const hide = (id) => {
    const next = [...hidden, id];
    setHidden(next);
    try { localStorage.setItem("fde.hiddenNews", JSON.stringify(next.slice(-50))); } catch { /* private mode */ }
  };

  useEffect(() => {
    api("/announcements").then((r) => setNews(r.announcements)).catch(() => {});
    api("/course").then(setCourse).catch((e) => setError(e.message));
    api("/course/progress").then(setProgress).catch(() => {});
  }, []);

  const totals = Object.values(progress).reduce((a, p) => ({ done: a.done + p.done, total: a.total + p.total }), { done: 0, total: 0 });
  const pct = totals.total ? Math.round((100 * totals.done) / totals.total) : 0;
  const openWeeks = course?.weeks.filter((w) => w.open) || [];
  const nextWeek = openWeeks.find((w) => !progress[w.id] || progress[w.id].done < progress[w.id].total) || openWeeks[0];

  const nextWeekProgress = nextWeek && progress[nextWeek.id];
  const first = user.name.trim().split(" ")[0];

  return (
    <div className="stack-lg">
      <section className="home-hero">
        <div className="home-hero-text">
          <span className="eyebrow">{course?.title || "FDE Training"} · {course?.weeks.length || 6} weeks</span>
          <h1 className="display">Welcome back, {first}.</h1>
          <p className="lead">{course?.subtitle || "Six weeks from how apps work to scoping a client's solution."}</p>
          <div className="hero-actions">
            {nextWeek && (
              <Link className="btn primary" to={`/weeks/${nextWeek.id}`}>
                {totals.done ? "Continue learning" : "Start week " + nextWeek.number}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </Link>
            )}
            <a className="btn" href="#syllabus">View syllabus</a>
          </div>
        </div>
        <aside className="card progress-panel" aria-labelledby="progress-heading">
          <h2 id="progress-heading">Your progress</h2>
          <div className="progress-big">
            <strong>{pct}%</strong><span className="muted small">of the course</span>
          </div>
          <div className="progress-bar" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <dl className="kv">
            <dt>Items done</dt><dd>{totals.done} of {totals.total}</dd>
            <dt>Weeks open</dt><dd>{openWeeks.length} of {course?.weeks.length || 6}</dd>
          </dl>
          {nextWeek && (
            <Link className="next-up" to={`/weeks/${nextWeek.id}`}>
              <span>Up next · Week {nextWeek.number}</span>
              <strong>{nextWeek.title}</strong>
              {nextWeekProgress && <span>{nextWeekProgress.done} of {nextWeekProgress.total} items done</span>}
            </Link>
          )}
        </aside>
      </section>

      {error && <p className="notice error" role="alert">{error}</p>}

      {news.filter((a) => !hidden.includes(a.id)).length > 0 && (
        <section aria-labelledby="news-heading" style={{ marginTop: 32 }}>
          <h2 id="news-heading" className="visually-hidden">Announcements</h2>
          <div className="ann-list">
            {news.filter((a) => !hidden.includes(a.id)).slice(0, 3).map((a) => (
              <article key={a.id} className="ann">
                <Icon name="megaphone" />
                <div>
                  <h3>{a.pinned && <span className="pill" style={{ marginRight: 6 }}>Pinned</span>}{a.title}</h3>
                  {a.body && <p className="small">{a.body}</p>}
                  <span className="small muted">{a.author}{a.week_id ? ` · ${a.week_id.replace("week-0", "Week ").replace("week-", "Week ")}` : ""} · {new Date(a.created_at).toLocaleDateString()}</span>
                </div>
                <button type="button" className="btn ghost small-btn" onClick={() => hide(a.id)} aria-label={`Dismiss ${a.title}`}>Dismiss</button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="how-heading">
        <div className="section-head">
          <h2 id="how-heading" className="section-title">How each week works</h2>
        </div>
        <div className="loop">
          {HOW.map((h) => (
            <div key={h.title} className="loop-item">
              <span className="feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d={h.icon} /></svg></span>
              <div>
                <h3>{h.title}</h3>
                <p>{h.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="syllabus" aria-labelledby="syllabus-heading">
        <div className="section-head">
          <h2 id="syllabus-heading" className="section-title">Syllabus</h2>
          <span className="small muted">{openWeeks.length} of {course?.weeks.length || 6} weeks open</span>
        </div>
        {!course && !error && <p className="muted">Loading the syllabus…</p>}
        <div className="syllabus">
          {course?.weeks.map((w) => {
            const p = progress[w.id];
            const started = p && p.done > 0;
            const finished = p && p.total && p.done === p.total;
            return (
              <article key={w.number} className={`syllabus-week${w.open ? "" : " locked"}`} aria-labelledby={`wk-${w.number}`}>
                <div className={`week-badge${finished ? " done" : w.id === nextWeek?.id ? " current" : ""}`} aria-hidden="true">
                  {finished ? <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> : w.number}
                </div>
                <div>
                  <div className="week-label">Week {w.number}{finished ? " · completed" : ""}</div>
                  <h3 id={`wk-${w.number}`} className="week-title">{w.title}</h3>
                  <p className="week-focus">{w.focus}</p>
                  <p className="week-build">
                    <span className="build-tag">Build</span> {w.build}{w.due ? ` · due ${w.due}` : ""}
                  </p>
                  {w.modules && (
                    <ul className="module-list">
                      {w.modules.map((m) => <li key={m.id}>{m.title}</li>)}
                    </ul>
                  )}
                  {p && <div style={{ marginTop: 12, maxWidth: 320 }}><Bar {...p} label={`Week ${w.number} progress`} /></div>}
                </div>
                <div className="week-action">
                  {w.open ? (
                    <Link className={`btn small-btn${finished || w.id !== nextWeek?.id ? "" : " primary"}`} to={`/weeks/${w.id}`} aria-label={`${finished ? "Review" : started ? "Continue" : "Start"} week ${w.number}`}>
                      {finished ? "Review" : started ? "Continue" : "Start"}
                    </Link>
                  ) : (
                    <span className="small muted lock-note">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                      Opens at the week {w.number} kickoff
                    </span>
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
