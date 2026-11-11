import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function Home() {
  const { user } = useAuth();
  const [weeks, setWeeks] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { api("/weeks").then(setWeeks).catch((e) => setError(e.message)); }, []);

  return (
    <div className="stack">
      <div>
        <h1>Hi {user.name.split(" ")[0]}, welcome to FDE training</h1>
        <p className="muted">Six weeks, one block at a time. Read the ideas, build the projects, then check yourself with the quizzes.</p>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!weeks && !error && <p className="muted">Loading weeks…</p>}
      <div className="grid">
        {weeks?.map((w) => (
          <Link key={w.id} to={`/weeks/${w.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <span className="pill">Week{w.weeks.length > 1 ? "s" : ""} {w.weeks.join("–")}</span>
            <h2 style={{ marginTop: 10 }}>{w.title}</h2>
            <p className="muted">{w.goal}</p>
            <p className="small"><strong>Due:</strong> {w.due}</p>
          </Link>
        ))}
        {weeks && (
          <div className="card" style={{ borderStyle: "dashed" }}>
            <span className="pill">Weeks 3–6</span>
            <h2 style={{ marginTop: 10 }}>Coming soon</h2>
            <p className="muted">Each week's material appears here after its kickoff.</p>
          </div>
        )}
      </div>
    </div>
  );
}
