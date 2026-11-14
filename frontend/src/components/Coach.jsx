// "Ask the coach": a floating in-app agent, in the style of Revrag's in-app agent.
// Type a question and it answers from the course content with links to the lessons it used,
// or press the mic to talk to the same coach over LiveKit, in English or an Indian language.
//
// During a voice call the worker sends JSON on the "fde.coach" text topic (voice_agent/coach_voice.py):
// finished lines for the transcript, the references behind each answer, and "navigate" when the
// learner asks to be taken to one. The panel shrinks to a call pill 10 seconds after it last
// needed attention, and opens again when new references arrive or the learner clicks it.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { AgentAvatar, Waveform } from "./Agent.jsx";
import "../coach.css";

const STORE = "fde.coach";
const LANG_STORE = "fde.coach.lang";
const TOPIC = "fde.coach";
const MINIMIZE_AFTER_MS = 10000;
const SUGGESTIONS = [
  "What's the difference between the frontend and the backend?",
  "How do I deploy P1 so it has a public URL?",
  "Where does LiveKit fit in P2?",
  "What is a webhook?",
];
const FALLBACK_LANGUAGES = [{ code: "en", name: "English" }];

function load() {
  try { return JSON.parse(sessionStorage.getItem(STORE)) || []; } catch { return []; }
}
function save(messages) {
  try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-30))); } catch { /* private mode */ }
}
function loadLang() {
  try { return localStorage.getItem(LANG_STORE) || "en"; } catch { return "en"; }
}
function saveLang(code) {
  try { localStorage.setItem(LANG_STORE, code); } catch { /* private mode */ }
}
const sourcePath = (s) => s.path || `/weeks/${s.week_id}/${s.item_id}`;
const cleanTitle = (t) => t.replace(/^Voice question: /, "Voice quiz: ");

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

function Sources({ sources, onOpen }) {
  if (!sources?.length) return null;
  return (
    <ol className="coach-sources" aria-label="From the course">
      {sources.map((s, i) => (
        <li key={i}>
          <Link to={sourcePath(s)} title={s.week} onClick={onOpen}>
            <span className="coach-cite">{s.n || i + 1}</span>{cleanTitle(s.title)}
          </Link>
        </li>
      ))}
    </ol>
  );
}

const MicIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    {off && <path d="M4 4l16 16" />}
  </svg>
);
const HangUpIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-5 0V16l-3 1.5z" /></svg>
);

/** The voice call: LiveKit room, transcript, references and mute. Lives in Coach so a
 *  minimized call (and page changes) keep it running. */
function useVoiceCall({ weekId, onAttention, onNavigate }) {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | ended | failed
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [lines, setLines] = useState([]); // {role: user|coach|note, text, refs?}
  const roomRef = useRef(null);
  const audioRef = useRef(null);
  const handlers = useRef({ onAttention, onNavigate });
  handlers.current = { onAttention, onNavigate };

  const onMessage = useCallback((msg) => {
    if (msg.type === "turn") {
      setLines((l) => [...l, { role: msg.role, text: msg.text }]);
    } else if (msg.type === "refs" && msg.refs?.length) {
      setLines((l) => [...l, { role: "refs", refs: msg.refs }]);
      handlers.current.onAttention();
    } else if (msg.type === "navigate" && msg.path) {
      setLines((l) => [...l, { role: "note", text: `Opened ${cleanTitle(msg.title || "the page")}` }]);
      handlers.current.onNavigate(msg.path);
    } else if (msg.type === "status") {
      setLines((l) => [...l, { role: "note", text: msg.text }]);
      handlers.current.onAttention();
    }
  }, []);

  const start = useCallback(async (language) => {
    setError("");
    setLines([]);
    setMuted(false);
    setStatus("connecting");
    try {
      const { url, token } = await api("/coach/voice/token", { method: "POST", body: { week_id: weekId, language } });
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room();
      roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) audioRef.current?.appendChild(track.attach());
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setSpeaking(speakers.some((p) => p.identity !== room.localParticipant.identity));
      });
      room.on(RoomEvent.Disconnected, () => { setStatus((s) => (s === "failed" ? s : "ended")); setSpeaking(false); });
      // Transcript and references arrive as text streams; the call still works without them.
      room.registerTextStreamHandler?.(TOPIC, async (reader) => {
        try { onMessage(JSON.parse(await reader.readAll())); } catch { /* ignore a bad message */ }
      });
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setStatus("live");
    } catch (e) {
      roomRef.current?.disconnect();
      setError(e.name === "NotAllowedError" ? "Allow microphone access in your browser, then try again." : e.message);
      setStatus("failed");
    }
  }, [weekId, onMessage]);

  const stop = useCallback(() => { roomRef.current?.disconnect(); setStatus("ended"); }, []);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    try {
      await room.localParticipant.setMicrophoneEnabled(!next);
      setMuted(next);
    } catch (e) {
      setError(e.message);
    }
  }, [muted]);

  useEffect(() => () => roomRef.current?.disconnect(), []);

  return { status, error, muted, speaking, lines, start, stop, toggleMute, audioRef };
}

function Transcript({ lines, onOpen }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }, [lines]);
  return (
    <div className="coach-transcript" ref={ref} aria-live="polite" aria-label="Call transcript">
      {lines.length === 0 && <p className="coach-transcript-empty">The conversation shows up here as you talk.</p>}
      {lines.map((l, i) =>
        l.role === "refs" ? (
          <div key={i} className="coach-msg assistant"><Sources sources={l.refs} onOpen={onOpen} /></div>
        ) : l.role === "note" ? (
          <p key={i} className="coach-note">{l.text}</p>
        ) : (
          <div key={i} className={`coach-msg ${l.role === "user" ? "user" : "assistant"}`}>
            <div className={`coach-bubble ${l.role === "user" ? "user" : "agent"}`}>{l.text}</div>
          </div>
        )
      )}
    </div>
  );
}

function CallControls({ call, compact = false }) {
  const status = call.status === "live" ? (call.muted ? "Muted" : call.speaking ? "Speaking" : "Listening")
    : { connecting: "Connecting…", ended: "Call ended", failed: "Call failed", idle: "Ready" }[call.status];
  return (
    <div className={`call-pill coach-call-pill${call.status === "live" ? " live" : ""}${compact ? " compact" : ""}`}>
      <AgentAvatar size={38} live={call.status === "live" && call.speaking} />
      <span className="call-pill-text"><strong>FDE Coach</strong><span>{status}</span></span>
      <Waveform active={call.status === "live" && call.speaking} />
      {call.status === "live" && (
        <button type="button" className={`call-btn${call.muted ? " muted" : ""}`} onClick={(e) => { e.stopPropagation(); call.toggleMute(); }}
          aria-pressed={call.muted} aria-label={call.muted ? "Unmute your microphone" : "Mute your microphone"}>
          <MicIcon off={call.muted} />
        </button>
      )}
      {(call.status === "live" || call.status === "connecting") && (
        <button type="button" className="call-btn end" onClick={(e) => { e.stopPropagation(); call.stop(); }} aria-label="End the call">
          <HangUpIcon />
        </button>
      )}
    </div>
  );
}

export default function Coach() {
  const location = useLocation();
  const navigate = useNavigate();
  const weekId = location.pathname.match(/^\/weeks\/([^/]+)/)?.[1] || null;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(load);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(false); // voice view (pre-call picker or the call)
  const [mini, setMini] = useState(false); // call running with the panel shrunk to a pill
  const [lang, setLang] = useState(loadLang);
  const [info, setInfo] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const timer = useRef(null);
  const hovering = useRef(false);

  const armMinimize = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!hovering.current) setMini(true); }, MINIMIZE_AFTER_MS);
  }, []);
  const attention = useCallback(() => { setOpen(true); setMini(false); armMinimize(); }, [armMinimize]);
  const call = useVoiceCall({
    weekId,
    onAttention: attention,
    onNavigate: (path) => { navigate(path); attention(); },
  });
  const live = call.status === "live" || call.status === "connecting";

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (call.status === "live") armMinimize(); }, [call.status, armMinimize]);
  useEffect(() => { if (!live) { clearTimeout(timer.current); setMini(false); } }, [live]);

  useEffect(() => save(messages), [messages]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy, open]);
  useEffect(() => {
    if (!open) return;
    if (!info) api("/coach/status").then(setInfo).catch(() => {});
    if (!voice) inputRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && (live ? setMini(true) : setOpen(false));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, info, voice, live]);

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

  function startCall() {
    saveLang(lang);
    call.start(lang);
  }
  function close() {
    if (live) { setMini(true); return; } // closing during a call just shrinks it
    setOpen(false);
    setVoice(false);
  }

  const languages = info?.languages || FALLBACK_LANGUAGES;
  const panelOpen = open && !mini;

  return (
    <>
      {panelOpen && (
        <section className="coach-panel" role="dialog" aria-label="Ask the coach"
          onMouseEnter={() => { hovering.current = true; clearTimeout(timer.current); }}
          onMouseLeave={() => { hovering.current = false; if (call.status === "live") armMinimize(); }}>
          <header className="coach-head">
            <AgentAvatar size={38} live={busy || (live && call.speaking)} />
            <div className="coach-head-text">
              <strong>FDE Coach</strong>
              <span>{voice ? "Voice call · answers from your course" : info && !info.ai ? "Searching the course for you" : "Answers from your course"}</span>
            </div>
            {live && (
              <button type="button" className="coach-icon-btn" onClick={() => setMini(true)} aria-label="Minimize the call" title="Minimize">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg>
              </button>
            )}
            {!voice && messages.length > 0 && (
              <button type="button" className="coach-icon-btn" onClick={() => setMessages([])} aria-label="Start a new chat" title="New chat">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg>
              </button>
            )}
            <button type="button" className="coach-icon-btn" onClick={close} aria-label={live ? "Minimize the call" : "Close the coach"}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>

          {voice ? (
            <div className="coach-call">
              {call.status === "idle" || call.status === "ended" || call.status === "failed" ? (
                <div className="coach-call-stage">
                  <AgentAvatar size={72} />
                  <p className="coach-call-title">{call.status === "ended" ? "Call ended" : "Talk to your coach"}</p>
                  <label className="coach-lang">
                    <span>Language</span>
                    <select value={lang} onChange={(e) => setLang(e.target.value)}>
                      {languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                    </select>
                  </label>
                  {call.error && <p className="coach-call-error" role="alert">{call.error}</p>}
                  <div className="coach-call-actions">
                    <button type="button" className="btn coach-start" onClick={startCall}>
                      {call.status === "ended" ? "Call again" : "Start the call"}
                    </button>
                    <button type="button" className="btn ghost coach-back" onClick={() => setVoice(false)}>Back to typing</button>
                  </div>
                  {call.status === "ended" && call.lines.length > 0 && <Transcript lines={call.lines} />}
                </div>
              ) : (
                <>
                  <Transcript lines={call.lines} onOpen={armMinimize} />
                  {call.error && <p className="coach-call-error" role="alert">{call.error}</p>}
                  <CallControls call={call} />
                </>
              )}
            </div>
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
                  <MicIcon />
                </button>
                <button type="submit" className="coach-send" disabled={busy || !draft.trim()} aria-label="Send">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </form>
            </>
          )}
        </section>
      )}

      {live && mini ? (
        <div className="coach-mini" role="button" tabIndex={0} aria-label="Open the coach call"
          onClick={attention} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && attention()}>
          <CallControls call={call} compact />
        </div>
      ) : (
        <button type="button" className={`coach-launcher${open ? " open" : ""}`} onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open} aria-label={open ? "Close the coach" : "Ask the coach"}>
          <AgentAvatar size={34} />
          <span>Ask the coach</span>
          <Waveform active={!open} bars={4} />
        </button>
      )}
      <div ref={call.audioRef} hidden />
    </>
  );
}
