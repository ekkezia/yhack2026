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
  phoneTranscribe,
  phoneCheckCv,
} from "./services/api.js";

const NATIVE_LANGUAGE = "English";
const DEFAULT_TARGET_LANGUAGE = import.meta.env.VITE_TARGET_LANGUAGE || "Indonesian";

const SUPPORTED_LANGUAGES = [
  { name: "Indonesian", flag: "🇮🇩", locale: "id-ID" },
  { name: "Portuguese", flag: "🇧🇷", locale: "pt-BR" },
  { name: "Spanish",    flag: "🇪🇸", locale: "es-ES" },
  { name: "French",     flag: "🇫🇷", locale: "fr-FR" },
];
const LANGUAGE_STORAGE_KEY = "simp.target_language_v1";
const LEARNED_WORDS_STORAGE_KEY = "simp.learned_words_v1";
const ENGLISH_PRACTICE_MODE = "english_practice";
const FIND_REQUESTED_MODE = "find_requested";
const MAX_FIND_FAIL_ROUNDS = 4;
const SHOW_BBOX = false;

function getCallerLocation(language) {
  const lang = String(language || "").toLowerCase().trim();
  if (lang.includes("indones")) return "Indonesia";
  if (lang.includes("portugu")) return "Brazil";
  if (lang.includes("spanish") || lang.includes("espanol")) return "Spain";
  if (lang.includes("french") || lang.includes("français")) return "France";
  if (lang.includes("japanese") || lang.includes("nihon")) return "Japan";
  if (lang.includes("korean")) return "South Korea";
  if (lang.includes("mandarin") || lang.includes("chinese")) return "China";
  if (lang.includes("german") || lang.includes("deutsch")) return "Germany";
  if (lang.includes("italian")) return "Italy";
  if (lang.includes("arabic")) return "UAE";
  return language || "";
}

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
    "i dont know",
    "i do not know",
    "dont know",
    "do not know",
    "idk",
    "dunno",
    "confused",
    "i am confused",
    "im confused",
    "what do you mean",
    "i dont know what you mean",
    "can you explain",
    "please explain",
    "nao entendo",
    "nao percebo",
    "nao sei",
    "nao entendi",
    "nao compreendo",
    "nao estou a perceber",
    "nao to entendendo",
    "tidak mengerti",
    "saya tidak mengerti",
    "aku tidak mengerti",
    "ga ngerti",
    "gak ngerti",
    "nggak ngerti",
    "tidak paham",
    "saya tidak paham",
    "aku tidak paham",
    "bingung",
    "saya bingung",
    "aku bingung",
  ];
  return signals.some((s) => t.includes(s));
}

function getLanguageLocale(language, fallback = "en-US") {
  const lang = normText(language);
  if (!lang) return fallback;
  if (lang.includes("english"))  return "en-US";
  if (lang.includes("indones"))  return "id-ID";
  if (lang.includes("portugu"))  return "pt-BR";
  if (lang.includes("spanish") || lang.includes("espanol")) return "es-ES";
  if (lang.includes("french")  || lang.includes("francais")) return "fr-FR";
  if (lang.includes("japanese") || lang.includes("japan"))   return "ja-JP";
  if (lang.includes("korean"))   return "ko-KR";
  if (lang.includes("mandarin") || lang.includes("chinese")) return "zh-CN";
  if (lang.includes("german")  || lang.includes("deutsch"))  return "de-DE";
  if (lang.includes("italian") || lang.includes("italiano")) return "it-IT";
  if (lang.includes("arabic"))   return "ar-SA";
  return fallback;
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

function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    if (
      typeof MediaRecorder.isTypeSupported === "function" &&
      MediaRecorder.isTypeSupported(type)
    ) {
      return type;
    }
  }
  return "";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function isSameLocalDay(value, refDate = new Date()) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === refDate.getFullYear() &&
    d.getMonth() === refDate.getMonth() &&
    d.getDate() === refDate.getDate()
  );
}

function formatGuessDuration(durationMs) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) return "n/a";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
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
  const [bootPhase, setBootPhase] = useState(() => {
    try {
      return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ? null : "hello";
    } catch { return "hello"; }
  });
  const [bootFadingOut, setBootFadingOut] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState(() => {
    try {
      return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_TARGET_LANGUAGE;
    } catch { return DEFAULT_TARGET_LANGUAGE; }
  });
  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [facingMode, setFacingMode] = useState("environment");
  const [currentTime, setCurrentTime] = useState(new Date());
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
  const [wordImages, setWordImages] = useState({});

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
  const practiceGuessStartAtRef = useRef(0);
  const findFailRoundsRef = useRef(0);
  const callTimeLimitTriggeredRef = useRef(false);

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

    // Show the ringing screen instantly, then request permissions in background
    setUnlocked(true);
    setPhase("ringing");

    try {
      const canPlayAudio = await unlockAudioPlayback();
      if (canPlayAudio) {
        playAudioSource("/iphone_ringtone.mp3", { loop: true }).catch((err) => {
          console.error("[DEBUG] ringtoneAudio.play() error:", err);
        });
      }
    } catch (err) {
      console.error(err);
      setCameraError(err);
    } finally {
      unlockingRef.current = false;
    }
  }, [
    unlocked,
    unlockAudioPlayback,
    playAudioSource,
  ]);

  // Linger on hello screen then fade out
  useEffect(() => {
    if (bootPhase !== "hello") return;
    const t = setTimeout(() => setBootFadingOut(true), 2400);
    return () => clearTimeout(t);
  }, [bootPhase]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LEARNED_WORDS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .map((item) => {
            if (typeof item === "string") {
              const targetWord = item.trim();
              if (!targetWord) return null;
              return {
                targetWord,
                nativeWord: "",
                durationMs: null,
                guessed: true,
                learnedAt: new Date().toISOString(),
              };
            }
            if (!item || typeof item !== "object") return null;
            const targetWord =
              typeof item.targetWord === "string"
                ? item.targetWord.trim()
                : typeof item.word === "string"
                  ? item.word.trim()
                  : "";
            if (!targetWord) return null;
            return {
              targetWord,
              nativeWord:
                typeof item.nativeWord === "string" ? item.nativeWord.trim() : "",
              durationMs: Number.isFinite(Number(item.durationMs))
                ? Math.max(0, Number(item.durationMs))
                : null,
              guessed: typeof item.guessed === "boolean" ? item.guessed : true,
              learnedAt:
                typeof item.learnedAt === "string" && item.learnedAt
                  ? item.learnedAt
                  : new Date().toISOString(),
            };
          })
          .filter(Boolean)
          .slice(-500);
        setLearnedWords(normalized);
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

  useEffect(() => {
    const today = new Date();
    const uniqueWords = [...new Set(
      learnedWords
        .filter(w => w?.nativeWord && isSameLocalDay(w.learnedAt, today))
        .map(w => w.nativeWord.toLowerCase().trim())
    )];
    uniqueWords.forEach(async (word) => {
      if (wordImages[word]) return;
      try {
        const apiBase = import.meta.env.VITE_API_BASE || "/api";
        const res = await fetch(`${apiBase}/generate-word-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word }),
        });
        if (!res.ok) {
          const err = await res.text();
          console.error(`[wordImage] ${word} failed ${res.status}:`, err);
          return;
        }
        const { imageBase64, mimeType } = await res.json();
        setWordImages(prev => ({ ...prev, [word]: `data:${mimeType};base64,${imageBase64}` }));
      } catch (err) {
        console.error(`[wordImage] ${word} error:`, err);
      }
    });
  }, [learnedWords]);

  const addLearnedWord = useCallback(
    (targetWord, nativeWord = "", durationMs = null, guessed = true) => {
      if (!targetWord || typeof targetWord !== "string") return;
      const targetTrimmed = targetWord.trim();
      if (!targetTrimmed) return;

      const nativeTrimmed =
        typeof nativeWord === "string" ? nativeWord.trim() : "";
      const durationValue = Number(durationMs);
      const normalizedDuration = Number.isFinite(durationValue)
        ? Math.max(0, durationValue)
        : null;

      setLearnedWords((prev) =>
        [
          ...(Array.isArray(prev) ? prev : []),
          {
            targetWord: targetTrimmed,
            nativeWord: nativeTrimmed,
            durationMs: normalizedDuration,
            guessed: Boolean(guessed),
            learnedAt: new Date().toISOString(),
          },
        ].slice(-500),
      );
    },
    [],
  );

  const startGeminiMicSession = useCallback(
    async ({
      languageHint = "en-US",
      context = "general",
      timesliceMs = 1600,
      onStart = null,
      onStop = null,
      onTranscript = null,
      onError = null,
    } = {}) => {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        throw new Error("MediaRecorder microphone capture is not supported");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMime = pickRecorderMimeType();
      let recorder;
      try {
        recorder = preferredMime
          ? new MediaRecorder(stream, { mimeType: preferredMime })
          : new MediaRecorder(stream);
      } catch (err) {
        recorder = new MediaRecorder(stream);
      }

      let active = true;
      let processing = false;
      const queue = [];

      const processNext = async () => {
        if (!active || processing || queue.length === 0) return;
        processing = true;
        const chunk = queue.shift();

        try {
          if (!chunk || chunk.size < 600) return;
          const audioBase64 = await blobToBase64(chunk);
          const response = await phoneTranscribe({
            audioBase64,
            mimeType:
              chunk.type ||
              recorder.mimeType ||
              preferredMime ||
              "audio/webm",
            languageHint,
            context,
          });
          const text = String(response?.transcript || "").trim();
          if (text && typeof onTranscript === "function" && active) {
            onTranscript(text, response);
          }
        } catch (err) {
          if (active && typeof onError === "function") onError(err);
        } finally {
          processing = false;
          if (active) {
            void processNext();
          }
        }
      };

      recorder.ondataavailable = (event) => {
        if (!active) return;
        if (event?.data && event.data.size > 0) {
          queue.push(event.data);
          void processNext();
        }
      };

      recorder.start(timesliceMs);
      if (typeof onStart === "function") onStart();

      return () => {
        active = false;
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch (err) {}
        stream.getTracks().forEach((track) => track.stop());
        if (typeof onStop === "function") onStop();
      };
    },
    [],
  );

  const endCall = useCallback(() => {
    stopAudio();
    setPhase("idle");
    setUnlocked(false);
    setUnlocking(false);
    setCallData(null);
    setIncomingCallData(null);
    setCvDebug(null);
    setTranscript("");
    setCallDuration(0);
    isSearchingRef.current = false;
    searchStartTimeRef.current = 0;
    noObjectRoundsRef.current = 0;
    findFailRoundsRef.current = 0;
    callTimeLimitTriggeredRef.current = false;
    clearTimeout(searchIntervalRef.current);
  }, [stopAudio]);

  useEffect(() => {
    if (!unlocked || phase !== "ringing") return;

    let cancelled = false;
    setIncomingCallData(null);

    (async () => {
      try {
        const startData = await phoneStart(targetLanguage, NATIVE_LANGUAGE);
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
    callTimeLimitTriggeredRef.current = false;
    setPhase("connecting");
    setCallDuration(0);
    try {
      const startData =
        incomingCallData || (await phoneStart(targetLanguage, NATIVE_LANGUAGE));
      setIncomingCallData(startData);
      setCallData({
        friendName: startData.friendName,
        targetObject: startData.targetObject,
        targetObjectTranslated: startData.targetObjectTranslated,
        chosenLanguage: targetLanguage,
        gameMode: FIND_REQUESTED_MODE,
        struggled: false,
      });

      const { audioBase64, mimeType } = await speak(
        startData.script,
        null,
        targetLanguage,
      );
      setPhase("speaking_task");
      await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
        onEnded: () => setPhase("searching"),
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
          targetLanguage,
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

        const { audioBase64, mimeType } = await speak(
          replyData.script,
          null,
          replyData.chosenLanguage || NATIVE_LANGUAGE,
        );
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
          targetLanguage: targetLanguage,
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
        const { audioBase64, mimeType } = await speak(
          promptData?.script ||
            `I can see a ${objectName}. How do you say ${objectName} in ${targetLanguage}?`,
          null,
          NATIVE_LANGUAGE,
        );
        await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
          onEnded: () => {
            practiceGuessStartAtRef.current = Date.now();
            setPhase("listening_object_guess");
          },
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
          targetLanguage: targetLanguage,
          nativeLanguage: NATIVE_LANGUAGE,
        });

        const roundDurationMs =
          practiceGuessStartAtRef.current > 0
            ? Date.now() - practiceGuessStartAtRef.current
            : null;
        addLearnedWord(
          callData.practiceObjectTranslated,
          callData.practiceObject,
          roundDurationMs,
          true,
        );
        setCallData((prev) => ({ ...prev, awaitingPracticeGuess: false }));

        const { audioBase64, mimeType } = await speak(
          evalData?.finalScript ||
            `${callData.practiceObject} in ${targetLanguage} is "${callData.practiceObjectTranslated}". Thanks for helping me, bye!`,
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
            `Thanks for helping me. ${callData.practiceObject} in ${targetLanguage} is "${callData.practiceObjectTranslated}". Bye!`;
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
          targetLanguage: targetLanguage,
          nativeLanguage: NATIVE_LANGUAGE,
        });
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
        const inFindMode =
          (callData.gameMode || FIND_REQUESTED_MODE) === FIND_REQUESTED_MODE;
        if (inFindMode && isLikelyConfusionText(spokenText)) {
          const fallbackScript =
            `Oh sorry, the thing I'm looking for is ${callData.targetObject}. ` +
            "Maybe I'll call you back another time, I gotta go now!";
          const elapsedMs =
            searchStartTimeRef.current > 0
              ? Date.now() - searchStartTimeRef.current
              : null;
          addLearnedWord(
            callData.targetObjectTranslated || callData.targetObject,
            callData.targetObject,
            elapsedMs,
            false,
          );
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
          targetLanguage: targetLanguage,
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
    let active = true;
    let submitted = false;
    let stopSession = () => {};
    let idleFinalizeTimer = null;
    let noSpeechTimer = null;
    let transcriptSoFar = "";

    const appendChunk = (base, chunk) => {
      const nextChunk = String(chunk || "").trim();
      if (!nextChunk) return base;
      if (!base) return nextChunk;
      if (normText(base).endsWith(normText(nextChunk))) return base;
      return `${base} ${nextChunk}`.trim();
    };

    const submitPreference = (text) => {
      if (!active || submitted) return;
      submitted = true;
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      if (noSpeechTimer) clearTimeout(noSpeechTimer);
      const trimmed = String(text || "").trim();
      processPreference(trimmed || "English");
    };

    (async () => {
      try {
        stopSession = await startGeminiMicSession({
          languageHint: "en-US",
          context: "choose_language_preference",
          timesliceMs: 1500,
          onStart: () => {
            setTranscript("");
            setIsListening(true);
          },
          onStop: () => {
            setIsListening(false);
          },
          onTranscript: (chunkText) => {
            if (submitted || !active) return;
            transcriptSoFar = appendChunk(transcriptSoFar, chunkText);
            if (transcriptSoFar) setTranscript(transcriptSoFar);

            if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
            idleFinalizeTimer = setTimeout(
              () => submitPreference(transcriptSoFar),
              900,
            );
          },
          onError: (err) => {
            console.error("Gemini STT (preference) error:", err);
          },
        });

        if (!active) {
          stopSession();
          return;
        }

        noSpeechTimer = setTimeout(() => {
          submitPreference(transcriptSoFar);
        }, 8000);
      } catch (err) {
        console.error("Gemini STT (preference) start failed:", err);
        setIsListening(false);
        submitPreference("English");
      }
    })();

    return () => {
      active = false;
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      if (noSpeechTimer) clearTimeout(noSpeechTimer);
      stopSession();
    };
  }, [phase, processPreference, startGeminiMicSession]);

  useEffect(() => {
    if (phase !== "listening_object_guess") return;
    let active = true;
    let submitted = false;
    let stopSession = () => {};
    let idleFinalizeTimer = null;
    let noSpeechTimer = null;
    let transcriptSoFar = "";

    const appendChunk = (base, chunk) => {
      const nextChunk = String(chunk || "").trim();
      if (!nextChunk) return base;
      if (!base) return nextChunk;
      if (normText(base).endsWith(normText(nextChunk))) return base;
      return `${base} ${nextChunk}`.trim();
    };

    const submitGuess = (text) => {
      if (!active || submitted) return;
      submitted = true;
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      if (noSpeechTimer) clearTimeout(noSpeechTimer);
      void handleEnglishPracticeGuess(String(text || "").trim());
    };

    (async () => {
      try {
        stopSession = await startGeminiMicSession({
          languageHint: getLanguageLocale(targetLanguage, "pt-BR"),
          context: "guess_object_word",
          timesliceMs: 1500,
          onStart: () => {
            setTranscript("");
            setIsListening(true);
          },
          onStop: () => {
            setIsListening(false);
          },
          onTranscript: (chunkText) => {
            if (submitted || !active) return;
            transcriptSoFar = appendChunk(transcriptSoFar, chunkText);
            if (transcriptSoFar) setTranscript(transcriptSoFar);
            if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
            idleFinalizeTimer = setTimeout(() => submitGuess(transcriptSoFar), 700);
          },
          onError: (err) => {
            console.error("Gemini STT (object_guess) error:", err);
          },
        });

        if (!active) {
          stopSession();
          return;
        }

        noSpeechTimer = setTimeout(() => submitGuess(transcriptSoFar), 5500);
      } catch (err) {
        console.error("Gemini STT (object_guess) start failed:", err);
        setIsListening(false);
        submitGuess("");
      }
    })();

    return () => {
      active = false;
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      if (noSpeechTimer) clearTimeout(noSpeechTimer);
      stopSession();
    };
  }, [phase, handleEnglishPracticeGuess, startGeminiMicSession]);

  const handleHelpButton = useCallback(async () => {
    if (!callData || interruptBusyRef.current) return;
    interruptBusyRef.current = true;
    isSearchingRef.current = false;
    clearTimeout(searchIntervalRef.current);
    setPhase("speaking_interrupt");
    const elapsedMs = searchStartTimeRef.current > 0 ? Date.now() - searchStartTimeRef.current : null;
    addLearnedWord(
      callData.targetObjectTranslated || callData.targetObject,
      callData.targetObject,
      elapsedMs,
      false,
    );
    try {
      const script =
        `Oh sorry, the thing I'm looking for is ${callData.targetObject}. ` +
        "Maybe I'll call you back another time, I gotta go now!";
      const { audioBase64, mimeType } = await speak(script, null, NATIVE_LANGUAGE);
      await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
        onEnded: () => endCall(),
      });
    } catch (err) {
      console.error(err);
      endCall();
    } finally {
      interruptBusyRef.current = false;
    }
  }, [callData, playAudioSource, addLearnedWord, endCall]);

  const handleStruggle = useCallback(async () => {
    isSearchingRef.current = false;
    setPhase("speaking_struggle");

    try {
      const stData = await phoneStruggle(
        callData.friendName,
        callData.targetObject,
        targetLanguage,
        NATIVE_LANGUAGE,
      );

      setCallData((prev) => ({ ...prev, struggled: true }));

      const { audioBase64, mimeType } = await speak(
        stData.script,
        null,
        callData?.chosenLanguage || NATIVE_LANGUAGE,
      );
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
        targetLanguage,
        NATIVE_LANGUAGE,
      );
      const elapsedMs =
        searchStartTimeRef.current > 0
          ? Date.now() - searchStartTimeRef.current
          : null;
      addLearnedWord(
        callData.targetObjectTranslated || callData.targetObject,
        callData.targetObject,
        elapsedMs,
        true,
      );

      const { audioBase64, mimeType } = await speak(
        fData.script,
        null,
        callData?.chosenLanguage || NATIVE_LANGUAGE,
      );
      await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
        onEnded: () => endCall(),
      });
    } catch (err) {
      console.error(err);
      endCall();
    }
  }, [callData, playAudioSource, addLearnedWord, endCall]);

  const handleFindGiveUp = useCallback(async () => {
    if (!callData) return;
    isSearchingRef.current = false;
    setPhase("speaking_found");
    try {
      const translated = callData.targetObjectTranslated || callData.targetObject;
      const englishWord = callData.targetObject || translated;
      const revealScript =
        `Thanks for trying. The ${targetLanguage} word for ${englishWord} is "${translated}". ` +
        "Thank you anyway, I need to leave for now. Bye!";
      const elapsedMs =
        searchStartTimeRef.current > 0
          ? Date.now() - searchStartTimeRef.current
          : null;
      addLearnedWord(translated, englishWord, elapsedMs, false);
      const { audioBase64, mimeType } = await speak(
        revealScript,
        null,
        callData?.chosenLanguage || targetLanguage,
      );
      await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
        onEnded: () => endCall(),
      });
    } catch (err) {
      console.error("Find give-up error:", err);
      endCall();
    }
  }, [callData, playAudioSource, addLearnedWord, endCall]);

  useEffect(() => {
    if (!callData) return;
    if (callDuration < 60) return;
    if (callTimeLimitTriggeredRef.current) return;

    const callActivePhases = new Set([
      "connecting",
      "speaking_task",
      "searching",
      "speaking_yap",
      "speaking_interrupt",
      "speaking_found",
      "speaking_struggle",
      "speaking_object_prompt",
      "listening_object_guess",
      "processing_object_guess",
    ]);
    if (!callActivePhases.has(phase)) return;

    callTimeLimitTriggeredRef.current = true;
    isSearchingRef.current = false;
    clearTimeout(searchIntervalRef.current);
    setPhase("speaking_found");

    const timeoutScript =
      "Sorry, I gotta go for now, I have some stuff to do. Thanks for helping me today. Bye!";

    void speak(timeoutScript, null, callData?.chosenLanguage || targetLanguage)
      .then(({ audioBase64, mimeType }) =>
        playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
          onEnded: () => endCall(),
        }),
      )
      .catch((err) => {
        console.error("Call timeout end error:", err);
        endCall();
      });
  }, [callDuration, phase, callData, playAudioSource, endCall]);

  useEffect(() => {
    if (phase !== "searching" || !callData) return;

    isSearchingRef.current = true;
    if (searchStartTimeRef.current === 0) searchStartTimeRef.current = Date.now();
    struggledRef.current = false;
    noObjectRoundsRef.current = 0;
    findFailRoundsRef.current = 0;
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
            if (!isEnglishPractice) {
              findFailRoundsRef.current += 1;
              if (findFailRoundsRef.current >= MAX_FIND_FAIL_ROUNDS) {
                isSearchingRef.current = false;
                clearTimeout(searchIntervalRef.current);
                await handleFindGiveUp();
                return;
              }
            }
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

      if (isSearchingRef.current) {
        searchIntervalRef.current = setTimeout(checkLoop, 2000);
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
    handleFindGiveUp,
    handleStruggle,
    handleSearchYap,
    handleEnglishPracticePrompt,
  ]);

  useEffect(() => {
    if (phase !== "searching") return;
    let active = true;
    let stopSession = () => {};
    let interruptionBusy = false;

    (async () => {
      try {
        stopSession = await startGeminiMicSession({
          languageHint: "en-US",
          context: "live_call_interruption",
          timesliceMs: 1800,
          onStart: () => {
            setIsListening(true);
          },
          onStop: () => {
            setIsListening(false);
          },
          onTranscript: (chunkText) => {
            if (!active || interruptionBusy) return;
            const spoken = String(chunkText || "").trim();
            if (spoken.length < 3) return;
            console.log("[voice-interruption]", {
              spoken,
              phase,
              isListening: true,
            });
            interruptionBusy = true;
            void handleInterruption(spoken)
              .then((handled) => {
                if (handled && active) {
                  stopSession();
                }
              })
              .finally(() => {
                interruptionBusy = false;
              });
          },
          onError: (err) => {
            console.error("Gemini STT (search interruption) error:", err);
          },
        });

        if (!active) {
          stopSession();
        }
      } catch (err) {
        console.error("Gemini STT (search interruption) start failed:", err);
        setIsListening(false);
      }
    })();

    return () => {
      active = false;
      stopSession();
    };
  }, [phase, handleInterruption, callData, startGeminiMicSession]);

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
  const todaysWordStats = learnedWords
    .filter((item) => item && typeof item === "object")
    .filter((item) => isSameLocalDay(item.learnedAt, currentTime))
    .slice(-8);

  // ── Boot: Hello screen ──────────────────────────────────────────────────────
  if (bootPhase === "hello") {
    // Check for previous language progress to show SIMP card
    let prevLangCard = null;
    if (typeof window !== "undefined" && window.__SIMP_PREV_LANG && window.__SIMP_PREV_LANG.lang && Array.isArray(window.__SIMP_PREV_LANG.words)) {
      const prev = window.__SIMP_PREV_LANG;
      prevLangCard = (
        <div style={{
          margin: "24px auto 0 auto",
          background: "rgba(255,255,255,0.13)",
          borderRadius: 18,
          padding: "18px 22px 14px 22px",
          maxWidth: 340,
          boxShadow: "0 2px 12px 0 rgba(0,0,0,0.10)",
          color: "#fff",
          textAlign: "center",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
        }}>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>SIMP in {prev.lang}</div>
          <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 8 }}>Words learnt: {prev.words.length}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
            {prev.words.slice(-8).map((w, i) => (
              <span key={i} style={{
                background: "rgba(255,255,255,0.18)",
                borderRadius: 8,
                padding: "3px 9px",
                fontSize: 13,
                marginBottom: 2,
                color: "#fff",
                fontWeight: 500,
                letterSpacing: 0.1,
              }}>{w.targetWord}</span>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div
        className={`boot-screen${bootFadingOut ? " boot-fade-out" : ""}`}
        onAnimationEnd={() => {
          if (bootFadingOut) {
            setBootFadingOut(false);
            setBootPhase("language");
            // Clear prev lang card after showing once
            if (typeof window !== "undefined") window.__SIMP_PREV_LANG = null;
          }
        }}
      >
        {[
          { left: "8%",  size: "1.2rem", delay: "0s",   dur: "7s"  },
          { left: "20%", size: "0.9rem", delay: "1.5s", dur: "9s"  },
          { left: "35%", size: "1.5rem", delay: "3s",   dur: "8s"  },
          { left: "55%", size: "1.1rem", delay: "0.7s", dur: "11s" },
          { left: "70%", size: "1.4rem", delay: "2s",   dur: "7.5s"},
          { left: "85%", size: "0.8rem", delay: "4s",   dur: "10s" },
          { left: "48%", size: "1.3rem", delay: "3.5s", dur: "6.5s"},
          { left: "92%", size: "1rem",   delay: "0.3s", dur: "10s" },
        ].map((h, i) => (
          <span
            key={i}
            className="floating-heart"
            style={{ left: h.left, bottom: "-5%", fontSize: h.size, animationDelay: h.delay, animationDuration: h.dur }}
          >🤍</span>
        ))}
        <span className="boot-hello">Hello,</span>
        <span className="boot-simp">Simp.</span>
        {prevLangCard}
      </div>
    );
  }

  // ── Boot: Language picker ────────────────────────────────────────────────────
  if (bootPhase === "language") {
    return (
      <div
        className={`boot-screen boot-language-screen${bootFadingOut ? " boot-fade-out" : ""}`}
        onAnimationEnd={() => {
          if (bootFadingOut) {
            setBootFadingOut(false);
            setBootPhase(null);
          }
        }}
      >
        {[
          { left: "8%",  size: "1.2rem", delay: "0s",   dur: "7s"  },
          { left: "20%", size: "0.9rem", delay: "1.5s", dur: "9s"  },
          { left: "35%", size: "1.5rem", delay: "3s",   dur: "8s"  },
          { left: "55%", size: "1.1rem", delay: "0.7s", dur: "11s" },
          { left: "70%", size: "1.4rem", delay: "2s",   dur: "7.5s"},
          { left: "85%", size: "0.8rem", delay: "4s",   dur: "10s" },
          { left: "48%", size: "1.3rem", delay: "3.5s", dur: "6.5s"},
          { left: "92%", size: "1rem",   delay: "0.3s", dur: "10s" },
        ].map((h, i) => (
          <span
            key={i}
            className="floating-heart"
            style={{ left: h.left, bottom: "-5%", fontSize: h.size, animationDelay: h.delay, animationDuration: h.dur }}
          >🤍</span>
        ))}
        <p className="boot-lang-eyebrow">Welcome to Simp</p>
        <h1 className="boot-lang-title">Choose your language</h1>
        <p className="boot-lang-desc">
          Your long-distance lover keeps calling — but they speak a different language.{" "}
          <strong>SIMP</strong> teaches you vocabulary through real conversations: pick up the call,
          listen to what they need, and find it. One word at a time, one call at a time.
        </p>
        <div className="boot-lang-list">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.name}
              className="boot-lang-row"
              onClick={() => {
                try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang.name); } catch {}
                setTargetLanguage(lang.name);
                requestMediaPermissions().catch(console.warn);
                setBootFadingOut(true);
              }}
            >
              <span className="boot-lang-flag">{lang.flag}</span>
              <span className="boot-lang-name">{lang.name}</span>
              <span className="boot-lang-chevron">›</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

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
            background: "linear-gradient(160deg, #1a0520 0%, #2e0d38 45%, #1a0520 100%)",
            color: "white",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
            userSelect: "none",
            touchAction: "none",
            transform: unlocking
              ? "translateY(-105vh)"
              : `translateY(${Math.min(0, swipeDelta)}px)`,
            transition: unlocking ? "transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)" : "none",
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
              setUnlocking(true);
              setTimeout(() => void completeUnlock(), 380);
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
              setUnlocking(true);
              setTimeout(() => void completeUnlock(), 380);
            }
            setSwipeStartY(null);
            setSwipeDelta(0);
          }}
        >
          {/* Floating hearts background */}

          {[
            { left: "8%",  size: "1.4rem", delay: "0s",   dur: "7s"  },
            { left: "18%", size: "1rem",   delay: "1.5s", dur: "9s"  },
            { left: "30%", size: "1.8rem", delay: "3s",   dur: "8s"  },
            { left: "42%", size: "1.1rem", delay: "0.7s", dur: "11s" },
            { left: "55%", size: "1.5rem", delay: "2s",   dur: "7.5s"},
            { left: "65%", size: "0.9rem", delay: "4s",   dur: "10s" },
            { left: "75%", size: "1.6rem", delay: "1s",   dur: "8.5s"},
            { left: "85%", size: "1.2rem", delay: "2.8s", dur: "9.5s"},
            { left: "22%", size: "0.8rem", delay: "5s",   dur: "12s" },
            { left: "50%", size: "1.3rem", delay: "3.5s", dur: "6.5s"},
            { left: "92%", size: "1rem",   delay: "0.3s", dur: "10s" },
            { left: "38%", size: "0.9rem", delay: "6s",   dur: "8s"  },
          ].map((h, i) => (
            <span
              key={i}
              className="floating-heart"
              style={{
                left: h.left,
                bottom: "-5%",
                fontSize: h.size,
                animationDelay: h.delay,
                animationDuration: h.dur,
              }}
            >
              🤍
            </span>
          ))}

          <div
            style={{
              paddingTop: 36,
              fontSize: 64,
              fontWeight: 600,
              marginBottom: 8,
              letterSpacing: -1,
            }}
          >
            {currentTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </div>
          <div style={{ fontSize: 18, opacity: 0.7, marginBottom: 40 }}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          {/* Notification-style words learnt */}
          <div style={{
            width: "min(88vw, 380px)",
            marginBottom: 12,
          }}>
            {/* Header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 8,
              paddingLeft: 4,
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 5,
                background: "linear-gradient(135deg, #e8326a, #ff6b9d)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10,
              }}>📞</div>
              <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.55, letterSpacing: 0.3, textTransform: "uppercase" }}>simp in ♡ {targetLanguage}</span>
              <span style={{ fontSize: 12, opacity: 0.4, marginLeft: "auto" }}>now</span>
            </div>

            {todaysWordStats.length ? (
              todaysWordStats.map((entry, index) => (
                <div
                  key={`${entry.targetWord}-${entry.learnedAt}-${index}`}
                  style={{
                    background: "rgba(255,255,255,0.12)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    borderRadius: 14,
                    padding: "11px 14px",
                    marginBottom: index === todaysWordStats.length - 1 ? 0 : 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div style={{ position: "relative", width: 36, height: 36, flexShrink: 0 }}>
                    {wordImages[entry.nativeWord?.toLowerCase().trim()] ? (
                      <img
                        src={wordImages[entry.nativeWord.toLowerCase().trim()]}
                        alt={entry.nativeWord}
                        style={{ width: 36, height: 36, borderRadius: 10, objectFit: "cover" }}
                      />
                    ) : (
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: entry.guessed === false
                          ? "linear-gradient(135deg, #f43f5e, #fb7185)"
                          : "linear-gradient(135deg, #22c55e, #4ade80)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 18, color: "white",
                      }}>
                        {entry.guessed === false ? "✘" : "✔"}
                      </div>
                    )}
                    {wordImages[entry.nativeWord?.toLowerCase().trim()] && (
                      <div style={{
                        position: "absolute", bottom: -3, right: -3,
                        width: 14, height: 14, borderRadius: "50%",
                        background: entry.guessed === false ? "#f43f5e" : "#22c55e",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 8, color: "white", fontWeight: 700,
                        border: "1.5px solid rgba(0,0,0,0.3)",
                      }}>
                        {entry.guessed === false ? "✘" : "✔"}
                      </div>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.1 }}>
                      {entry.targetWord}
                    </div>
                    <div style={{ fontSize: 12.5, opacity: 0.6, marginTop: 1 }}>
                      {entry.nativeWord || "—"} · {formatGuessDuration(entry.durationMs)}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{
                background: "rgba(255,255,255,0.12)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                borderRadius: 14,
                padding: "13px 16px",
                fontSize: 14,
                opacity: 0.6,
              }}>
                No words learnt yet today
              </div>
            )}
          </div>
          
          {/* Reset Language Button (smaller, below words learnt) */}
          <button
            className="reset-language-btn"
            style={{
              margin: "10px auto 0 auto",
              background: "rgba(255,255,255,0.13)",
              border: "none",
              borderRadius: 14,
              padding: "5px 14px",
              color: "#fff",
              fontWeight: 500,
              fontSize: 13,
              boxShadow: "0 1px 6px 0 rgba(0,0,0,0.10)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              letterSpacing: 0.1,
              cursor: "pointer",
              zIndex: 2000,
              transition: "background 0.18s",
              display: "block",
              opacity: 0.5,
            }}
            onClick={() => {
              // Save current language and learned words
              let prevLang = null, prevWords = null;
              try {
                prevLang = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
                prevWords = window.localStorage.getItem(LEARNED_WORDS_STORAGE_KEY);
              } catch {}
              // Remove language and progress
              try {
                window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
                window.localStorage.removeItem(LEARNED_WORDS_STORAGE_KEY);
              } catch {}
              setTargetLanguage(DEFAULT_TARGET_LANGUAGE);
              setLearnedWords([]);
              setBootFadingOut(false);
              setUnlocked(false);
              setPhase("idle");
              setBootPhase("hello");
              // Show SIMP card for previous language if progress existed
              if (prevLang && prevWords) {
                try {
                  const words = JSON.parse(prevWords);
                  if (Array.isArray(words) && words.length > 0) {
                    window.__SIMP_PREV_LANG = { lang: prevLang, words };
                  } else {
                    window.__SIMP_PREV_LANG = null;
                  }
                } catch { window.__SIMP_PREV_LANG = null; }
              } else {
                window.__SIMP_PREV_LANG = null;
              }
            }}
          >
            Reset SIMP
          </button>

          <div style={{ flex: 1 }} />
          
          {/* Swipe up hint */}
          <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, opacity: 0.45, letterSpacing: 0.3 }}>Swipe up to learn</span>
            {/* iPhone home indicator */}
            <div style={{
              width: 134,
              height: 5,
              borderRadius: 3,
              background: "rgba(255,255,255,0.35)",
              marginBottom: 8,
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
            facingMode={facingMode}
            onReady={() => {}}
            onError={setCameraError}
          />

          {/* Incoming Call Screen */}
          {phase === "ringing" && (
            <div className="ios-call-screen">
              <div className="ios-caller-info">
                <div className="ios-avatar">👤</div>
                <h2 className="ios-caller-name">
                  {incomingCallData?.friendName || "Incoming Call"} ❤️
                </h2>
                <p className="ios-caller-status">{getCallerLocation(targetLanguage)}</p>
                <p className="ios-caller-status">SIMP Video</p>
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
                    <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
                      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                    </svg>
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
                {phase === "processing_preference" && (
                  <span className="facetime-status-pill">Thinking...</span>
                )}
                {phase === "processing_object_guess" && (
                  <span className="facetime-status-pill">Checking your word...</span>
                )}
                {phase.startsWith("speaking") && (
                  <span className="facetime-status-pill pulse">🗣️ Speaking...</span>
                )}
                {phase === "searching" && (
                  <span className="facetime-status-pill pulse">👀 Searching...</span>
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
              </div>

              {/* Bottom controls */}
              <div className="facetime-controls">
                <div className="facetime-btn-row">
                  <div className="facetime-btn-item">
                    <button className="facetime-ctrl-btn" onClick={handleHelpButton}>
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>
                    </button>
                    <span className="facetime-btn-label">help</span>
                  </div>
                  <div className="facetime-btn-item">
                    <button className="facetime-ctrl-btn" onClick={() => setFacingMode(m => m === "environment" ? "user" : "environment")}>
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
                    ? `Practice: name nearby objects in ${targetLanguage}`
                    : SHOW_BBOX ? `Find: ${callData?.targetObject}` : "🔍 Searching..."}
                </h2>
                <p
                  className="ios-active-time"
                  style={{ color: "white", fontWeight: 500 }}
                >
                  {formatTime(callDuration)}
                </p>
                <p
                  className="ios-active-time"
                  style={{ color: "white", fontWeight: 500, marginTop: "4px" }}
                >
                  {`Mic: ${isListening ? "listening" : "idle"}`}
                </p>
                <div
                  className="pulse"
                  style={{ marginTop: "10px", fontSize: "2rem" }}
                >
                  🔍
                </div>
              </div>


              {SHOW_BBOX && (cvDebug?.targetBoundingBox ||
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
