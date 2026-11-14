// Visual pieces in the style of Revrag's voice agents: a call pill with a live waveform.

export function Waveform({ active = true, bars = 5 }) {
  return (
    <span className={`waveform${active ? " active" : ""}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}
    </span>
  );
}

export function AgentAvatar({ size = 40, live = false }) {
  return (
    <span className={`agent-avatar${live ? " live" : ""}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M5 10v4M9 7v10M13 4v16M17 8v8M21 11v2" /></svg>
    </span>
  );
}

const MicIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
const HangUpIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-5 0V16l-3 1.5z" /></svg>
);

/** The pill at the bottom of an agent screen: avatar, name, status, waveform and controls. */
export function CallPill({ name = "Voice coach", status = "Speaking", live = true, onMic, onEnd, micLabel, endLabel }) {
  return (
    <div className={`call-pill${live ? " live" : ""}`}>
      <AgentAvatar size={38} live={live} />
      <span className="call-pill-text">
        <strong>{name}</strong>
        <span>{status}</span>
      </span>
      <Waveform active={live} />
      {onMic ? (
        <button type="button" className="call-btn" onClick={onMic} aria-label={micLabel}><MicIcon /></button>
      ) : (
        <span className="call-btn" aria-hidden="true"><MicIcon /></span>
      )}
      {onEnd ? (
        <button type="button" className="call-btn end" onClick={onEnd} aria-label={endLabel}><HangUpIcon /></button>
      ) : (
        <span className="call-btn end" aria-hidden="true"><HangUpIcon /></span>
      )}
    </div>
  );
}
