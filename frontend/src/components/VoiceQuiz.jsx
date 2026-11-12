import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { CallPill } from "./Agent.jsx";

export default function VoiceQuiz({ week, progress }) {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | ended
  const [error, setError] = useState("");
  const roomRef = useRef(null);
  const audioRef = useRef(null);
  const best = progress?.voice_quiz?.best;

  useEffect(() => () => { roomRef.current?.disconnect(); }, []);

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
      room.on(RoomEvent.Disconnected, () => setStatus("ended"));
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
    roomRef.current?.disconnect();
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
        {status === "ended" && <p className="small muted" role="status" style={{ marginTop: 12 }}>Call ended. Your score appears above once the coach has saved it.</p>}
        {error && <p className="notice error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
        <div ref={audioRef} hidden />
      </section>
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
