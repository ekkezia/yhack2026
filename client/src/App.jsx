import { useRef, useState, useCallback, useEffect } from "react";
import CameraView from "./components/CameraView.jsx";
import GameOverlay from "./components/GameOverlay.jsx";
import { useMotionDetection } from "./hooks/useMotionDetection.js";
import {
  detectAndScript,
  speak,
  checkAnswer,
  playBase64Audio,
} from "./services/api.js";

const NATIVE_LANGUAGE = "English"; // Language the voice script is spoken in
const TARGET_LANGUAGE = "Portuguese"; // Language the user is learning
const STILL_MS = 3000; // Must match STILL_DURATION_MS in useMotionDetection

/*
  Phase machine:
    idle      → camera not yet started
    watching  → monitoring for stillness, progress ring shown
    scanning  → still long enough, Gemini request in-flight
    speaking  → audio playing (ElevenLabs)
    guessing  → waiting for user input
    result    → showing correct/wrong feedback
*/

export default function App() {
  const videoRef = useRef(null);
  const [phase, setPhase] = useState("idle");
  const [cameraError, setCameraError] = useState(null);
  const [stillProgress, setStillProgress] = useState(0);
  const [detection, setDetection] = useState(null);
  const [guessResult, setGuessResult] = useState(null);
  const [isHandsFree, setIsHandsFree] = useState(false);
  const busyRef = useRef(false); // ref — motion callbacks always see the latest value

  // ── Motion-detection callbacks ────────────────────────────────────────────
  const handleMotion = useCallback(() => {
    setStillProgress(0);
  }, []);

  const handleCalmTick = useCallback(({ stillMs }) => {
    setStillProgress(Math.min(stillMs / STILL_MS, 1));
  }, []);

  const handleStill = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;

    setPhase("scanning");
    setStillProgress(0);

    const imageBase64 = captureFrame(videoRef.current);

    try {
      // Single Gemini call: CV + script generation together for minimum latency
      const result = await detectAndScript(
        imageBase64,
        TARGET_LANGUAGE,
        NATIVE_LANGUAGE,
      );

      if (!result.object) {
        // Nothing useful found — resume watching
        busyRef.current = false;
        setPhase("watching");
        return;
      }

      setDetection(result);
      setPhase("speaking");

      // Fetch audio and play it
      const { audioBase64, mimeType } = await speak(result.script);
      await playBase64Audio(audioBase64, mimeType);

      setPhase("guessing");
    } catch (err) {
      console.error("Game error:", err);
      busyRef.current = false;
      setPhase("watching");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { startLoop, stopLoop, captureFrame } = useMotionDetection({
    onMotion: handleMotion,
    onStill: handleStill,
    onCalmTick: handleCalmTick,
  });

  // ── Start / stop loop with phase ──────────────────────────────────────────
  useEffect(() => {
    if (phase === "watching" && videoRef.current) {
      startLoop(videoRef.current, 200);
    } else {
      stopLoop();
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Camera ready ──────────────────────────────────────────────────────────
  const handleCameraReady = useCallback(() => {
    setPhase("watching");
  }, []);

  // ── User actions ──────────────────────────────────────────────────────────
  const handleGuess = useCallback(
    async (guess) => {
      setPhase("result");
      try {
        const result = await checkAnswer(
          guess,
          detection.object,
          TARGET_LANGUAGE,
          NATIVE_LANGUAGE,
        );
        setGuessResult(result);
      } catch {
        setGuessResult({
          correct: false,
          feedback: "Could not check — try again!",
        });
      }
    },
    [detection],
  );

  const handleSkip = useCallback(() => {
    setGuessResult({ correct: false, feedback: "No worries — now you know!" });
    setPhase("result");
  }, []);

  const handlePlayAgain = useCallback(() => {
    setDetection(null);
    setGuessResult(null);
    busyRef.current = false;
    setPhase("watching");
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {cameraError ? (
        <div className="error-screen">
          <p>📷 Camera access denied</p>
          <p className="error-hint">Enable camera permissions and reload.</p>
        </div>
      ) : (
        <>
          <CameraView
            ref={videoRef}
            onReady={handleCameraReady}
            onError={setCameraError}
          />

          {phase === "idle" && (
            <div className="splash">
              <h1 className="splash-title">LinguaLens</h1>
              <p className="splash-sub">
                Point your camera at the world.
                <br />
                Hold still — we'll find something to learn.
              </p>
            </div>
          )}

          <GameOverlay
            phase={phase}
            stillProgress={stillProgress}
            detection={detection}
            guessResult={guessResult}
            onGuess={handleGuess}
            onSkip={handleSkip}
            onPlayAgain={handlePlayAgain}
            targetLanguage={TARGET_LANGUAGE}
            isHandsFree={isHandsFree}
          />

          {(phase === "watching" || phase === "scanning") && (
            <div
              style={{
                position: "absolute",
                top: "calc(var(--safe-top) + 1rem)",
                right: "1rem",
                zIndex: 30,
                display: "flex",
                gap: "0.5rem",
              }}
            >
              <div className="corner-badge" style={{ position: "static" }}>
                🌍 {TARGET_LANGUAGE}
              </div>
              <button
                className="corner-badge"
                style={{
                  position: "static",
                  cursor: "pointer",
                  background: isHandsFree ? "var(--accent)" : "var(--surface)",
                }}
                onClick={() => setIsHandsFree((prev) => !prev)}
              >
                {isHandsFree ? "🎙️ Hands-free" : "⌨️ Typing"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
