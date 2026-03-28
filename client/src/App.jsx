import { useRef, useState, useEffect, useCallback } from "react";
import CameraView from "./components/CameraView.jsx";
import {
  speak,
  phoneStart,
  phoneReply,
  phoneStruggle,
  phoneFound,
  phoneCheckCv,
} from "./services/api.js";

const NATIVE_LANGUAGE = "English";
const TARGET_LANGUAGE = "Portuguese";

function captureFrame(videoEl, quality = 0.8) {
  if (!videoEl) return null;
  const c = document.createElement("canvas");
  c.width = videoEl.videoWidth || 640;
  c.height = videoEl.videoHeight || 480;
  if (c.width === 0 || c.height === 0) return null;
  c.getContext("2d").drawImage(videoEl, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/jpeg", quality);
  return dataUrl.split(",")[1];
}

const PhoneIcon = ({ style }) => (
  <svg
    viewBox="0 0 24 24"
    width="36"
    height="36"
    fill="currentColor"
    style={style}
  >
    <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
  </svg>
);

export default function App() {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [phase, setPhase] = useState("ringing");
  const [cameraError, setCameraError] = useState(null);
  const [callData, setCallData] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const isSearchingRef = useRef(false);
  const searchStartTimeRef = useRef(0);
  const searchIntervalRef = useRef(null);
  const struggledRef = useRef(false);

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
  };

  const endCall = () => {
    stopAudio();
    setPhase("idle");
    isSearchingRef.current = false;
    clearTimeout(searchIntervalRef.current);
  };

  useEffect(() => {
    const isActiveCall = [
      "connecting",
      "speaking_intro",
      "listening_preference",
      "processing_preference",
      "speaking_task",
      "searching",
      "speaking_struggle",
      "speaking_found",
    ].includes(phase);

    if (isActiveCall) {
      const int = setInterval(() => setCallDuration((d) => d + 1), 1000);
      return () => clearInterval(int);
    } else if (phase === "ringing") {
      setCallDuration(0);
    }
  }, [phase]);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const acceptCall = async () => {
    setPhase("connecting");
    setCallDuration(0);
    try {
      const startData = await phoneStart(TARGET_LANGUAGE, NATIVE_LANGUAGE);
      setCallData({
        friendName: startData.friendName,
        targetObject: startData.targetObject,
        targetObjectTranslated: startData.targetObjectTranslated,
        struggled: false,
      });

      const { audioBase64, mimeType } = await speak(startData.script);
      setPhase("speaking_intro");
      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current === audio) setPhase("listening_preference");
      };
      await audio.play();
    } catch (err) {
      console.error(err);
      setPhase("error");
    }
  };

  const processPreference = useCallback(
    async (spokenText) => {
      setPhase("processing_preference");
      setTranscript(spokenText);

      try {
        const replyData = await phoneReply(
          spokenText,
          callData.friendName,
          callData.targetObject,
          callData.targetObjectTranslated,
          TARGET_LANGUAGE,
          NATIVE_LANGUAGE,
        );

        setCallData((prev) => ({
          ...prev,
          chosenLanguage: replyData.chosenLanguage,
        }));

        const { audioBase64, mimeType } = await speak(replyData.script);
        setPhase("speaking_task");
        const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
        audioRef.current = audio;
        audio.onended = () => {
          if (audioRef.current === audio) setPhase("searching");
        };
        await audio.play();
      } catch (err) {
        console.error(err);
        setPhase("error");
      }
    },
    [callData],
  );

  useEffect(() => {
    if (phase !== "listening_preference") return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    let gotResult = false;
    const isActiveRef = { current: true };

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      gotResult = true;
      const result = event.results[0][0].transcript;
      processPreference(result);
    };
    recognition.onerror = (e) => {
      console.error("Speech recognition error:", e);
    };
    recognition.onend = () => {
      setIsListening(false);
      if (
        !gotResult &&
        isActiveRef.current &&
        phase === "listening_preference"
      ) {
        try {
          recognition.start();
        } catch (e) {}
      }
    };

    recognition.start();

    return () => {
      isActiveRef.current = false;
      recognition.stop();
    };
  }, [phase, processPreference]);

  const handleStruggle = useCallback(async () => {
    isSearchingRef.current = false;
    setPhase("speaking_struggle");

    try {
      const stData = await phoneStruggle(
        callData.friendName,
        callData.targetObject,
        TARGET_LANGUAGE,
        NATIVE_LANGUAGE,
      );

      setCallData((prev) => ({ ...prev, struggled: true }));

      const { audioBase64, mimeType } = await speak(stData.script);
      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current === audio) setPhase("searching");
      };
      await audio.play();
    } catch (err) {
      console.error(err);
      setPhase("searching");
    }
  }, [callData]);

  const handleFound = useCallback(async () => {
    setPhase("speaking_found");
    try {
      const fData = await phoneFound(
        callData.friendName,
        callData.targetObject,
        callData.targetObjectTranslated,
        callData.chosenLanguage,
        struggledRef.current || callData.struggled,
        TARGET_LANGUAGE,
        NATIVE_LANGUAGE,
      );

      const { audioBase64, mimeType } = await speak(fData.script);
      const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current === audio) setPhase("done");
      };
      await audio.play();
    } catch (err) {
      console.error(err);
      setPhase("done");
    }
  }, [callData]);

  useEffect(() => {
    if (phase !== "searching") return;

    isSearchingRef.current = true;
    searchStartTimeRef.current = Date.now();
    struggledRef.current = false;

    const checkLoop = async () => {
      if (!isSearchingRef.current || !videoRef.current) return;

      const frame = captureFrame(videoRef.current);
      if (frame) {
        try {
          const cvRes = await phoneCheckCv(frame, callData.targetObject);
          if (cvRes.found) {
            isSearchingRef.current = false;
            handleFound();
            return;
          }
        } catch (e) {
          console.error("CV error", e);
        }
      }

      const elapsed = Date.now() - searchStartTimeRef.current;
      if (
        elapsed > 15000 &&
        !struggledRef.current &&
        callData.chosenLanguage === TARGET_LANGUAGE
      ) {
        struggledRef.current = true;
        handleStruggle();
      } else {
        if (isSearchingRef.current) {
          searchIntervalRef.current = setTimeout(checkLoop, 2000);
        }
      }
    };

    checkLoop();

    return () => {
      isSearchingRef.current = false;
      clearTimeout(searchIntervalRef.current);
    };
  }, [phase, callData, handleFound, handleStruggle]);

  const isActiveCallPhase = [
    "connecting",
    "speaking_intro",
    "listening_preference",
    "processing_preference",
    "speaking_task",
    "speaking_struggle",
    "speaking_found",
    "error",
  ].includes(phase);

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
            onReady={() => {}}
            onError={setCameraError}
          />

          {/* Incoming Call Screen */}
          {phase === "ringing" && (
            <div className="ios-call-screen">
              <div className="ios-caller-info">
                <div className="ios-avatar">👤</div>
                <h2 className="ios-caller-name">Unknown Caller</h2>
                <p className="ios-caller-status">LinguaLens Video</p>
              </div>

              <div className="ios-actions">
                <div className="ios-action-col">
                  <button className="ios-btn ios-btn-decline" onClick={endCall}>
                    <PhoneIcon style={{ transform: "rotate(135deg)" }} />
                  </button>
                  <span className="ios-action-label">Decline</span>
                </div>
                <div className="ios-action-col">
                  <button
                    className="ios-btn ios-btn-accept"
                    onClick={acceptCall}
                  >
                    <PhoneIcon />
                  </button>
                  <span className="ios-action-label">Accept</span>
                </div>
              </div>
            </div>
          )}

          {/* Active Call Blurred Overlay */}
          {isActiveCallPhase && (
            <div className="ios-active-call">
              <div className="ios-active-header">
                <h2 className="ios-active-name">
                  {callData?.friendName || "Connecting..."}
                </h2>
                <p className="ios-active-time">
                  {phase === "connecting"
                    ? "connecting..."
                    : formatTime(callDuration)}
                </p>

                <div
                  style={{
                    marginTop: "1rem",
                    fontSize: "1rem",
                    color: "var(--accent)",
                    minHeight: "24px",
                  }}
                >
                  {phase === "listening_preference" && (
                    <span className="pulse">
                      🎙️ Listening... (Say English or Portuguese)
                    </span>
                  )}
                  {phase === "processing_preference" && (
                    <span>Thinking...</span>
                  )}
                  {phase.startsWith("speaking") && (
                    <span className="pulse">🗣️ Speaking...</span>
                  )}
                  {phase === "error" && (
                    <span style={{ color: "var(--red)" }}>
                      Connection Error
                    </span>
                  )}
                </div>
                {transcript && phase === "processing_preference" && (
                  <div
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.9rem",
                      color: "white",
                    }}
                  >
                    "{transcript}"
                  </div>
                )}

                {/* Fallback skip buttons for desktop/testing */}
                {phase === "listening_preference" && (
                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      justifyContent: "center",
                      marginTop: "15px",
                    }}
                  >
                    <button
                      className="btn btn-ghost"
                      style={{
                        padding: "5px 10px",
                        fontSize: "0.8rem",
                        border: "1px solid rgba(255,255,255,0.2)",
                      }}
                      onClick={() => processPreference("English")}
                    >
                      Skip → English
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{
                        padding: "5px 10px",
                        fontSize: "0.8rem",
                        border: "1px solid rgba(255,255,255,0.2)",
                      }}
                      onClick={() => processPreference("Portuguese")}
                    >
                      Skip → Portuguese
                    </button>
                  </div>
                )}
              </div>

              <div className="ios-call-grid">
                <div className="ios-grid-item">
                  <button className="ios-grid-btn">🔇</button>
                  <span className="ios-grid-label">mute</span>
                </div>
                <div className="ios-grid-item">
                  <button className="ios-grid-btn">🔢</button>
                  <span className="ios-grid-label">keypad</span>
                </div>
                <div className="ios-grid-item">
                  <button className="ios-grid-btn">🔊</button>
                  <span className="ios-grid-label">audio</span>
                </div>
                <div className="ios-grid-item">
                  <button className="ios-grid-btn">➕</button>
                  <span className="ios-grid-label">add call</span>
                </div>
                <div className="ios-grid-item">
                  <button className="ios-grid-btn active">🎥</button>
                  <span className="ios-grid-label">FaceTime</span>
                </div>
                <div className="ios-grid-item">
                  <button className="ios-grid-btn">👤</button>
                  <span className="ios-grid-label">contacts</span>
                </div>
              </div>

              <button className="ios-btn-end" onClick={endCall}>
                <PhoneIcon style={{ transform: "rotate(135deg)" }} />
              </button>
            </div>
          )}

          {/* Searching Phase (Clear Camera View) */}
          {phase === "searching" && (
            <div
              className="ios-active-call"
              style={{
                background: "transparent",
                backdropFilter: "none",
                WebkitBackdropFilter: "none",
              }}
            >
              <div
                className="ios-active-header"
                style={{ textShadow: "0 2px 6px rgba(0,0,0,0.8)" }}
              >
                <h2 className="ios-active-name" style={{ fontWeight: 600 }}>
                  Find: {callData?.targetObject}
                </h2>
                <p
                  className="ios-active-time"
                  style={{ color: "white", fontWeight: 500 }}
                >
                  {formatTime(callDuration)}
                </p>
                <div
                  className="pulse"
                  style={{ marginTop: "10px", fontSize: "2rem" }}
                >
                  🔍
                </div>
              </div>

              <div
                style={{
                  marginTop: "auto",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "1.5rem",
                }}
              >
                <button
                  className="btn btn-ghost"
                  onClick={handleFound}
                  style={{
                    background: "rgba(0,0,0,0.6)",
                    color: "white",
                    padding: "10px 20px",
                    borderRadius: "20px",
                  }}
                >
                  Bypass (Found it)
                </button>
                <button className="ios-btn-end" onClick={endCall}>
                  <PhoneIcon style={{ transform: "rotate(135deg)" }} />
                </button>
              </div>
            </div>
          )}

          {/* Idle / Call Ended State */}
          {phase === "idle" && (
            <div
              className="ios-active-call"
              style={{ justifyContent: "center", background: "var(--bg)" }}
            >
              <h2 style={{ fontSize: "2rem", marginBottom: "10px" }}>
                Call Ended
              </h2>
              <p style={{ color: "var(--text-muted)", marginBottom: "30px" }}>
                Duration: {formatTime(callDuration)}
              </p>
              <button
                className="btn btn-primary"
                onClick={() => setPhase("ringing")}
              >
                Call Again
              </button>
            </div>
          )}

          {/* Done State */}
          {phase === "done" && (
            <div
              className="ios-active-call"
              style={{ justifyContent: "center", background: "var(--bg)" }}
            >
              <div style={{ fontSize: "4rem", marginBottom: "20px" }}>🎉</div>
              <h2 style={{ fontSize: "2rem", marginBottom: "10px" }}>
                Mission Complete!
              </h2>
              <p
                style={{
                  color: "var(--text)",
                  fontSize: "1.1rem",
                  marginBottom: "10px",
                  textAlign: "center",
                }}
              >
                You successfully helped {callData?.friendName} find the{" "}
                {callData?.targetObject}.
              </p>
              <p style={{ color: "var(--text-muted)", marginBottom: "30px" }}>
                Duration: {formatTime(callDuration)}
              </p>
              <button
                className="btn btn-primary"
                onClick={() => setPhase("ringing")}
              >
                Call Again
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
