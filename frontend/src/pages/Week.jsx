import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";
import { api } from "../api.js";
import Concepts from "../components/Concepts.jsx";
import Projects from "../components/Projects.jsx";
import Quiz from "../components/Quiz.jsx";
import VoiceQuiz from "../components/VoiceQuiz.jsx";
import Resources from "../components/Resources.jsx";

const TABS = [
  ["learn", "Learn"],
  ["build", "Build"],
  ["quiz", "Quiz"],
  ["voice", "Voice quiz"],
  ["resources", "Read and watch"],
];

export default function Week() {
  const { weekId } = useParams();
  const [week, setWeek] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(() => api(`/weeks/${weekId}/progress`).then(setProgress).catch(() => {}), [weekId]);

  useEffect(() => {
    api(`/weeks/${weekId}`).then(setWeek).catch((e) => setError(e.message));
    refresh();
  }, [weekId, refresh]);

  if (error) return <p className="notice error" role="alert">{error}</p>;
  if (!week) return <p className="muted">Loading…</p>;

  const totalSteps = week.projects.reduce((n, p) => n + p.steps.length, 0);
  const doneSteps = progress ? Object.values(progress.projects).reduce((n, p) => n + p.steps_done.length, 0) : 0;
  const best = progress?.quiz?.best;

  return (
    <div>
      <div className="hero">
        <div>
          <span className="pill">Weeks {week.weeks.join("–")} · due {week.due}</span>
          <h1 style={{ marginTop: 10 }}>{week.title}</h1>
          <p className="muted">{week.goal}</p>
        </div>
        <div className="card small" aria-label="Your progress">
          <p style={{ marginBottom: 6 }}><strong>Project steps:</strong> {doneSteps} of {totalSteps}</p>
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={totalSteps} aria-valuenow={doneSteps}>
            <div style={{ width: `${totalSteps ? (100 * doneSteps) / totalSteps : 0}%` }} />
          </div>
          <p style={{ margin: "12px 0 0" }}>
            <strong>Quiz best:</strong> {best ? `${best.score} / ${best.total}` : "not taken yet"}
          </p>
        </div>
      </div>

      <nav className="tabs" aria-label="Week sections">
        {TABS.map(([path, label]) => (
          <NavLink key={path} to={path} className={({ isActive }) => (isActive ? "active" : "")}>{label}</NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<Navigate to="learn" replace />} />
        <Route path="learn" element={<Concepts week={week} />} />
        <Route path="build" element={<Projects week={week} progress={progress} onChange={refresh} />} />
        <Route path="quiz" element={<Quiz week={week} onDone={refresh} />} />
        <Route path="voice" element={<VoiceQuiz week={week} progress={progress} />} />
        <Route path="resources" element={<Resources week={week} />} />
      </Routes>
    </div>
  );
}
