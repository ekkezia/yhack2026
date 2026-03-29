const BASE = "/api";
const CV_BASE = import.meta.env.VITE_CV_API_BASE || "/cvapi";
let hasWarnedYoloFallback = false;

function normText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function parseResponse(res, endpoint) {
  const text = await res.text();
  if (!res.ok) {
    let err = text;
    try {
      err = JSON.parse(text).error || text;
    } catch (e) {}
    throw new Error(`${endpoint} error ${res.status}: ${err}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${endpoint} JSON parse error: ${text}`);
  }
}

// Send a camera frame (base64 JPEG) → get object, position, script, and target word
export async function detectAndScript(
  imageBase64,
  targetLanguage = "Portuguese",
  nativeLanguage = "English",
) {
  const res = await fetch(`${BASE}/detect-and-script`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, targetLanguage, nativeLanguage }),
  });
  return parseResponse(res, "detect-and-script");
  // Returns: { object, position, script, targetWord, targetPronunciation }
}

// Send script text → get base64 MP3 audio from ElevenLabs via Lava
export async function speak(text, voiceId = null, language = null) {
  const res = await fetch(`${BASE}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId, language }),
  });
  return parseResponse(res, "speak");
  // Returns: { audioBase64, mimeType }
}

// Validate user's guess with Gemini (fuzzy matching)
export async function checkAnswer(
  guess,
  correctObject,
  targetLanguage = "Portuguese",
  nativeLanguage = "English",
) {
  const res = await fetch(`${BASE}/check-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guess,
      correctObject,
      targetLanguage,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "check-answer");
  // Returns: { correct: bool, feedback: string }
}

// Play base64 audio in the browser
export function playBase64Audio(base64, mimeType = "audio/mpeg") {
  const audio = new Audio(`data:${mimeType};base64,${base64}`);
  return audio.play();
}

// Start phone call: get friend name, target object, and opening script
export async function phoneStart(
  targetLanguage = "Portuguese",
  nativeLanguage = "English",
) {
  const res = await fetch(`${BASE}/phone-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetLanguage, nativeLanguage }),
  });
  return parseResponse(res, "phone-start");
}

// Reply to phone call: process user's language choice and get follow-up script
export async function phoneReply(
  transcript,
  friendName,
  targetObject,
  targetObjectTranslated,
  targetLanguage = "Portuguese",
  nativeLanguage = "English",
) {
  const res = await fetch(`${BASE}/phone-reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript,
      friendName,
      targetObject,
      targetObjectTranslated,
      targetLanguage,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "phone-reply");
}

// Ongoing friend commentary while user searches
export async function phoneYap({
  friendName,
  targetObject,
  targetObjectTranslated,
  gameMode,
  chosenLanguage,
  visibleObjects = [],
  focusObject = "",
  noObjectRounds = 0,
  targetLanguage = "Portuguese",
  nativeLanguage = "English",
}) {
  const res = await fetch(`${BASE}/phone-yap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendName,
      targetObject,
      targetObjectTranslated,
      gameMode,
      chosenLanguage,
      visibleObjects,
      focusObject,
      noObjectRounds,
      targetLanguage,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "phone-yap");
}

// User interruption handling while searching
export async function phoneInterrupt({
  transcript,
  friendName,
  targetObject,
  targetObjectTranslated,
  gameMode,
  chosenLanguage,
  visibleObjects = [],
  targetLanguage = "Portuguese",
  nativeLanguage = "English",
}) {
  const res = await fetch(`${BASE}/phone-interrupt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript,
      friendName,
      targetObject,
      targetObjectTranslated,
      gameMode,
      chosenLanguage,
      visibleObjects,
      targetLanguage,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "phone-interrupt");
}

// English mode: ask user for Portuguese word of a detected object
export async function phoneEnglishPrompt({
  friendName,
  objectName,
  targetLanguage = "Portuguese",
  nativeLanguage = "English",
}) {
  const res = await fetch(`${BASE}/phone-english-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendName,
      objectName,
      targetLanguage,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "phone-english-prompt");
}

// English mode: check user's Portuguese guess and end call with correction + bye
export async function phoneEnglishEvaluate({
  friendName,
  objectName,
  objectTranslated,
  guess,
  targetLanguage = "Portuguese",
  nativeLanguage = "English",
}) {
  const res = await fetch(`${BASE}/phone-english-evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendName,
      objectName,
      objectTranslated,
      guess,
      targetLanguage,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "phone-english-evaluate");
}

// Phone call struggle: get script when user struggles to find the object
export async function phoneStruggle(
  friendName,
  targetObject,
  targetLanguage = "Portuguese",
  nativeLanguage = "English",
) {
  const res = await fetch(`${BASE}/phone-struggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendName,
      targetObject,
      targetLanguage,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "phone-struggle");
}

// Phone call found: get final success script
export async function phoneFound(
  friendName,
  targetObject,
  targetObjectTranslated,
  chosenLanguage,
  struggled,
  targetLanguage = "Portuguese",
  nativeLanguage = "English",
) {
  const res = await fetch(`${BASE}/phone-found`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendName,
      targetObject,
      targetObjectTranslated,
      chosenLanguage,
      struggled,
      targetLanguage,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "phone-found");
}

// Gemini STT: transcribe short mic audio chunk
export async function phoneTranscribe({
  audioBase64,
  mimeType = "audio/webm",
  languageHint = "en-US",
  context = "general",
} = {}) {
  const res = await fetch(`${BASE}/phone-transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64,
      mimeType,
      languageHint,
      context,
    }),
  });
  return parseResponse(res, "phone-transcribe");
}

async function yoloCheckCv(imageBase64, targetObject) {
  const res = await fetch(`${CV_BASE}/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, targetObject }),
  });
  return parseResponse(res, "yolo-detect");
}

async function geminiCheckCv(imageBase64, targetObject) {
  const res = await fetch(`${BASE}/phone-check-cv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, targetObject }),
  });
  return parseResponse(res, "phone-check-cv");
}

async function phoneSemanticMatch(targetObject, candidates = []) {
  const res = await fetch(`${BASE}/phone-semantic-match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetObject, candidates }),
  });
  return parseResponse(res, "phone-semantic-match");
}

// Check CV: use YOLO server first, then fall back to Gemini CV route
export async function phoneCheckCv(imageBase64, targetObject) {
  try {
    const yolo = await yoloCheckCv(imageBase64, targetObject);

    const visibleDetections = Array.isArray(yolo?.visibleObjectDetections)
      ? yolo.visibleObjectDetections
      : [];
    const candidateNames = [
      ...(typeof yolo?.detectedObject === "string" ? [yolo.detectedObject] : []),
      ...visibleDetections.map((d) => d?.name).filter(Boolean),
    ].filter(Boolean);
    const seen = new Set();
    const uniqueCandidates = candidateNames.filter((name) => {
      const key = normText(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniqueCandidates.length === 0) {
      return {
        ...yolo,
        found: false,
        modelFound: false,
        matchType: "none",
        detectedObject: "",
      };
    }

    try {
      const semantic = await phoneSemanticMatch(targetObject, uniqueCandidates);
      const matchedCandidate =
        typeof semantic?.matchedCandidate === "string"
          ? semantic.matchedCandidate.trim()
          : "";
      const targetDet =
        visibleDetections.find((d) => normText(d?.name) === normText(matchedCandidate)) ||
        visibleDetections.find((d) => {
          const dn = normText(d?.name);
          const mc = normText(matchedCandidate);
          return dn && mc && (dn.includes(mc) || mc.includes(dn));
        }) ||
        null;

      const semanticConfidence = Number(semantic?.confidence);
      const confidence = Number.isFinite(semanticConfidence)
        ? Math.max(0, Math.min(1, semanticConfidence))
        : Number(yolo?.confidence) || 0;

      if (semantic?.matched && matchedCandidate) {
        const upgraded = {
          ...yolo,
          found: true,
          modelFound: true,
          confidence: Math.max(0.75, confidence),
          matchType: "semantic_match",
          detectedObject: targetDet?.name || matchedCandidate,
          targetBoundingBox: targetDet?.boundingBox || yolo?.targetBoundingBox || null,
          evidence: `${yolo?.evidence || "YOLO candidate detected"}; semantic match accepted (${semantic?.reason || "Gemini semantic decision"}).`,
          modelUsed: `${yolo?.modelUsed || "yolo"} + ${semantic?.modelUsed || "gemini-semantic"}`,
        };
        console.log("[CV Semantic Match]", {
          targetObject,
          matchedCandidate: upgraded.detectedObject,
          confidence: upgraded.confidence,
          evidence: upgraded.evidence,
        });
        return upgraded;
      }

      return {
        ...yolo,
        found: false,
        modelFound: false,
        confidence: 0,
        matchType: "none",
        detectedObject: "",
        targetBoundingBox: null,
        evidence: `${yolo?.evidence || "YOLO candidate detected"}; semantic check says no match (${semantic?.reason || "Gemini semantic decision"}).`,
        modelUsed: `${yolo?.modelUsed || "yolo"} + ${semantic?.modelUsed || "gemini-semantic"}`,
      };
    } catch (semanticErr) {
      console.warn("Semantic match check failed; falling back to Gemini CV:", semanticErr);
      return geminiCheckCv(imageBase64, targetObject);
    }
  } catch (yoloErr) {
    if (!hasWarnedYoloFallback) {
      console.warn("YOLO CV unavailable, falling back to Gemini CV:", yoloErr);
      hasWarnedYoloFallback = true;
    }
    return geminiCheckCv(imageBase64, targetObject);
  }
}
