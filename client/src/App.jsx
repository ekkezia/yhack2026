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

export default function App() {
  const videoRef = useRef(null);
  const [phase, setPhase] = useState("idle");
  const [cameraError, setCameraError] = useState(null);
  const [callData, setCallData] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);

  const isSearchingRef = useRef(false);
  const searchStartTimeRef = useRef(0);
  const searchIntervalRef = useRef(null);
  const struggledRef = useRef(false);

  const acceptCall = async () => {
    setPhase("connecting");
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
      audio.onended = () => {
        setPhase("listening_preference");
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
        audio.onended = () => {
          setPhase("searching");
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
      audio.onended = () => {
        setPhase("searching");
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
      audio.onended = () => {
        setPhase("done");
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

  const isCenterPhase = ["idle", "ringing", "connecting"].includes(phase);

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

          <div
            className="overlay"
            style={{
              background: isCenterPhase ? "var(--bg)" : "transparent",
              pointerEvents: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: isCenterPhase ? "center" : "stretch",
              justifyContent: isCenterPhase ? "center" : "flex-end",
            }}
          >
            {phase === "idle" && (
              <div style={{ textAlign: "center", color: "white" }}>
                <h1 className="splash-title">LinguaLens</h1>
                <p className="splash-sub">Ready for a call?</p>
                <button
                  className="btn btn-primary"
                  onClick={() => setPhase("ringing")}
                  style={{ marginTop: 20 }}
                >
                  Simulate Incoming Call
                </button>
              </div>
            )}

            {phase === "ringing" && (
              <div
                className="pulse"
                style={{
                  textAlign: "center",
                  color: "white",
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: "4rem" }}>📱</div>
                <h2>Incoming Call...</h2>
                <p>Unknown Caller</p>
                <button
                  className="btn btn-primary"
                  style={{
                    background: "var(--green)",
                    padding: "1rem 2rem",
                    fontSize: "1.2rem",
                    borderRadius: "50px",
                  }}
                  onClick={acceptCall}
                >
                  📞 Pick Up
                </button>
              </div>
            )}

            {phase === "connecting" && (
              <div style={{ textAlign: "center", color: "white" }}>
                <h2>Connecting...</h2>
              </div>
            )}

            {(phase === "speaking_intro" ||
              phase === "speaking_task" ||
              phase === "speaking_struggle" ||
              phase === "speaking_found") && (
              <div
                className="overlay-card"
                style={{ marginTop: "auto", marginBottom: "2rem" }}
              >
                <div
                  style={{
                    fontSize: "3rem",
                    textAlign: "center",
                    marginBottom: 10,
                  }}
                >
                  🗣️
                </div>
                <p style={{ textAlign: "center", fontSize: "1.2rem" }}>
                  {callData?.friendName} is speaking...
                </p>
              </div>
            )}

            {phase === "listening_preference" && (
              <div
                className="overlay-card"
                style={{
                  marginTop: "auto",
                  marginBottom: "2rem",
                  textAlign: "center",
                }}
              >
                <div
                  className={`scan-icon ${isListening ? "pulse" : ""}`}
                  style={{ fontSize: "3rem", marginBottom: 10 }}
                >
                  🎙️
                </div>
                <p style={{ fontSize: "1.2rem" }}>Listening...</p>
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  Say "English" or "Portuguese"
                </p>
                <div
                  style={{
                    marginTop: "1rem",
                    display: "flex",
                    gap: "0.5rem",
                    justifyContent: "center",
                  }}
                >
                  <button
                    className="btn btn-ghost"
                    onClick={() => processPreference("English")}
                  >
                    Skip (English)
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => processPreference("Portuguese")}
                  >
                    Skip (Portuguese)
                  </button>
                </div>
              </div>
            )}

            {phase === "processing_preference" && (
              <div
                className="overlay-card"
                style={{
                  marginTop: "auto",
                  marginBottom: "2rem",
                  textAlign: "center",
                }}
              >
                <p>Thinking...</p>
                {transcript && (
                  <p style={{ color: "var(--text-muted)", marginTop: 10 }}>
                    Heard: "{transcript}"
                  </p>
                )}
              </div>
            )}

            {phase === "searching" && (
              <div
                className="overlay-card"
                style={{
                  marginTop: "auto",
                  marginBottom: "2rem",
                  textAlign: "center",
                }}
              >
                <div
                  className="pulse"
                  style={{ fontSize: "3rem", marginBottom: 10 }}
                >
                  🔍
                </div>
                <p style={{ fontSize: "1.2rem" }}>
                  Look around for the <strong>{callData?.targetObject}</strong>!
                </p>
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  Point your camera at it.
                </p>
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-ghost" onClick={handleFound}>
                    Bypass (Found it)
                  </button>
                </div>
              </div>
            )}

            {phase === "done" && (
              <div
                className="overlay-card"
                style={{
                  marginTop: "auto",
                  marginBottom: "2rem",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "3rem", marginBottom: 10 }}>🎉</div>
                <h2>Call Ended</h2>
                <p style={{ margin: "10px 0" }}>
                  Great job finding the {callData?.targetObject}!
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => setPhase("idle")}
                >
                  Play Again
                </button>
              </div>
            )}

            {phase === "error" && (
              <div
                className="overlay-card"
                style={{
                  marginTop: "auto",
                  marginBottom: "2rem",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: "3rem", marginBottom: 10 }}>⚠️</div>
                <p>Something went wrong.</p>
                <button
                  className="btn btn-primary"
                  onClick={() => setPhase("idle")}
                  style={{ marginTop: 10 }}
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
