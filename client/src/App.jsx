import { useRef, useState, useEffect, useCallback } from "react";
import CameraView from "./components/CameraView.jsx";
import {
  speak,
  phoneStart,
  phoneReply,
  phoneYap,
  phoneInterrupt,
  phoneEnglishPrompt,
  phoneEnglishEvaluate,
  phoneStruggle,
  phoneFound,
  phoneCheckCv,
} from "./services/api.js";

const NATIVE_LANGUAGE = "English";
const TARGET_LANGUAGE = "Portuguese";
const LEARNED_WORDS_STORAGE_KEY = "lingualens.learned_words_v1";
const ENGLISH_PRACTICE_MODE = "english_practice";
const FIND_REQUESTED_MODE = "find_requested";

function normText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyConfusionText(text) {
  const t = normText(text);
  if (!t) return false;
  const signals = [
    "dont understand",
    "do not understand",
    "i dont understand",
    "i do not understand",
    "i dont get it",
    "confused",
    "what do you mean",
    "nao entendo",
    "nao percebo",
    "nao sei",
    "nao entendi",
    "nao compreendo",
    "nao estou a perceber",
    "nao to entendendo",
  ];
  return signals.some((s) => t.includes(s));
}

function pickPracticeObjectName(detections = []) {
  const ignored = new Set(["person", "face", "human"]);
  const names = Array.isArray(detections)
    ? detections.map((d) => d?.name).filter(Boolean)
    : [];
  const preferred = names.find((name) => !ignored.has(normText(name)));
  return preferred || names[0] || "";
}

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

// Utility: vibrate if supported
function vibrate(pattern) {
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [swipeStartY, setSwipeStartY] = useState(null);
  const [swipeDelta, setSwipeDelta] = useState(0);
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [phase, setPhase] = useState("idle");
  const [cameraError, setCameraError] = useState(null);
  const [callData, setCallData] = useState(null);
  const [incomingCallData, setIncomingCallData] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [audioPrimed, setAudioPrimed] = useState(false);
  const [cvDebug, setCvDebug] = useState(null);
  const [learnedWords, setLearnedWords] = useState([]);

  const isSearchingRef = useRef(false);
  const searchStartTimeRef = useRef(0);
  const searchIntervalRef = useRef(null);
  const struggledRef = useRef(false);
  const audioPrimedRef = useRef(false);
  const unlockingRef = useRef(false);
  const lastYapAtRef = useRef(0);
  const noObjectRoundsRef = useRef(0);
  const interruptBusyRef = useRef(false);
  const lastInterruptAtRef = useRef(0);
  const englishRoundBusyRef = useRef(false);

  const ensureAudioElement = useCallback(() => {
    if (!audioRef.current) {
      const audioEl = new window.Audio();
      audioEl.playsInline = true;
      audioEl.preload = "auto";
      audioRef.current = audioEl;
    }
    return audioRef.current;
  }, []);

  const playAudioSource = useCallback(
    async (src, { loop = false, onEnded = null } = {}) => {
      const audioEl = ensureAudioElement();
      audioEl.pause();
      audioEl.onended = null;
      audioEl.loop = loop;
      audioEl.muted = false;
      audioEl.src = src;
      audioEl.currentTime = 0;
      if (onEnded) audioEl.onended = onEnded;
      await audioEl.play();
      return audioEl;
    },
    [ensureAudioElement],
  );

  const unlockAudioPlayback = useCallback(async () => {
    if (audioPrimedRef.current) return true;

    try {
      const primer = ensureAudioElement();
      const previousVolume = primer.volume;
      primer.pause();
      primer.src = "/iphone_ringtone.mp3";
      primer.loop = false;
      primer.muted = true;
      primer.volume = 0;
      primer.currentTime = 0;
      await primer.play();
      primer.pause();
      primer.currentTime = 0;
      primer.muted = false;
      primer.volume = previousVolume;
      audioPrimedRef.current = true;
      setAudioPrimed(true);
      return true;
    } catch (err) {
      console.warn("[DEBUG] Audio unlock failed:", err);
      return false;
    }
  }, [ensureAudioElement]);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.onended = null;
      audioRef.current.loop = false;
    }
  }, []);

  const requestMediaPermissions = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return true;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
      },
      audio: true,
    });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  }, []);

  const completeUnlock = useCallback(async () => {
    if (unlockingRef.current || unlocked) return;
    unlockingRef.current = true;

    let canPlayAudio = false;
    try {
      canPlayAudio = await unlockAudioPlayback();
      await requestMediaPermissions();
    } catch (err) {
      console.error(err);
      setCameraError(err);
    } finally {
      setUnlocked(true);
      setPhase("ringing");
      if (canPlayAudio) {
        playAudioSource("/iphone_ringtone.mp3", { loop: true }).catch((err) => {
          console.error("[DEBUG] ringtoneAudio.play() error:", err);
        });
      }
      unlockingRef.current = false;
    }
  }, [
    unlocked,
    unlockAudioPlayback,
    requestMediaPermissions,
    playAudioSource,
  ]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LEARNED_WORDS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setLearnedWords(parsed.filter((w) => typeof w === "string"));
      }
    } catch (err) {
      console.warn("Failed to load learned words:", err);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        LEARNED_WORDS_STORAGE_KEY,
        JSON.stringify(learnedWords),
      );
    } catch (err) {
      console.warn("Failed to persist learned words:", err);
    }
  }, [learnedWords]);

  const addLearnedWord = useCallback((word) => {
    if (!word || typeof word !== "string") return;
    const trimmed = word.trim();
    if (!trimmed) return;

    setLearnedWords((prev) => {
      const exists = prev.some(
        (w) => w.toLowerCase() === trimmed.toLowerCase(),
      );
      if (exists) return prev;
      return [...prev, trimmed];
    });
  }, []);

  const endCall = useCallback(() => {
    stopAudio();
    setPhase("idle");
    setUnlocked(false);
    setCallData(null);
    setIncomingCallData(null);
    setCvDebug(null);
    setTranscript("");
    setCallDuration(0);
    isSearchingRef.current = false;
    noObjectRoundsRef.current = 0;
    clearTimeout(searchIntervalRef.current);
  }, [stopAudio]);

  useEffect(() => {
    if (!unlocked || phase !== "ringing") return;

    let cancelled = false;
    setIncomingCallData(null);

    (async () => {
      try {
        const startData = await phoneStart(TARGET_LANGUAGE, NATIVE_LANGUAGE);
        if (!cancelled) setIncomingCallData(startData);
      } catch (err) {
        console.error(err);
        if (!cancelled) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, unlocked]);

  // Play iPhone ringtone on "ringing" phase
  useEffect(() => {
    if (!unlocked) return;

    const isActiveCall = [
      "connecting",
      "speaking_intro",
      "listening_preference",
      "processing_preference",
      "speaking_task",
      "speaking_object_prompt",
      "listening_object_guess",
      "processing_object_guess",
      "searching",
      "speaking_struggle",
      "speaking_found",
      "speaking_yap",
      "speaking_interrupt",
    ].includes(phase);

    if (phase === "ringing" && audioPrimed) {
      const isAlreadyRinging =
        audioRef.current &&
        audioRef.current.src &&
        audioRef.current.src.includes("iphone_ringtone.mp3") &&
        !audioRef.current.paused;
      setCallDuration(0);
      if (!isAlreadyRinging) {
        playAudioSource("/iphone_ringtone.mp3", { loop: true })
        .then(() => {
          console.log("[DEBUG] ringtoneAudio.play() promise resolved");
        })
        .catch((err) => {
          console.error("[DEBUG] ringtoneAudio.play() error:", err);
        });
      }
    }

    if (isActiveCall || phase === "idle" || phase === "done" || phase === "error") {
      // Stop ringtone if playing
      if (audioRef.current && audioRef.current.src && audioRef.current.src.includes("iphone_ringtone")) {
        stopAudio();
      }
    }

    if (isActiveCall) {
      const int = setInterval(() => setCallDuration((d) => d + 1), 1000);
      return () => {
        clearInterval(int);
      };
    } else {
      return undefined;
    }
  }, [phase, unlocked, audioPrimed, playAudioSource, stopAudio]);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const acceptCall = async () => {
    await unlockAudioPlayback();
    // Vibrate on accept (short burst)
    vibrate([100, 50, 100]);
    setPhase("connecting");
    setCallDuration(0);
    try {
      const startData =
        incomingCallData || (await phoneStart(TARGET_LANGUAGE, NATIVE_LANGUAGE));
      setIncomingCallData(startData);
      setCallData({
        friendName: startData.friendName,
        targetObject: startData.targetObject,
        targetObjectTranslated: startData.targetObjectTranslated,
        struggled: false,
      });

      const { audioBase64, mimeType } = await speak(startData.script);
      setPhase("speaking_intro");
      await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
        onEnded: () => setPhase("listening_preference"),
      });
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
          gameMode:
            replyData.gameMode ||
            (normText(replyData.chosenLanguage) === normText(NATIVE_LANGUAGE)
              ? ENGLISH_PRACTICE_MODE
              : FIND_REQUESTED_MODE),
          practiceObject: null,
          practiceObjectTranslated: null,
          awaitingPracticeGuess: false,
        }));

        const { audioBase64, mimeType } = await speak(replyData.script);
        setPhase("speaking_task");
        await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
          onEnded: () => setPhase("searching"),
        });
      } catch (err) {
        console.error(err);
        setPhase("error");
      }
    },
    [callData, playAudioSource],
  );

  const handleEnglishPracticePrompt = useCallback(
    async (objectName) => {
      if (!callData || !objectName || englishRoundBusyRef.current) return false;

      englishRoundBusyRef.current = true;
      setPhase("speaking_object_prompt");
      try {
        const promptData = await phoneEnglishPrompt({
          friendName: callData.friendName,
          objectName,
          targetLanguage: TARGET_LANGUAGE,
          nativeLanguage: NATIVE_LANGUAGE,
        });

        const objectTranslated =
          promptData?.objectTranslated || objectName;
        setCallData((prev) => ({
          ...prev,
          practiceObject: objectName,
          practiceObjectTranslated: objectTranslated,
          awaitingPracticeGuess: true,
        }));
        addLearnedWord(objectTranslated);

        const { audioBase64, mimeType } = await speak(
          promptData?.script ||
            `I can see a ${objectName}. How do you say ${objectName} in ${TARGET_LANGUAGE}?`,
          null,
          NATIVE_LANGUAGE,
        );
        await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
          onEnded: () => setPhase("listening_object_guess"),
        });
        return true;
      } catch (err) {
        console.error("English prompt error:", err);
        setPhase("searching");
        return false;
      } finally {
        englishRoundBusyRef.current = false;
      }
    },
    [callData, playAudioSource, addLearnedWord, endCall],
  );

  const handleEnglishPracticeGuess = useCallback(
    async (spokenGuess) => {
      if (!callData?.practiceObject || !callData?.practiceObjectTranslated) {
        return;
      }

      setTranscript(spokenGuess || "");
      setPhase("processing_object_guess");
      try {
        const evalData = await phoneEnglishEvaluate({
          friendName: callData.friendName,
          objectName: callData.practiceObject,
          objectTranslated: callData.practiceObjectTranslated,
          guess: spokenGuess || "",
          targetLanguage: TARGET_LANGUAGE,
          nativeLanguage: NATIVE_LANGUAGE,
        });

        addLearnedWord(callData.practiceObjectTranslated);
        setCallData((prev) => ({ ...prev, awaitingPracticeGuess: false }));

        const { audioBase64, mimeType } = await speak(
          evalData?.finalScript ||
            `${callData.practiceObject} in ${TARGET_LANGUAGE} is "${callData.practiceObjectTranslated}". Thanks for helping me, bye!`,
          null,
          NATIVE_LANGUAGE,
        );
        setPhase("speaking_found");
        await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
          onEnded: () => endCall(),
        });
      } catch (err) {
        console.error("English evaluate error:", err);
        try {
          const fallback =
            `Thanks for helping me. ${callData.practiceObject} in ${TARGET_LANGUAGE} is "${callData.practiceObjectTranslated}". Bye!`;
          const { audioBase64, mimeType } = await speak(
            fallback,
            null,
            NATIVE_LANGUAGE,
          );
          await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
            onEnded: () => endCall(),
          });
        } catch (speakErr) {
          console.error("English evaluate fallback error:", speakErr);
          endCall();
        }
      }
    },
    [callData, playAudioSource, addLearnedWord],
  );

  const handleSearchYap = useCallback(
    async (visibleObjects, focusObject = "") => {
      if (!callData) return false;

      setPhase("speaking_yap");
      try {
        const yData = await phoneYap({
          friendName: callData.friendName,
          targetObject: callData.targetObject,
          targetObjectTranslated: callData.targetObjectTranslated,
          gameMode: callData.gameMode || FIND_REQUESTED_MODE,
          chosenLanguage: callData.chosenLanguage,
          visibleObjects,
          focusObject,
          noObjectRounds: noObjectRoundsRef.current,
          targetLanguage: TARGET_LANGUAGE,
          nativeLanguage: NATIVE_LANGUAGE,
        });
        if (yData?.teachingTranslation) {
          addLearnedWord(yData.teachingTranslation);
        }

        const { audioBase64, mimeType } = await speak(
          yData.script,
          null,
          callData.chosenLanguage || NATIVE_LANGUAGE,
        );
        await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
          onEnded: () => setPhase("searching"),
        });
        return true;
      } catch (err) {
        console.error("Yap error:", err);
        setPhase("searching");
        return false;
      }
    },
    [callData, playAudioSource, addLearnedWord],
  );

  const handleInterruption = useCallback(
    async (spokenText) => {
      if (!callData || !spokenText) return false;

      const now = Date.now();
      if (
        interruptBusyRef.current ||
        now - lastInterruptAtRef.current < 6000
      ) {
        return false;
      }

      interruptBusyRef.current = true;
      lastInterruptAtRef.current = now;
      setPhase("speaking_interrupt");

      try {
        const chosenIsTarget =
          normText(callData.chosenLanguage) === normText(TARGET_LANGUAGE);
        const inFindMode =
          (callData.gameMode || FIND_REQUESTED_MODE) === FIND_REQUESTED_MODE;
        if (inFindMode && chosenIsTarget && isLikelyConfusionText(spokenText)) {
          const fallbackScript = `No worries. In ${TARGET_LANGUAGE}, ${callData.targetObject} is "${callData.targetObjectTranslated}". Thanks for helping me today, bye!`;
          addLearnedWord(callData.targetObjectTranslated || callData.targetObject);
          const { audioBase64, mimeType } = await speak(
            fallbackScript,
            null,
            NATIVE_LANGUAGE,
          );
          await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
            onEnded: () => endCall(),
          });
          return true;
        }

        const iData = await phoneInterrupt({
          transcript: spokenText,
          friendName: callData.friendName,
          targetObject: callData.targetObject,
          targetObjectTranslated: callData.targetObjectTranslated,
          gameMode: callData.gameMode || FIND_REQUESTED_MODE,
          chosenLanguage: callData.chosenLanguage,
          visibleObjects: (cvDebug?.visibleObjectDetections || [])
            .map((d) => d?.name)
            .filter(Boolean),
          targetLanguage: TARGET_LANGUAGE,
          nativeLanguage: NATIVE_LANGUAGE,
        });

        const { audioBase64, mimeType } = await speak(
          iData.script,
          null,
          callData.chosenLanguage || NATIVE_LANGUAGE,
        );
        await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
          onEnded: () => setPhase("searching"),
        });
        return true;
      } catch (err) {
        console.error("Interruption error:", err);
        setPhase("searching");
        return false;
      } finally {
        interruptBusyRef.current = false;
      }
    },
    [callData, cvDebug, playAudioSource, addLearnedWord, endCall],
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
    recognition.continuous = true;
    recognition.interimResults = true;

    let submitted = false;
    let finalText = "";
    let latestLiveText = "";
    let idleFinalizeTimer = null;
    const isActiveRef = { current: true };

    const submitPreference = (text) => {
      const trimmed = (text || "").trim();
      if (!trimmed || submitted) return;
      submitted = true;
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      processPreference(trimmed);
    };

    const scheduleIdleFinalize = () => {
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      idleFinalizeTimer = setTimeout(() => {
        submitPreference(finalText || latestLiveText);
      }, 900);
    };

    recognition.onstart = () => {
      setTranscript("");
      setIsListening(true);
    };
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const segment = event.results[i][0].transcript.trim();
        if (!segment) continue;
        if (event.results[i].isFinal) {
          finalText = `${finalText} ${segment}`.trim();
        }
      }

      const interimText = Array.from(event.results)
        .map((result) => (result.isFinal ? "" : result[0].transcript.trim()))
        .filter(Boolean)
        .join(" ");

      latestLiveText = `${finalText} ${interimText}`.trim();
      if (latestLiveText) setTranscript(latestLiveText);

      if (finalText) {
        submitPreference(finalText);
      } else if (latestLiveText) {
        scheduleIdleFinalize();
      }
    };
    recognition.onerror = (e) => {
      console.error("Speech recognition error:", e);
    };
    recognition.onend = () => {
      setIsListening(false);
      if (
        !submitted &&
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
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      recognition.stop();
    };
  }, [phase, processPreference]);

  useEffect(() => {
    if (phase !== "listening_object_guess") return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      void handleEnglishPracticeGuess("");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = false;

    let submitted = false;
    let idleFinalizeTimer = null;
    let noSpeechTimer = null;
    const isActiveRef = { current: true };

    const submitGuess = (text) => {
      if (submitted) return;
      submitted = true;
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      if (noSpeechTimer) clearTimeout(noSpeechTimer);
      void handleEnglishPracticeGuess((text || "").trim());
    };

    recognition.onstart = () => {
      setTranscript("");
      setIsListening(true);
      noSpeechTimer = setTimeout(() => submitGuess(""), 5500);
    };
    recognition.onresult = (event) => {
      let spoken = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) {
          spoken = `${spoken} ${event.results[i][0].transcript}`.trim();
        }
      }
      if (!spoken) return;
      setTranscript(spoken);
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      idleFinalizeTimer = setTimeout(() => submitGuess(spoken), 700);
    };
    recognition.onerror = () => {
      submitGuess("");
    };
    recognition.onend = () => {
      setIsListening(false);
      if (
        !submitted &&
        isActiveRef.current &&
        phase === "listening_object_guess"
      ) {
        try {
          recognition.start();
        } catch (e) {}
      }
    };

    try {
      recognition.start();
    } catch (e) {
      submitGuess("");
    }

    return () => {
      isActiveRef.current = false;
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      if (noSpeechTimer) clearTimeout(noSpeechTimer);
      try {
        recognition.stop();
      } catch (e) {}
    };
  }, [phase, handleEnglishPracticeGuess]);

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
      await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
        onEnded: () => setPhase("searching"),
      });
    } catch (err) {
      console.error(err);
      setPhase("searching");
    }
  }, [callData, playAudioSource]);

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
      addLearnedWord(callData.targetObjectTranslated || callData.targetObject);

      const { audioBase64, mimeType } = await speak(fData.script);
      await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
        onEnded: () => setPhase("done"),
      });
    } catch (err) {
      console.error(err);
      setPhase("done");
    }
  }, [callData, playAudioSource, addLearnedWord]);

  useEffect(() => {
    if (phase !== "searching" || !callData) return;

    isSearchingRef.current = true;
    searchStartTimeRef.current = Date.now();
    struggledRef.current = false;
    noObjectRoundsRef.current = 0;
    setCvDebug(null);

    const checkLoop = async () => {
      if (!isSearchingRef.current || !videoRef.current) return;

      const frame = captureFrame(videoRef.current);
      if (frame) {
        try {
          const cvRes = await phoneCheckCv(frame, callData.targetObject);
          const visibleObjectDetections = Array.isArray(
            cvRes?.visibleObjectDetections,
          )
            ? cvRes.visibleObjectDetections
            : [];
          const visibleObjectNames = visibleObjectDetections
            .map((d) => d?.name)
            .filter(Boolean);
          const focusObjectName = pickPracticeObjectName(
            visibleObjectDetections,
          );
          const gameMode = callData.gameMode || FIND_REQUESTED_MODE;
          const isEnglishPractice = gameMode === ENGLISH_PRACTICE_MODE;

          if (visibleObjectNames.length === 0) {
            noObjectRoundsRef.current += 1;
          } else {
            noObjectRoundsRef.current = 0;
          }

          setCvDebug({
            modelUsed: cvRes?.modelUsed || "unknown",
            found: Boolean(cvRes?.found),
            confidence: cvRes?.confidence,
            detectedObject: cvRes?.detectedObject,
            targetBoundingBox:
              gameMode === FIND_REQUESTED_MODE
                ? cvRes?.targetBoundingBox || null
                : null,
            fallbackSceneUsed: Boolean(cvRes?.fallbackSceneUsed),
            visibleObjectDetections,
          });
          console.log("[CV Check]", {
            gameMode,
            targetObject: callData.targetObject,
            modelUsed: cvRes?.modelUsed,
            found: cvRes?.found,
            modelFound: cvRes?.modelFound,
            confidence: cvRes?.confidence,
            matchType: cvRes?.matchType,
            detectedObject: cvRes?.detectedObject,
            targetBoundingBox: cvRes?.targetBoundingBox,
            evidence: cvRes?.evidence,
            visibleObjects: cvRes?.visibleObjects,
            visibleObjectDetections,
            fallbackSceneUsed: cvRes?.fallbackSceneUsed,
          });
          if (!isEnglishPractice) {
            if (cvRes.found) {
              isSearchingRef.current = false;
              handleFound();
              return;
            }
          } else if (
            !callData?.practiceObject &&
            focusObjectName &&
            !interruptBusyRef.current
          ) {
            isSearchingRef.current = false;
            clearTimeout(searchIntervalRef.current);
            await handleEnglishPracticePrompt(focusObjectName);
            return;
          }

          const isWrongVisible =
            !!focusObjectName &&
            normText(focusObjectName) !== normText(callData.targetObject);
          const yapCooldownMs = isWrongVisible ? 5000 : 9000;
          const shouldYap =
            !callData?.awaitingPracticeGuess &&
            Date.now() - lastYapAtRef.current > yapCooldownMs &&
            !interruptBusyRef.current;
          if (shouldYap) {
            isSearchingRef.current = false;
            clearTimeout(searchIntervalRef.current);
            lastYapAtRef.current = Date.now();
            await handleSearchYap(visibleObjectNames, focusObjectName);
            return;
          }
        } catch (e) {
          console.error("CV error", e);
        }
      }

      const elapsed = Date.now() - searchStartTimeRef.current;
      if (
        (callData.gameMode || FIND_REQUESTED_MODE) === FIND_REQUESTED_MODE &&
        elapsed > 15000 &&
        !struggledRef.current &&
        normText(callData.chosenLanguage) === normText(TARGET_LANGUAGE)
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
  }, [
    phase,
    callData,
    handleFound,
    handleStruggle,
    handleSearchYap,
    handleEnglishPracticePrompt,
  ]);

  useEffect(() => {
    if (phase !== "searching") return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang =
      normText(callData?.chosenLanguage) === normText(TARGET_LANGUAGE)
        ? "pt-BR"
        : "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;

    let active = true;

    recognition.onresult = (event) => {
      let spoken = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) {
          spoken = `${spoken} ${event.results[i][0].transcript}`.trim();
        }
      }

      if (spoken.length >= 3) {
        void handleInterruption(spoken).then((handled) => {
          if (handled) {
            try {
              recognition.stop();
            } catch (e) {}
          }
        });
      }
    };

    recognition.onerror = () => {};
    recognition.onend = () => {
      if (active && phase === "searching") {
        try {
          recognition.start();
        } catch (e) {}
      }
    };

    try {
      recognition.start();
    } catch (e) {}

    return () => {
      active = false;
      try {
        recognition.stop();
      } catch (e) {}
    };
  }, [phase, handleInterruption, callData]);

  const isActiveCallPhase = [
    "connecting",
    "speaking_intro",
    "listening_preference",
    "processing_preference",
    "speaking_task",
    "speaking_object_prompt",
    "listening_object_guess",
    "processing_object_guess",
    "speaking_struggle",
    "speaking_found",
    "speaking_yap",
    "speaking_interrupt",
    "error",
  ].includes(phase);

  return (
    <div className="app">
      {/* iPhone-style lock screen overlay */}
      {!unlocked && (
        <div
          className="lockscreen-overlay"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "linear-gradient(180deg, #222 0%, #111 100%)",
            color: "white",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
            userSelect: "none",
            touchAction: "none",
          }}
          onTouchStart={e => {
            void unlockAudioPlayback();
            if (e.touches.length === 1) setSwipeStartY(e.touches[0].clientY);
          }}
          onTouchMove={e => {
            if (swipeStartY !== null) {
              setSwipeDelta(e.touches[0].clientY - swipeStartY);
            }
          }}
          onTouchEnd={e => {
            if (swipeStartY !== null && swipeDelta < -80) {
              void completeUnlock();
            }
            setSwipeStartY(null);
            setSwipeDelta(0);
          }}
          onMouseDown={e => {
            void unlockAudioPlayback();
            setSwipeStartY(e.clientY);
          }}
          onMouseMove={e => {
            if (swipeStartY !== null) setSwipeDelta(e.clientY - swipeStartY);
          }}
          onMouseUp={e => {
            if (swipeStartY !== null && swipeDelta < -80) {
              void completeUnlock();
            }
            setSwipeStartY(null);
            setSwipeDelta(0);
          }}
        >
          <div
            style={{
              paddingTop: 36,
              fontSize: 64,
              fontWeight: 600,
              marginBottom: 8,
              letterSpacing: -1,
            }}
          >
            9:41
          </div>
          <div style={{ fontSize: 18, opacity: 0.7, marginBottom: 40 }}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <div style={{ fontSize: 14, opacity: 0.72, marginBottom: 12 }}>
            {`Learnt ${learnedWords.length ? learnedWords.slice(-3).join(", ") : "0"} words`}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ marginBottom: 40, opacity: 0.8, fontSize: 20, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 28, marginBottom: 8 }}>🔓</span>
            <span style={{ fontSize: 16 }}>Swipe up to unlock</span>
            <div style={{
              marginTop: 18,
              width: 60,
              height: 6,
              borderRadius: 3,
              background: "rgba(255,255,255,0.18)",
              boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
            }} />
          </div>
        </div>
      )}

      {unlocked && (cameraError ? (
        <div className="error-screen">
          <p>📷🎙️ Camera or microphone access denied</p>
          <p className="error-hint">Enable permissions and reload.</p>
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
                <h2 className="ios-caller-name">
                  {incomingCallData?.friendName || "Incoming Call"}
                </h2>
                <p className="ios-caller-status">LinguaLens Video</p>
              </div>

              <div className="ios-actions">
                {/* Only render Accept button, no Decline */}
                <div className="ios-action-col" style={{ margin: "0 auto" }}>
                  <button
                    className="ios-btn ios-btn-accept"
                    onClick={acceptCall}
                    style={{ animation: "vibrate-btn 0.2s linear infinite alternate" }}
                  >
                    <PhoneIcon />
                  </button>
                  <span className="ios-action-label">Accept</span>
                </div>
              </div>
            </div>
          )}

          {/* Active Call — FaceTime-style video UI */}
          {isActiveCallPhase && (
            <div className="facetime-active-call">
              {/* Top: caller name + status */}
              <div className="facetime-header">
                <h2 className="facetime-caller-name">
                  {callData?.friendName || "Connecting..."}
                </h2>
                <p className="facetime-caller-status">
                  {phase === "connecting" ? "connecting..." : formatTime(callDuration)}
                </p>
              </div>

              {/* PiP: caller's "camera" — top right */}
              <div className="facetime-pip">
                <div className="facetime-pip-avatar">👤</div>
              </div>

              {/* Mid status hints */}
              <div className="facetime-status">
                {phase === "listening_preference" && (
                  <span className="facetime-status-pill pulse">
                    🎙️ Say: English or Portuguese
                  </span>
                )}
                {phase === "listening_object_guess" && (
                  <span className="facetime-status-pill pulse">
                    🎙️ Say the Portuguese word
                  </span>
                )}
                {phase === "processing_preference" && (
                  <span className="facetime-status-pill">Thinking...</span>
                )}
                {phase === "processing_object_guess" && (
                  <span className="facetime-status-pill">Checking your word...</span>
                )}
                {phase.startsWith("speaking") && (
                  <span className="facetime-status-pill pulse">🗣️ Speaking...</span>
                )}
                {phase === "error" && (
                  <span className="facetime-status-pill" style={{ background: "rgba(244,63,94,0.8)" }}>
                    Connection Error
                  </span>
                )}
                {transcript &&
                  [
                    "listening_preference",
                    "processing_preference",
                    "listening_object_guess",
                    "processing_object_guess",
                  ].includes(phase) && (
                  <span className="facetime-status-pill" style={{ marginTop: 6, fontSize: "0.85rem" }}>
                    "{transcript}"
                  </span>
                  )}
                {phase === "listening_preference" && (
                  <div className="facetime-skip-row">
                    <button
                      className="facetime-skip-btn"
                      onClick={() => processPreference("English")}
                    >
                      English
                    </button>
                    <button
                      className="facetime-skip-btn"
                      onClick={() => processPreference("Portuguese")}
                    >
                      Portuguese
                    </button>
                  </div>
                )}
              </div>

              {/* Bottom controls */}
              <div className="facetime-controls">
                <div className="facetime-btn-row">
                  <div className="facetime-btn-item">
                    <button className="facetime-ctrl-btn">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 3a9 9 0 100 18A9 9 0 0012 3zm0 2a7 7 0 110 14A7 7 0 0112 5zm-1 4v4l3.5 2.1.75-1.23L12 12.5V9h-1z"/></svg>
                    </button>
                    <span className="facetime-btn-label">effects</span>
                  </div>
                  <div className="facetime-btn-item">
                    <button className="facetime-ctrl-btn">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2z"/></svg>
                    </button>
                    <span className="facetime-btn-label">mute</span>
                  </div>
                  <div className="facetime-btn-item">
                    <button className="facetime-ctrl-btn">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M20 5h-3.17L15 3H9L7.17 5H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V7a2 2 0 00-2-2zm-8 13a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z"/></svg>
                    </button>
                    <span className="facetime-btn-label">flip</span>
                  </div>
                  <div className="facetime-btn-item">
                    <button className="facetime-ctrl-btn facetime-ctrl-end" onClick={endCall}>
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                    <span className="facetime-btn-label">end</span>
                  </div>
                </div>
                <div className="facetime-pill-row">
                  <button className="facetime-pill-btn">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{marginRight:6}}><path d="M18 10.48V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4.48l4 3.98v-11l-4 3.98z"/><line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2"/></svg>
                    Camera Off
                  </button>
                  <button className="facetime-pill-btn">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{marginRight:6}}><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
                    Speaker
                  </button>
                </div>
              </div>
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
                  {(callData?.gameMode || FIND_REQUESTED_MODE) === ENGLISH_PRACTICE_MODE
                    ? `Practice: name nearby objects in ${TARGET_LANGUAGE}`
                    : `Find: ${callData?.targetObject}`}
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

              {cvDebug && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(var(--safe-top) + 10px)",
                    right: "12px",
                    zIndex: 4,
                    background: "rgba(0,0,0,0.6)",
                    border: "1px solid rgba(255,255,255,0.24)",
                    color: "white",
                    fontSize: "0.75rem",
                    padding: "5px 8px",
                    borderRadius: "8px",
                    textShadow: "none",
                  }}
                >
                  {`Boxes: ${(cvDebug.visibleObjectDetections || []).length} • ${cvDebug.modelUsed}${cvDebug.fallbackSceneUsed ? " • scene-fallback" : ""}`}
                </div>
              )}

              {(cvDebug?.targetBoundingBox ||
                (cvDebug?.visibleObjectDetections || []).length > 0) && (
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  {(cvDebug?.visibleObjectDetections || []).map((item, index) => {
                    const box = item?.boundingBox;
                    if (!box) return null;
                    const labelY = Math.max(0, (box.y * 100) - 3);
                    return (
                      <div key={`${item?.name || "obj"}-${index}`}>
                        <div
                          style={{
                            position: "absolute",
                            left: `${box.x * 100}%`,
                            top: `${box.y * 100}%`,
                            width: `${box.width * 100}%`,
                            height: `${box.height * 100}%`,
                            border: "2px solid rgba(56,189,248,0.95)",
                            borderRadius: "8px",
                            boxShadow: "0 0 12px rgba(56,189,248,0.4)",
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            left: `${box.x * 100}%`,
                            top: `${labelY}%`,
                            transform: "translateY(-100%)",
                            background: "rgba(8,47,73,0.78)",
                            border: "1px solid rgba(56,189,248,0.8)",
                            color: "#e0f2fe",
                            fontSize: "0.72rem",
                            padding: "3px 7px",
                            borderRadius: "7px",
                            textShadow: "none",
                          }}
                        >
                          {`${item?.name || "object"}${
                            Number.isFinite(Number(item?.confidence))
                              ? ` ${Math.round(Number(item.confidence) * 100)}%`
                              : ""
                          }`}
                        </div>
                      </div>
                    );
                  })}

                  {cvDebug?.targetBoundingBox && (
                    <>
                      <div
                        style={{
                          position: "absolute",
                          left: `${cvDebug.targetBoundingBox.x * 100}%`,
                          top: `${cvDebug.targetBoundingBox.y * 100}%`,
                          width: `${cvDebug.targetBoundingBox.width * 100}%`,
                          height: `${cvDebug.targetBoundingBox.height * 100}%`,
                          border: "3px solid #22c55e",
                          borderRadius: "10px",
                          boxShadow: "0 0 16px rgba(34,197,94,0.65)",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: `${cvDebug.targetBoundingBox.x * 100}%`,
                          top: `${Math.max(0, (cvDebug.targetBoundingBox.y * 100) - 4)}%`,
                          transform: "translateY(-100%)",
                          background: "rgba(0,0,0,0.72)",
                          border: "1px solid rgba(34,197,94,0.7)",
                          color: "#dcfce7",
                          fontSize: "0.78rem",
                          padding: "4px 8px",
                          borderRadius: "8px",
                          textShadow: "none",
                        }}
                      >
                        {`${cvDebug.detectedObject || "target"} (${Math.round((cvDebug.confidence || 0) * 100)}%) • ${cvDebug.modelUsed}`}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div
                style={{
                  marginTop: "auto",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "1rem",
                }}
              >
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
      ))}
    </div>
  );
}
