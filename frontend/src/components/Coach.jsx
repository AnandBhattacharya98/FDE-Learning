// "Ask the coach": a floating in-app agent, in the style of Revrag's in-app agent.
// Type a question and it answers from the course content with links to the lessons it used,
// or press the mic to talk to the same coach over LiveKit.
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api.js";
import { AgentAvatar, CallPill, Waveform } from "./Agent.jsx";
import "../coach.css";

const STORE = "fde.coach";
const SUGGESTIONS = [
  "What's the difference between the frontend and the backend?",
  "How do I deploy P1 so it has a public URL?",
  "Where does LiveKit fit in P2?",
  "What is a webhook?",
];

function load() {
  try { return JSON.parse(sessionStorage.getItem(STORE)) || []; } catch { return []; }
}
function save(messages) {
  try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-30))); } catch { /* private mode */ }
}

/** Shows the answer's paragraphs, turning [1] into a superscript that matches the source chips. */
function Answer({ text }) {
  return text.split(/\n{2,}/).map((para, i) => (
    <p key={i}>
      {para.split(/(\[\d\])/).map((part, j) =>
        /^\[\d\]$/.test(part) ? <sup key={j} className="coach-cite">{part.slice(1, -1)}</sup> : part
      )}
    </p>
  ));
}

function Sources({ sources }) {
  if (!sources?.length) return null;
  return (
    <ol className="coach-sources" aria-label="From the course">
      {sources.map((s, i) => (
        <li key={i}>
          <Link to={`/weeks/${s.week_id}/${s.item_id}`} title={s.week}>
            <span className="coach-cite">{i + 1}</span>{s.title.replace(/^Voice question: /, "Voice quiz: ")}
          </Link>
        </li>
      ))}
    </ol>
  );
}

function VoiceCall({ weekId, onClose }) {
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState("");
  const roomRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { url, token } = await api("/coach/voice/token", { method: "POST", body: { week_id: weekId } });
        const { Room, RoomEvent, Track } = await import("livekit-client");
        if (cancelled) return;
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
        setStatus("failed");
      }
    })();
    return () => { cancelled = true; roomRef.current?.disconnect(); };
  }, [weekId]);

  const end = () => { roomRef.current?.disconnect(); onClose(); };
  return (
    <div className="coach-call">
      <div className="coach-call-stage">
        <AgentAvatar size={72} live={status === "live"} />
        <p className="coach-call-title">{status === "live" ? "Ask me anything about the course" : status === "failed" ? "Voice isn't available" : "Connecting…"}</p>
        {status === "live" && <Waveform />}
        {error && <p className="coach-call-error" role="alert">{error}</p>}
      </div>
      <CallPill name="FDE Coach" live={status === "live"}
        status={{ connecting: "Connecting…", live: "Listening", ended: "Call ended", failed: "Back to typing" }[status]}
        onEnd={end} endLabel="End the call" />
      <div ref={audioRef} hidden />
    </div>
  );
}

export default function Coach() {
  const location = useLocation();
  const weekId = location.pathname.match(/^\/weeks\/([^/]+)/)?.[1] || null;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(load);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(false);
  const [info, setInfo] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => save(messages), [messages]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy, open]);
  useEffect(() => {
    if (!open) return;
    if (!info) api("/coach/status").then(setInfo).catch(() => {});
    inputRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, info]);

  async function ask(text) {
    const question = text.trim();
    if (!question || busy) return;
    const history = messages.filter((m) => !m.error).slice(-6).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: question }]);
    setDraft("");
    setBusy(true);
    try {
      const r = await api("/coach/ask", { method: "POST", body: { question, week_id: weekId, history } });
      setMessages((m) => [...m, { role: "assistant", content: r.answer, sources: r.sources, mode: r.mode }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: e.message, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <>
      {open && (
        <section className="coach-panel" role="dialog" aria-label="Ask the coach">
          <header className="coach-head">
            <AgentAvatar size={38} live={busy || voice} />
            <div className="coach-head-text">
              <strong>FDE Coach</strong>
              <span>{info && !info.ai ? "Searching the course for you" : "Answers from your course"}</span>
            </div>
            {messages.length > 0 && !voice && (
              <button type="button" className="coach-icon-btn" onClick={() => setMessages([])} aria-label="Start a new chat" title="New chat">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg>
              </button>
            )}
            <button type="button" className="coach-icon-btn" onClick={() => setOpen(false)} aria-label="Close the coach">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>

          {voice ? (
            <VoiceCall weekId={weekId} onClose={() => setVoice(false)} />
          ) : (
            <>
              <div className="coach-list" ref={listRef} aria-live="polite">
                {messages.length === 0 && (
                  <div className="coach-empty">
                    <p className="coach-bubble agent">Hi! I'm your FDE coach. Ask me anything from the course and I'll point you to the lesson it's in.</p>
                    <div className="coach-suggest">
                      {SUGGESTIONS.map((s) => <button type="button" key={s} onClick={() => ask(s)}>{s}</button>)}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`coach-msg ${m.role}`}>
                    <div className={`coach-bubble ${m.role === "user" ? "user" : "agent"}${m.error ? " error" : ""}`}>
                      {m.role === "user" ? m.content : <Answer text={m.content} />}
                    </div>
                    {m.role === "assistant" && <Sources sources={m.sources} />}
                  </div>
                ))}
                {busy && (
                  <div className="coach-msg assistant">
                    <div className="coach-bubble agent coach-typing" aria-label="The coach is thinking"><i /><i /><i /></div>
                  </div>
                )}
              </div>
              <form className="coach-input" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
                <label className="sr-only" htmlFor="coach-q">Your question</label>
                <textarea id="coach-q" ref={inputRef} rows={1} value={draft} maxLength={1000}
                  placeholder="Ask about the course…" onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(draft); } }} />
                <button type="button" className="coach-icon-btn mic" onClick={() => setVoice(true)} aria-label="Talk to the coach" title="Talk to the coach">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                </button>
                <button type="submit" className="coach-send" disabled={busy || !draft.trim()} aria-label="Send">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </form>
            </>
          )}
        </section>
      )}

      <button type="button" className={`coach-launcher${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)}
        aria-expanded={open} aria-label={open ? "Close the coach" : "Ask the coach"}>
        <AgentAvatar size={34} />
        <span>Ask the coach</span>
        <Waveform active={!open} bars={4} />
      </button>
    </>
  );
}
