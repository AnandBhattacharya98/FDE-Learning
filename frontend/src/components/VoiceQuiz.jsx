import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { CallPill } from "./Agent.jsx";
import { Leaderboard, Scorecard } from "./VoiceScorecard.jsx";

const POLL_MS = 3000;
const POLL_TRIES = 30; // the coach saves the card a few seconds after the call; stop looking after ~90s

export default function VoiceQuiz({ week, progress }) {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | ended
  const [error, setError] = useState("");
  const roomRef = useRef(null);
  const audioRef = useRef(null);
  const [cards, setCards] = useState(null);
  const [scoring, setScoring] = useState(false);
  const [scope, setScope] = useState("week");
  const [board, setBoard] = useState(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const pollRef = useRef(null);
  const knownRef = useRef(new Set());

  const lessonFor = useMemo(() => {
    const map = {};
    for (const m of week.modules || []) for (const i of m.items) if (i.type === "lesson" && i.ref) map[i.ref] = i.id;
    return (concept) => map[concept];
  }, [week]);

  const loadCards = useCallback(async () => {
    const { scorecards } = await api(`/weeks/${week.id}/voice-quiz/scorecards`);
    setCards(scorecards);
    return scorecards;
  }, [week.id]);

  const loadBoard = useCallback(async (which) => {
    setBoard(null);
    const q = which === "week" ? `?week_id=${encodeURIComponent(week.id)}` : "";
    try { setBoard((await api(`/voice-quiz/leaderboard${q}`)).entries); } catch { setBoard([]); }
  }, [week.id]);

  useEffect(() => {
    loadCards().then((c) => { knownRef.current = new Set(c.map((x) => x.id)); }).catch(() => setCards([]));
  }, [loadCards]);
  useEffect(() => { loadBoard(scope); }, [scope, loadBoard]);
  useEffect(() => () => { roomRef.current?.disconnect(); clearTimeout(pollRef.current); }, []);

  // After a call, look for its scorecard. The worker saves it when the coach scores you and
  // again when the call closes (with the full transcript), so keep going until it's complete.
  function waitForScorecard(tries = POLL_TRIES) {
    clearTimeout(pollRef.current);
    setScoring(true);
    pollRef.current = setTimeout(async () => {
      let fresh = null;
      try { fresh = (await loadCards()).find((c) => !knownRef.current.has(c.id)); } catch { /* try again */ }
      if (fresh?.complete) {
        knownRef.current.add(fresh.id);
        setScoring(false);
        loadBoard(scopeRef.current);
        // One more refresh picks up the goodbye lines of the transcript.
        pollRef.current = setTimeout(() => loadCards().catch(() => {}), POLL_MS * 2);
      } else if (tries > 1) {
        waitForScorecard(tries - 1);
      } else {
        setScoring(false);
      }
    }, POLL_MS);
  }

  const scored = (cards || []).filter((c) => c.complete);
  const best = scored.length
    ? scored.reduce((a, b) => (b.score / b.total > a.score / a.total ? b : a))
    : progress?.voice_quiz?.best;
  const latest = cards?.[0];

  async function start() {
    setError("");
    setStatus("connecting");
    try {
      const { url, token } = await api(`/weeks/${week.id}/voice-quiz/token`, { method: "POST" });
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room();
      roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) audioRef.current?.appendChild(track.attach());
      });
      room.on(RoomEvent.Disconnected, () => { setStatus("ended"); waitForScorecard(); });
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setStatus("live");
    } catch (e) {
      roomRef.current?.disconnect();
      setError(e.name === "NotAllowedError" ? "Allow microphone access in your browser, then try again." : e.message);
      setStatus("idle");
    }
  }

  function stop() {
    roomRef.current?.disconnect(); // fires Disconnected, which starts looking for the scorecard
    setStatus("ended");
  }

  return (
    <div className="stack">
      <section className="card voice-card">
        <div className="voice-card-text">
          <span className="eyebrow">Voice agent</span>
          <h3 className="voice-title">Talk it through with a voice coach</h3>
          <p className="muted">
            A voice agent asks you some of the questions below and listens to your answer, like a client would.
            It tells you what you covered and what you missed. It's practice: explaining out loud is the skill you'll use on client calls.
          </p>
          <p className="small"><strong>Your best so far:</strong> {best ? `${best.score} of ${best.total}` : "not tried yet"}</p>
        </div>
        <div className={`voice-stage ${status}`}>
          <CallPill
            name="Voice coach"
            live={status === "live"}
            status={{ idle: "Ready when you are", connecting: "Connecting…", live: "Listening", ended: "Call ended" }[status]}
            onEnd={status === "live" ? stop : undefined}
            endLabel="End the call"
          />
          {status === "live" ? (
            <button className="btn" onClick={stop}>End the call</button>
          ) : (
            <button className="btn primary" onClick={start} disabled={status === "connecting"}>
              {status === "connecting" ? "Connecting…" : status === "ended" ? "Start another call" : "Start the voice quiz"}
            </button>
          )}
        </div>
        {status === "live" && <p className="notice ok" role="status" style={{ marginTop: 12 }}>You're live. Your microphone is on.</p>}
        {status === "ended" && (
          <p className="small muted" role="status" style={{ marginTop: 12 }}>
            {scoring ? "Call ended. Waiting for the coach's scorecard…" : "Call ended. Your scorecard is below once the coach has saved it."}
          </p>
        )}
        {error && <p className="notice error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
        <div ref={audioRef} hidden />
      </section>
      {latest && <Scorecard key={latest.id} card={latest} week={week} lessonFor={lessonFor} />}
      {cards && cards.length > 1 && (
        <details className="card past-calls">
          <summary><strong>Earlier calls</strong> <span className="small muted">({cards.length - 1})</span></summary>
          <div className="stack" style={{ marginTop: 16 }}>
            {cards.slice(1).map((c) => <Scorecard key={c.id} card={c} week={week} lessonFor={lessonFor} />)}
          </div>
        </details>
      )}
      <Leaderboard entries={board} scope={scope} onScope={setScope} weekTitle={`Week ${week.number}`} />
      <section className="card">
        <h3>Questions you might get</h3>
        <ol style={{ paddingLeft: "1.2rem", margin: 0 }}>
          {week.voice_quiz.map((v) => (
            <li key={v.id} style={{ marginBottom: 10 }}>
              {v.prompt}
              <details className="small muted"><summary>What a good answer covers</summary>
                <ul style={{ paddingLeft: "1.1rem" }}>{v.look_for.map((l) => <li key={l}>{l}</li>)}</ul>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
