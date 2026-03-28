// GameOverlay renders the heads-up UI on top of the camera feed.
// It is purely presentational — all state lives in App.jsx.

export default function GameOverlay({
  phase,        // 'idle' | 'watching' | 'scanning' | 'speaking' | 'guessing' | 'result'
  stillProgress, // 0–1 (how close to triggering)
  detection,    // { object, position, script, targetWord, targetPronunciation }
  guessResult,  // { correct, feedback } | null
  onGuess,      // (guessText) => void
  onSkip,       // () => void
  onPlayAgain,  // () => void
  targetLanguage,
}) {
  if (phase === 'idle') return null;

  return (
    <div className="overlay">
      {phase === 'watching' && (
        <StillProgress progress={stillProgress} />
      )}

      {phase === 'scanning' && (
        <div className="overlay-card pulse">
          <span className="scan-icon">🔍</span>
          <p>Scanning your surroundings…</p>
        </div>
      )}

      {phase === 'speaking' && (
        <div className="overlay-card">
          <span className="scan-icon">🎙️</span>
          <p className="speaking-text">{detection?.script}</p>
        </div>
      )}

      {phase === 'guessing' && detection && (
        <GuessPanel
          detection={detection}
          targetLanguage={targetLanguage}
          onGuess={onGuess}
          onSkip={onSkip}
        />
      )}

      {phase === 'result' && guessResult && (
        <ResultPanel
          result={guessResult}
          detection={detection}
          onPlayAgain={onPlayAgain}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StillProgress({ progress }) {
  const pct = Math.min(progress * 100, 100);
  return (
    <div className="still-indicator">
      <div className="still-ring" style={{ '--pct': `${pct}%` }}>
        <span>{pct < 5 ? '👀' : pct < 60 ? '🙂' : '🤩'}</span>
      </div>
      <p className="still-label">{pct < 5 ? 'Hold still…' : pct < 99 ? 'Keep it…' : 'Got it!'}</p>
    </div>
  );
}

function GuessPanel({ detection, targetLanguage, onGuess, onSkip }) {
  function handleSubmit(e) {
    e.preventDefault();
    const val = e.target.elements.guess.value.trim();
    if (val) onGuess(val);
  }

  const posEmoji = { left: '👈', center: '🎯', right: '👉' }[detection.position] || '🔍';

  return (
    <div className="overlay-card guess-panel">
      <div className="position-badge">{posEmoji} {detection.position}</div>
      <p className="guess-prompt">
        What is it in <strong>{targetLanguage}</strong>?
      </p>
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
        <button type="submit" className="btn btn-primary">Check ✓</button>
      </form>
      <button type="button" className="btn btn-ghost" onClick={onSkip}>
        Skip — show me
      </button>
    </div>
  );
}

function ResultPanel({ result, detection, onPlayAgain }) {
  return (
    <div className="overlay-card result-panel">
      <div className={`result-icon ${result.correct ? 'correct' : 'wrong'}`}>
        {result.correct ? '🎉' : '😅'}
      </div>
      <p className="result-feedback">{result.feedback}</p>
      <div className="answer-reveal">
        <span className="answer-label">It was:</span>
        <span className="answer-word">{detection.targetWord}</span>
        <span className="answer-english">({detection.object})</span>
        {detection.targetPronunciation && (
          <span className="answer-pronunciation">🔊 {detection.targetPronunciation}</span>
        )}
      </div>
      <button className="btn btn-primary" onClick={onPlayAgain}>
        Play again →
      </button>
    </div>
  );
}
