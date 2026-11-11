import { useState } from "react";
import { api } from "../api.js";

export default function Quiz({ week, onDone }) {
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const answered = Object.keys(answers).length;
  const byId = result ? Object.fromEntries(result.results.map((r) => [r.id, r])) : {};

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api(`/weeks/${week.id}/quiz`, { method: "POST", body: { answers } });
      setResult(r);
      onDone();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    setAnswers({});
    setResult(null);
    window.scrollTo({ top: 0 });
  }

  return (
    <form onSubmit={submit} className="stack">
      {result ? (
        <div className="notice ok" role="status">
          You scored <strong>{result.score} of {result.total}</strong>. Read the explanations below, then try again whenever you like.{" "}
          <button type="button" className="btn link" onClick={retry}>Retake the quiz</button>
        </div>
      ) : (
        <p className="muted">{week.quiz.length} questions. Answers are checked when you submit, and every attempt is saved.</p>
      )}
      {week.quiz.map((q, n) => {
        const r = byId[q.id];
        return (
          <fieldset key={q.id} className="card" style={{ margin: 0 }}>
            <legend className="small muted" style={{ padding: 0, float: "left", width: "100%" }}>Question {n + 1}</legend>
            <p style={{ clear: "both" }}><strong>{q.question}</strong></p>
            {q.options.map((opt, i) => {
              let cls = "option";
              if (r && i === r.answer) cls += " correct";
              else if (r && i === r.chosen) cls += " wrong";
              return (
                <label key={i} className={cls} style={{ fontWeight: 400, marginBottom: 0 }}>
                  <input type="radio" name={q.id} checked={answers[q.id] === i} disabled={!!result}
                         onChange={() => setAnswers({ ...answers, [q.id]: i })} />
                  <span>{opt}</span>
                </label>
              );
            })}
            {r && (
              <p className="small" style={{ marginTop: 10 }}>
                <strong style={{ color: r.correct ? "var(--ok)" : "var(--bad)" }}>{r.correct ? "Correct." : r.chosen == null ? "Not answered." : "Not quite."}</strong>{" "}
                {r.explanation}
              </p>
            )}
          </fieldset>
        );
      })}
      {error && <p className="notice error" role="alert">{error}</p>}
      {!result && (
        <button className="btn primary" type="submit" disabled={busy || answered === 0}>
          {busy ? "Checking…" : `Submit ${answered} of ${week.quiz.length} answers`}
        </button>
      )}
    </form>
  );
}
