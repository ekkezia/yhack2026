import { useEffect, useState } from "react";

// GameOverlay renders the heads-up UI on top of the camera feed.
// It is purely presentational — all state lives in App.jsx.

export default function GameOverlay({
  phase, // 'idle' | 'watching' | 'scanning' | 'speaking' | 'guessing' | 'result'
  stillProgress, // 0–1 (how close to triggering)
  detection, // { object, position, script, targetWord, targetPronunciation }
  guessResult, // { correct, feedback } | null
  onGuess, // (guessText) => void
  onSkip, // () => void
  onPlayAgain, // () => void
  targetLanguage,
  isHandsFree,
}) {
  if (phase === "idle") return null;

  return (
    <div className="overlay">
      {phase === "watching" && <StillProgress progress={stillProgress} />}

      {phase === "scanning" && (
        <div className="overlay-card pulse">
          <span className="scan-icon">🔍</span>
          <p>Scanning your surroundings…</p>
        </div>
      )}

      {phase === "speaking" && (
        <div className="overlay-card">
          <span className="scan-icon">🎙️</span>
          <p className="speaking-text">{detection?.script}</p>
        </div>
      )}

      {phase === "guessing" && detection && (
        <GuessPanel
          detection={detection}
          targetLanguage={targetLanguage}
          onGuess={onGuess}
          onSkip={onSkip}
          isHandsFree={isHandsFree}
        />
      )}

      {phase === "result" && guessResult && (
        <ResultPanel
          result={guessResult}
          detection={detection}
          onPlayAgain={onPlayAgain}
        />
      )}
    </div>
  );
}

function getSpeechLocale(targetLanguage) {
  const raw = String(targetLanguage || "").toLowerCase().trim();
  if (
    raw.includes("indones") ||
    raw.includes("bahasa indonesia") ||
    raw.includes("bahasa")
  ) {
    return "id-ID";
  }
  if (raw.includes("portugu")) return "pt-BR";
  if (raw.includes("spanish") || raw.includes("espanol") || raw.includes("espanhol")) {
    return "es-ES";
  }
  return "en-US";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StillProgress({ progress }) {
  const pct = Math.min(progress * 100, 100);
  return (
    <div className="still-indicator">
      <div className="still-ring" style={{ "--pct": `${pct}%` }}>
        <span>{pct < 5 ? "👀" : pct < 60 ? "🙂" : "🤩"}</span>
      </div>
      <p className="still-label">
        {pct < 5 ? "Hold still…" : pct < 99 ? "Keep it…" : "Got it!"}
      </p>
    </div>
  );
}

function GuessPanel({
  detection,
  targetLanguage,
  onGuess,
  onSkip,
  isHandsFree,
}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    if (!isHandsFree) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = getSpeechLocale(targetLanguage);
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event) => {
      const result = event.results[0][0].transcript;
      setTranscript(result);
      // Auto-submit after a brief delay
      setTimeout(() => onGuess(result), 1000);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();

    return () => {
      recognition.stop();
    };
  }, [isHandsFree, targetLanguage, onGuess]);

  function handleSubmit(e) {
    e.preventDefault();
    const val = e.target.elements.guess.value.trim();
    if (val) onGuess(val);
  }

  const posEmoji =
    { left: "👈", center: "🎯", right: "👉" }[detection.position] || "🔍";

  return (
    <div className="overlay-card guess-panel">
      <div className="position-badge">
        {posEmoji} {detection.position}
      </div>
      <p className="guess-prompt">
        What is it in <strong>{targetLanguage}</strong>?
      </p>

      {isHandsFree ? (
        <div
          className="hands-free-container"
          style={{ textAlign: "center", margin: "1rem 0" }}
        >
          <div
            className={`scan-icon ${isListening ? "pulse" : ""}`}
            style={{ fontSize: "3rem" }}
          >
            {isListening ? "🎙️" : "🤐"}
          </div>
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>
            {isListening ? "Listening for your answer..." : "Waiting..."}
          </p>
          {transcript && (
            <div
              style={{
                marginTop: "1rem",
                padding: "0.5rem",
                background: "rgba(255,255,255,0.1)",
                borderRadius: "8px",
              }}
            >
              <strong>Heard: </strong>"{transcript}"
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="guess-form">
          <input
            name="guess"
            type="text"
            className="guess-input"
            placeholder={`Type in ${targetLanguage}…`}
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck="false"
          />
          <button type="submit" className="btn btn-primary">
            Check ✓
          </button>
        </form>
      )}

      <button type="button" className="btn btn-ghost" onClick={onSkip}>
        Skip — show me
      </button>
    </div>
  );
}

function ResultPanel({ result, detection, onPlayAgain }) {
  return (
    <div className="overlay-card result-panel">
      <div className={`result-icon ${result.correct ? "correct" : "wrong"}`}>
        {result.correct ? "🎉" : "😅"}
      </div>
      <p className="result-feedback">{result.feedback}</p>
      <div className="answer-reveal">
        <span className="answer-label">It was:</span>
        <span className="answer-word">{detection.targetWord}</span>
        <span className="answer-english">({detection.object})</span>
        {detection.targetPronunciation && (
          <span className="answer-pronunciation">
            🔊 {detection.targetPronunciation}
          </span>
        )}
      </div>
      <button className="btn btn-primary" onClick={onPlayAgain}>
        Play again →
      </button>
    </div>
  );
}
