import { useRef, useState, useEffect, useCallback } from "react";
import CameraView from "./components/CameraView.jsx";
import {
  speak,
  phoneStart,
  phoneConfirmLocation,
  phonePlanDestination,
  phoneRouteYap,
  phoneArrived,
  phoneReply,
  phoneYap,
  phoneInterrupt,
  phoneEnglishPrompt,
  phoneEnglishEvaluate,
  phoneFound,
  phoneCheckCv,
} from "./services/api.js";

const NATIVE_LANGUAGE = "English";
const TARGET_LANGUAGE = "English";
const ENGLISH_PRACTICE_MODE = "english_practice";
const FIND_REQUESTED_MODE = "find_requested";
const TREASURE_CALL_MODE = "fitness_treasure";
const FITNESS_PROGRESS_STORAGE_KEY = "lingualens.fitness_progress_v1";
const TREASURE_OBJECT_POOL = [
  "keys",
  "mug",
  "shoe",
  "book",
  "water bottle",
  "headphones",
  "wallet",
  "glasses",
  "remote control",
  "backpack",
  "laptop",
  "toothbrush",
  "plate",
  "banana",
  "apple",
];

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

function pickNextTreasureTarget(currentTarget, retrievedObjects = []) {
  const used = new Set(
    (Array.isArray(retrievedObjects) ? retrievedObjects : []).map((v) =>
      normText(v),
    ),
  );
  let candidates = TREASURE_OBJECT_POOL.filter(
    (item) => normText(item) !== normText(currentTarget) && !used.has(normText(item)),
  );
  if (candidates.length === 0) {
    candidates = TREASURE_OBJECT_POOL.filter(
      (item) => normText(item) !== normText(currentTarget),
    );
  }
  if (candidates.length === 0) return currentTarget || TREASURE_OBJECT_POOL[0];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function formatRouteTimestamp(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  const [sessionSteps, setSessionSteps] = useState(0);
  const [sessionRetrievedObjects, setSessionRetrievedObjects] = useState([]);
  const [currentGps, setCurrentGps] = useState(null);
  const [gpsDebugError, setGpsDebugError] = useState("");
  const [routeDistanceMeters, setRouteDistanceMeters] = useState(null);
  const [fitnessProgress, setFitnessProgress] = useState({
    totalSteps: 0,
    totalRetrievedObjects: [],
    lastSessionSteps: 0,
    lastSessionRetrievedObjects: [],
    lastSessionRoute: null,
  });

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
  const motionStepHighRef = useRef(false);
  const lastStepAtRef = useRef(0);
  const geoWatchIdRef = useRef(null);
  const currentGpsRef = useRef(null);
  const routeNoProgressRoundsRef = useRef(0);
  const lastRouteDistanceRef = useRef(null);
  const arrivedRef = useRef(false);

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

    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      try {
        await DeviceMotionEvent.requestPermission();
      } catch (err) {
        console.warn("Motion permission not granted:", err);
      }
    }
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
      const raw = window.localStorage.getItem(FITNESS_PROGRESS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setFitnessProgress({
          totalSteps: Number(parsed.totalSteps) || 0,
          totalRetrievedObjects: Array.isArray(parsed.totalRetrievedObjects)
            ? parsed.totalRetrievedObjects
                .filter((v) => typeof v === "string")
                .slice(-200)
            : [],
          lastSessionSteps: Number(parsed.lastSessionSteps) || 0,
          lastSessionRetrievedObjects: Array.isArray(
            parsed.lastSessionRetrievedObjects,
          )
            ? parsed.lastSessionRetrievedObjects
                .filter((v) => typeof v === "string")
                .slice(-50)
            : [],
          lastSessionRoute:
            parsed.lastSessionRoute && typeof parsed.lastSessionRoute === "object"
              ? parsed.lastSessionRoute
              : null,
        });
      }
    } catch (err) {
      console.warn("Failed to load fitness progress:", err);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        FITNESS_PROGRESS_STORAGE_KEY,
        JSON.stringify(fitnessProgress),
      );
    } catch (err) {
      console.warn("Failed to persist fitness progress:", err);
    }
  }, [fitnessProgress]);

  // Legacy no-op for older language-learning branches that are no longer active.
  const addLearnedWord = useCallback(() => {}, []);

  const getCurrentPositionOnce = useCallback(async () => {
    if (!navigator.geolocation) {
      throw new Error("Geolocation not supported");
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: Date.now(),
          });
        },
        (err) => reject(err),
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 3000,
        },
      );
    });
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    if (typeof window === "undefined") return;

    const activePhases = new Set([
      "connecting",
      "speaking_intro",
      "speaking_task",
      "searching",
      "speaking_found",
      "speaking_yap",
      "speaking_interrupt",
    ]);

    const onMotion = (event) => {
      if (!activePhases.has(phase)) return;
      const accel = event?.accelerationIncludingGravity;
      if (!accel) return;

      const x = Number(accel.x) || 0;
      const y = Number(accel.y) || 0;
      const z = Number(accel.z) || 0;
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const delta = Math.abs(magnitude - 9.81);
      const isHigh = delta > 1.15;
      const now = Date.now();

      if (
        isHigh &&
        !motionStepHighRef.current &&
        now - lastStepAtRef.current > 320
      ) {
        lastStepAtRef.current = now;
        setSessionSteps((prev) => prev + 1);
      }
      motionStepHighRef.current = isHigh;
    };

    window.addEventListener("devicemotion", onMotion);
    return () => {
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [unlocked, phase]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsDebugError("Geolocation not supported on this device/browser");
      return;
    }

    if (geoWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(geoWatchIdRef.current);
      geoWatchIdRef.current = null;
    }

    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const nextGps = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: Date.now(),
        };
        setGpsDebugError("");
        currentGpsRef.current = nextGps;
        setCurrentGps(nextGps);
      },
      (err) => {
        console.warn("GPS watch error:", err);
        setGpsDebugError(err?.message || "Unable to read GPS");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 12000,
      },
    );

    return () => {
      if (geoWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
        geoWatchIdRef.current = null;
      }
      currentGpsRef.current = null;
    };
  }, []);

  const endCall = useCallback(() => {
    const completedSessionRetrieved = Array.isArray(sessionRetrievedObjects)
      ? sessionRetrievedObjects.filter((v) => typeof v === "string")
      : [];
    const completedSessionSteps = Number(sessionSteps) || 0;

    if (completedSessionSteps > 0 || completedSessionRetrieved.length > 0) {
      const routeSummary =
        callData?.originPlaceName && callData?.destinationName
          ? {
              from: callData.originPlaceName,
              to: callData.destinationName,
              steps: completedSessionSteps,
              at: new Date().toISOString(),
            }
          : null;
      setFitnessProgress((prev) => ({
        totalSteps: (Number(prev.totalSteps) || 0) + completedSessionSteps,
        totalRetrievedObjects: [
          ...(Array.isArray(prev.totalRetrievedObjects)
            ? prev.totalRetrievedObjects
            : []),
          ...completedSessionRetrieved,
        ].slice(-400),
        lastSessionSteps: completedSessionSteps,
        lastSessionRetrievedObjects: completedSessionRetrieved.slice(-30),
        lastSessionRoute: routeSummary || prev.lastSessionRoute || null,
      }));
    }

    stopAudio();
    setPhase("idle");
    setUnlocked(false);
    setCallData(null);
    setIncomingCallData(null);
    setCvDebug(null);
    setCurrentGps(null);
    setRouteDistanceMeters(null);
    setGpsDebugError("");
    currentGpsRef.current = null;
    setTranscript("");
    setCallDuration(0);
    setSessionSteps(0);
    setSessionRetrievedObjects([]);
    arrivedRef.current = false;
    routeNoProgressRoundsRef.current = 0;
    lastRouteDistanceRef.current = null;
    isSearchingRef.current = false;
    noObjectRoundsRef.current = 0;
    clearTimeout(searchIntervalRef.current);
  }, [stopAudio, sessionRetrievedObjects, sessionSteps, callData]);

  useEffect(() => {
    if (!unlocked || phase !== "ringing") return;

    let cancelled = false;
    setIncomingCallData(null);

    (async () => {
      try {
        const startData = await phoneStart(NATIVE_LANGUAGE, NATIVE_LANGUAGE);
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
      "listening_location",
      "processing_location",
      "speaking_location_confirm",
      "listening_time_budget",
      "processing_time_budget",
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
    setSessionSteps(0);
    setSessionRetrievedObjects([]);
    motionStepHighRef.current = false;
    lastStepAtRef.current = 0;
    routeNoProgressRoundsRef.current = 0;
    lastRouteDistanceRef.current = null;
    arrivedRef.current = false;
    try {
      const startData =
        incomingCallData || (await phoneStart(NATIVE_LANGUAGE, NATIVE_LANGUAGE));
      setIncomingCallData(startData);
      setCallData({
        friendName: startData.friendName,
        targetObject: "",
        targetObjectTranslated: "",
        chosenLanguage: NATIVE_LANGUAGE,
        gameMode: "walk_meetup",
        retrievedObjects: [],
        originPlaceName: "",
        destinationName: "",
        destinationLatitude: null,
        destinationLongitude: null,
        arrivalRadiusMeters: 55,
        timeBudgetReply: "",
        storySeed: "",
        startedAtIso: new Date().toISOString(),
      });

      const { audioBase64, mimeType } = await speak(
        startData.script,
        null,
        NATIVE_LANGUAGE,
      );
      setPhase("speaking_intro");
      await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
        onEnded: () => setPhase("listening_location"),
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

  const processLocationReply = useCallback(
    async (spokenText) => {
      if (!callData) return;
      setPhase("processing_location");
      setTranscript(spokenText || "");

      try {
        const gps = currentGps || (await getCurrentPositionOnce());
        const locationData = await phoneConfirmLocation({
          friendName: callData.friendName,
          transcript: spokenText,
          latitude: gps.latitude,
          longitude: gps.longitude,
          nativeLanguage: NATIVE_LANGUAGE,
        });

        setCallData((prev) => ({
          ...prev,
          originPlaceName: locationData.confirmedPlaceName || prev.originPlaceName,
          originLatitude: gps.latitude,
          originLongitude: gps.longitude,
          locationClaim: spokenText,
        }));

        const locationConfirmScript = `${
          locationData.script ||
          `Nice, I got your location around ${locationData.confirmedPlaceName || "there"}.`
        } Do you have a short time, or around ten minutes?`;

        const { audioBase64, mimeType } = await speak(
          locationConfirmScript,
          null,
          NATIVE_LANGUAGE,
        );
        setPhase("speaking_location_confirm");
        await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
          onEnded: () => setPhase("listening_time_budget"),
        });
      } catch (err) {
        console.error("processLocationReply error:", err);
        try {
          const fallback =
            "I couldn't confirm your exact spot yet. Can you share it again and keep location enabled?";
          const { audioBase64, mimeType } = await speak(
            fallback,
            null,
            NATIVE_LANGUAGE,
          );
          setPhase("speaking_location_confirm");
          await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
            onEnded: () => setPhase("listening_location"),
          });
        } catch (sErr) {
          console.error("processLocationReply fallback error:", sErr);
          setPhase("error");
        }
      }
    },
    [callData, currentGps, getCurrentPositionOnce, playAudioSource],
  );

  const processTimeBudgetReply = useCallback(
    async (spokenText) => {
      if (!callData) return;
      setPhase("processing_time_budget");
      setTranscript(spokenText || "");

      try {
        const gps = currentGps || (await getCurrentPositionOnce());
        const plan = await phonePlanDestination({
          friendName: callData.friendName,
          originPlaceName: callData.originPlaceName || "",
          latitude: gps.latitude,
          longitude: gps.longitude,
          timeBudgetReply: spokenText,
          nativeLanguage: NATIVE_LANGUAGE,
        });

        setCallData((prev) => ({
          ...prev,
          originPlaceName: plan.originPlaceName || prev.originPlaceName,
          originLatitude: gps.latitude,
          originLongitude: gps.longitude,
          destinationName: plan.destinationName,
          destinationLatitude: Number(plan.destinationLatitude),
          destinationLongitude: Number(plan.destinationLongitude),
          arrivalRadiusMeters: Number(plan.arrivalRadiusMeters) || 55,
          timeBudgetReply: spokenText,
          targetObject: plan.destinationName,
          storySeed: plan.storySeed || "",
        }));

        const { audioBase64, mimeType } = await speak(
          plan.script ||
            `Can you meet me at ${plan.destinationName}? It's about ${plan.walkMinutes || 2} minutes away.`,
          null,
          NATIVE_LANGUAGE,
        );
        setPhase("speaking_task");
        await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
          onEnded: () => setPhase("searching"),
        });
      } catch (err) {
        console.error("processTimeBudgetReply error:", err);
        setPhase("error");
      }
    },
    [callData, currentGps, getCurrentPositionOnce, playAudioSource],
  );

  const handleRouteYap = useCallback(
    async (distanceRemainingMeters) => {
      if (!callData) return false;

      setPhase("speaking_yap");
      try {
        const yData = await phoneRouteYap({
          friendName: callData.friendName,
          originPlaceName: callData.originPlaceName,
          destinationName: callData.destinationName,
          distanceRemainingMeters,
          stepCount: sessionSteps,
          sessionSeconds: callDuration,
          storySeed: callData.storySeed || "",
          noProgressRounds: routeNoProgressRoundsRef.current,
          nativeLanguage: NATIVE_LANGUAGE,
        });

        const { audioBase64, mimeType } = await speak(
          yData.script,
          null,
          NATIVE_LANGUAGE,
        );
        await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
          onEnded: () => setPhase("searching"),
        });
        return true;
      } catch (err) {
        console.error("Route yap error:", err);
        setPhase("searching");
        return false;
      }
    },
    [callData, sessionSteps, callDuration, playAudioSource],
  );

  const handleArrived = useCallback(async () => {
    if (!callData || arrivedRef.current) return;
    arrivedRef.current = true;
    isSearchingRef.current = false;
    setPhase("speaking_found");
    setSessionRetrievedObjects((prev) => [
      ...prev,
      callData.destinationName || "destination",
    ]);

    try {
      const aData = await phoneArrived({
        friendName: callData.friendName,
        originPlaceName: callData.originPlaceName,
        destinationName: callData.destinationName,
        stepCount: sessionSteps,
        sessionSeconds: callDuration,
        nativeLanguage: NATIVE_LANGUAGE,
      });
      const { audioBase64, mimeType } = await speak(
        aData.script,
        null,
        NATIVE_LANGUAGE,
      );
      await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
        onEnded: () => endCall(),
      });
    } catch (err) {
      console.error("handleArrived error:", err);
      endCall();
    }
  }, [callData, sessionSteps, callDuration, playAudioSource, endCall]);

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
          visibleObjects,
          focusObject,
          noObjectRounds: noObjectRoundsRef.current,
          stepCount: sessionSteps,
          retrievedObjects: callData.retrievedObjects || sessionRetrievedObjects,
          sessionSeconds: callDuration,
        });

        const { audioBase64, mimeType } = await speak(
          yData.script,
          null,
          NATIVE_LANGUAGE,
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
    [callData, playAudioSource, sessionSteps, sessionRetrievedObjects, callDuration],
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
        const iData = await phoneInterrupt({
          transcript: spokenText,
          friendName: callData.friendName,
          targetObject: callData.targetObject,
          visibleObjects: (cvDebug?.visibleObjectDetections || [])
            .map((d) => d?.name)
            .filter(Boolean),
        });

        const { audioBase64, mimeType } = await speak(
          iData.script,
          null,
          NATIVE_LANGUAGE,
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
    [callData, cvDebug, playAudioSource],
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
    if (phase !== "listening_location") return;

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

    const submitLocation = (text) => {
      const trimmed = (text || "").trim();
      if (!trimmed || submitted) return;
      submitted = true;
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      processLocationReply(trimmed);
    };

    const scheduleIdleFinalize = () => {
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      idleFinalizeTimer = setTimeout(() => {
        submitLocation(finalText || latestLiveText);
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
        submitLocation(finalText);
      } else if (latestLiveText) {
        scheduleIdleFinalize();
      }
    };
    recognition.onerror = (e) => {
      console.error("Location speech recognition error:", e);
    };
    recognition.onend = () => {
      setIsListening(false);
      if (!submitted && isActiveRef.current && phase === "listening_location") {
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
  }, [phase, processLocationReply]);

  useEffect(() => {
    if (phase !== "listening_time_budget") return;

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

    const submitTime = (text) => {
      const trimmed = (text || "").trim();
      if (!trimmed || submitted) return;
      submitted = true;
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      processTimeBudgetReply(trimmed);
    };

    const scheduleIdleFinalize = () => {
      if (idleFinalizeTimer) clearTimeout(idleFinalizeTimer);
      idleFinalizeTimer = setTimeout(() => {
        submitTime(finalText || latestLiveText);
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
        submitTime(finalText);
      } else if (latestLiveText) {
        scheduleIdleFinalize();
      }
    };
    recognition.onerror = (e) => {
      console.error("Time-budget speech recognition error:", e);
    };
    recognition.onend = () => {
      setIsListening(false);
      if (!submitted && isActiveRef.current && phase === "listening_time_budget") {
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
  }, [phase, processTimeBudgetReply]);

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

  const handleFound = useCallback(async () => {
    if (!callData?.targetObject) return;
    const foundObject = callData.targetObject;
    const updatedRetrieved = [
      ...(Array.isArray(callData.retrievedObjects)
        ? callData.retrievedObjects
        : []),
      foundObject,
    ];
    const nextTarget = pickNextTreasureTarget(foundObject, updatedRetrieved);

    setSessionRetrievedObjects((prev) => [...prev, foundObject]);
    setCallData((prev) => ({
      ...prev,
      retrievedObjects: updatedRetrieved,
      targetObject: nextTarget,
      targetObjectTranslated: nextTarget,
    }));

    setPhase("speaking_found");
    try {
      const fData = await phoneFound(
        callData.friendName,
        foundObject,
        nextTarget,
        updatedRetrieved,
        sessionSteps,
        callDuration,
      );

      const { audioBase64, mimeType } = await speak(
        fData.script,
        null,
        NATIVE_LANGUAGE,
      );
      await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
        onEnded: () => setPhase("searching"),
      });
    } catch (err) {
      console.error(err);
      try {
        const fallback = `Great work, you found ${foundObject}. Keep moving, next target is ${nextTarget}.`;
        const { audioBase64, mimeType } = await speak(
          fallback,
          null,
          NATIVE_LANGUAGE,
        );
        await playAudioSource(`data:${mimeType};base64,${audioBase64}`, {
          onEnded: () => setPhase("searching"),
        });
      } catch (sErr) {
        console.error("Found fallback error:", sErr);
        setPhase("searching");
      }
    }
  }, [callData, playAudioSource, sessionSteps, callDuration]);

  useEffect(() => {
    if (phase !== "searching" || !callData) return;

    if (callData.gameMode !== "walk_meetup") return;
    isSearchingRef.current = true;
    searchStartTimeRef.current = Date.now();
    routeNoProgressRoundsRef.current = 0;
    setRouteDistanceMeters(null);
    setCvDebug(null);

    const checkLoop = async () => {
      if (!isSearchingRef.current) return;
      try {
        const liveGps = currentGpsRef.current || (await getCurrentPositionOnce());
        const targetLat = Number(callData.destinationLatitude);
        const targetLon = Number(callData.destinationLongitude);

        if (
          !Number.isFinite(targetLat) ||
          !Number.isFinite(targetLon) ||
          !Number.isFinite(Number(liveGps?.latitude)) ||
          !Number.isFinite(Number(liveGps?.longitude))
        ) {
          searchIntervalRef.current = setTimeout(checkLoop, 2200);
          return;
        }

        const distance = haversineMeters(
          Number(liveGps.latitude),
          Number(liveGps.longitude),
          targetLat,
          targetLon,
        );
        const roundedDistance = Math.max(0, Math.round(distance));
        setRouteDistanceMeters(roundedDistance);

        if (lastRouteDistanceRef.current !== null) {
          const delta = lastRouteDistanceRef.current - roundedDistance;
          if (delta < 8) routeNoProgressRoundsRef.current += 1;
          else routeNoProgressRoundsRef.current = 0;
        }
        lastRouteDistanceRef.current = roundedDistance;

        const arrivalRadius = Number(callData.arrivalRadiusMeters) || 55;
        if (roundedDistance <= arrivalRadius && !arrivedRef.current) {
          isSearchingRef.current = false;
          await handleArrived();
          return;
        }

        const shouldYap =
          Date.now() - lastYapAtRef.current > 9000 && !interruptBusyRef.current;
        if (shouldYap) {
          isSearchingRef.current = false;
          clearTimeout(searchIntervalRef.current);
          lastYapAtRef.current = Date.now();
          await handleRouteYap(roundedDistance);
          return;
        }
      } catch (e) {
        console.error("Route loop error", e);
      }

      if (isSearchingRef.current) {
        searchIntervalRef.current = setTimeout(checkLoop, 2200);
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
    getCurrentPositionOnce,
    handleArrived,
    handleRouteYap,
  ]);

  useEffect(() => {
    if (phase !== "searching") return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
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
    "listening_location",
    "processing_location",
    "speaking_location_confirm",
    "listening_time_budget",
    "processing_time_budget",
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

  const gpsDebugLine1 = currentGps
    ? `${Number(currentGps.latitude).toFixed(6)}, ${Number(currentGps.longitude).toFixed(6)}`
    : "Waiting for GPS fix...";
  const gpsDebugLine2 = currentGps
    ? `±${Math.round(Number(currentGps.accuracy) || 0)}m • ${new Date(currentGps.timestamp || Date.now()).toLocaleTimeString()}`
    : "Location permission/fix pending";

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
          <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 6, textAlign: "center" }}>
            {`Last Session: ${fitnessProgress.lastSessionSteps || 0} footsteps`}
          </div>
          {fitnessProgress.lastSessionRoute && (
            <div style={{ fontSize: 12.5, opacity: 0.78, marginBottom: 6, textAlign: "center", maxWidth: "90%" }}>
              {`${fitnessProgress.lastSessionRoute.from} → ${fitnessProgress.lastSessionRoute.to} • ${formatRouteTimestamp(fitnessProgress.lastSessionRoute.at)}`}
            </div>
          )}
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12, textAlign: "center", maxWidth: "84%" }}>
            {fitnessProgress.lastSessionRetrievedObjects?.length
              ? `Retrieved: ${fitnessProgress.lastSessionRetrievedObjects.join(", ")}`
              : "Retrieved: none yet"}
          </div>
          <div
            style={{
              width: "min(92vw, 420px)",
              background: "rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.22)",
              borderRadius: "10px",
              padding: "8px 10px",
              fontSize: "0.72rem",
              lineHeight: 1.35,
              textAlign: "left",
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>GPS DEBUG</div>
            <div>{gpsDebugLine1}</div>
            <div style={{ opacity: 0.86 }}>{gpsDebugLine2}</div>
            {gpsDebugError ? (
              <div style={{ color: "#fecaca", marginTop: 2 }}>{gpsDebugError}</div>
            ) : null}
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
          <div
            style={{
              position: "fixed",
              left: "12px",
              top: "calc(var(--safe-top) + 8px)",
              zIndex: 20,
              background: "rgba(0, 0, 0, 0.62)",
              border: "1px solid rgba(255,255,255,0.22)",
              borderRadius: "10px",
              padding: "7px 10px",
              color: "white",
              fontSize: "0.72rem",
              lineHeight: 1.3,
              textShadow: "none",
              maxWidth: "86vw",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>GPS DEBUG</div>
            <div>{gpsDebugLine1}</div>
            <div style={{ opacity: 0.86 }}>{gpsDebugLine2}</div>
            {gpsDebugError ? (
              <div style={{ color: "#fecaca", marginTop: 2 }}>{gpsDebugError}</div>
            ) : null}
          </div>

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
                {phase === "listening_location" && (
                  <span className="facetime-status-pill pulse">
                    🎙️ Tell me where you are now
                  </span>
                )}
                {phase === "processing_location" && (
                  <span className="facetime-status-pill">Checking your GPS...</span>
                )}
                {phase === "listening_time_budget" && (
                  <span className="facetime-status-pill pulse">
                    🎙️ Short time or around 10 minutes?
                  </span>
                )}
                {phase === "processing_time_budget" && (
                  <span className="facetime-status-pill">Planning meetup spot...</span>
                )}
                {phase === "listening_preference" && (
                  <span className="facetime-status-pill pulse">
                    🎙️ Treasure hunt briefing...
                  </span>
                )}
                {phase === "listening_object_guess" && (
                  <span className="facetime-status-pill pulse">
                    🎙️ Name the object
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
                    "listening_location",
                    "processing_location",
                    "listening_time_budget",
                    "processing_time_budget",
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
                      Start Hunt
                    </button>
                  </div>
                )}
                {phase === "listening_time_budget" && (
                  <div className="facetime-skip-row">
                    <button
                      className="facetime-skip-btn"
                      onClick={() => processTimeBudgetReply("I only have a short time")}
                    >
                      Short Time
                    </button>
                    <button
                      className="facetime-skip-btn"
                      onClick={() => processTimeBudgetReply("I have around 10 minutes")}
                    >
                      10 Minutes
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
                  {`Meetup Target: ${callData?.destinationName || callData?.targetObject || "..."}`}
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
                  {`Steps ${sessionSteps} • ${routeDistanceMeters !== null ? `${routeDistanceMeters}m left` : "locating route..."}`}
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
