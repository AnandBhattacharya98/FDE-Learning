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
      <p className="small muted" style={{ margin: "6px 0 0" }}>{done} of {total} done</p>
    </div>
  );
}

// Cover art per week: base colour plus three washes (violet, coral, periwinkle family).
const COVERS = [
  { "--c1": "#2a1170", "--c2": "#7c5cff", "--c3": "#ff8a5c", "--c4": "#a9b4ff" },
  { "--c1": "#1b1650", "--c2": "#4f46e5", "--c3": "#ec4899", "--c4": "#7dd3fc" },
  { "--c1": "#3b0a2a", "--c2": "#be185d", "--c3": "#f97316", "--c4": "#c4b5fd" },
  { "--c1": "#0b2e2a", "--c2": "#0f766e", "--c3": "#a3e635", "--c4": "#6645eb" },
  { "--c1": "#14213d", "--c2": "#2563eb", "--c3": "#f59e0b", "--c4": "#22d3ee" },
  { "--c1": "#2b1408", "--c2": "#c2410c", "--c3": "#fde68a", "--c4": "#7c5cff" },
];

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
      <section>
        <div className="home-hero aura">
          <svg className="ornament" viewBox="0 0 120 28" aria-hidden="true">
            <path d="M8 14h14M98 14h14M30 14c4-10 8-10 10 0s6 10 10 0 6-10 10 0 6 10 10 0 6-10 10 0" />
          </svg>
          <span className="kicker">{course?.title || "FDE Training"} · {course?.weeks.length || 6} weeks</span>
          <h1 className="display">Welcome back, {first}.</h1>
          <p className="lead">{course?.subtitle || "Six weeks from how apps work to scoping a client's solution."}</p>
          <div className="hero-actions">
            {nextWeek && (
              <Link className="btn primary" to={`/weeks/${nextWeek.id}`}>
                {totals.done ? "Continue learning" : "Start week " + nextWeek.number}
              </Link>
            )}
            <a className="btn" href="#syllabus">View syllabus</a>
          </div>
        </div>
        <div className="hero-frame" aria-label="Your progress">
          <div className="hero-frame-inner">
            <div className="metric">
              <span>Course complete</span><strong>{pct}%</strong>
              <div className="progress-bar" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <div style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="metric"><span>Items done</span><strong>{totals.done}<small className="muted small"> / {totals.total}</small></strong></div>
            <div className="metric"><span>Weeks open</span><strong>{openWeeks.length}<small className="muted small"> / {course?.weeks.length || 6}</small></strong></div>
            {nextWeek && (
              <Link className="next-up" to={`/weeks/${nextWeek.id}`}>
                <div>
                  <small>Up next · Week {nextWeek.number}</small>
                  <strong>{nextWeek.title}</strong>
                  {nextWeekProgress && <span className="small muted">{nextWeekProgress.done} of {nextWeekProgress.total} items done</span>}
                </div>
                <span className="go" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              </Link>
            )}
          </div>
        </div>
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

      <section id="syllabus" aria-labelledby="syllabus-heading">
        <div className="section-head">
          <div>
            <span className="eyebrow">Syllabus</span>
            <h2 id="syllabus-heading" className="section-title">Six weeks, six builds</h2>
          </div>
          <span className="small muted">{openWeeks.length} of {course?.weeks.length || 6} weeks open</span>
        </div>
        {!course && !error && <p className="muted">Loading the syllabus…</p>}
        <div className="tiles">
          {course?.weeks.map((w, idx) => {
            const p = progress[w.id];
            const started = p && p.done > 0;
            const finished = p && p.total && p.done === p.total;
            const Tag = w.open ? Link : "article";
            return (
              <Tag key={w.number} className={`tile${w.open ? "" : " locked"}`} aria-labelledby={`wk-${w.number}`}
                   {...(w.open ? { to: `/weeks/${w.id}` } : {})}>
                <div className="cover" style={COVERS[idx % COVERS.length]} aria-hidden="true">
                  <div className="cover-top">
                    <span className={`cover-chip${finished ? " done" : ""}`}>
                      {finished ? "Completed" : w.open ? (started ? "In progress" : "Open") : "Opens at kickoff"}
                    </span>
                  </div>
                  <div className="cover-num"><small>Week</small>{String(w.number).padStart(2, "0")}</div>
                </div>
                <div className="tile-body">
                  <h3 id={`wk-${w.number}`} className="tile-title">{w.title}</h3>
                  <p className="tile-focus">{w.focus}</p>
                  <p className="tile-build"><b>Build:</b> {w.build}{w.due ? ` · due ${w.due}` : ""}</p>
                  {w.open && (
                    <div className="tile-foot">
                      {p && <Bar {...p} label={`Week ${w.number} progress`} />}
                      <span className="tile-cta">
                        {finished ? "Review" : started ? "Continue" : "Start"}
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                      </span>
                    </div>
                  )}
                </div>
              </Tag>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="how-heading">
        <div className="section-head">
          <div>
            <span className="eyebrow">How it works</span>
            <h2 id="how-heading" className="section-title">One loop, every week</h2>
          </div>
        </div>
        <div className="loop">
          {HOW.map((h) => (
            <div key={h.title} className="loop-item">
              <div className="loop-art aura soft" aria-hidden="true"><svg viewBox="0 0 24 24"><path d={h.icon} /></svg></div>
              <div className="loop-body">
                <h3>{h.title}</h3>
                <p>{h.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
