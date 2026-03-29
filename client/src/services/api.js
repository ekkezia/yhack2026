const BASE = "/api";
const CV_BASE = import.meta.env.VITE_CV_API_BASE || "/cvapi";
let hasWarnedYoloFallback = false;

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

// Confirm user's spoken location against live GPS.
export async function phoneConfirmLocation({
  friendName,
  transcript,
  latitude,
  longitude,
  nativeLanguage = "English",
}) {
  const res = await fetch(`${BASE}/phone-confirm-location`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendName,
      transcript,
      latitude,
      longitude,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "phone-confirm-location");
}

// Plan a nearby meetup destination based on current place and time budget.
export async function phonePlanDestination({
  friendName,
  originPlaceName,
  latitude,
  longitude,
  timeBudgetReply,
  nativeLanguage = "English",
}) {
  const res = await fetch(`${BASE}/phone-plan-destination`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendName,
      originPlaceName,
      latitude,
      longitude,
      timeBudgetReply,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "phone-plan-destination");
}

// Ongoing friend commentary while user searches
export async function phoneYap({
  friendName,
  targetObject,
  visibleObjects = [],
  focusObject = "",
  noObjectRounds = 0,
  stepCount = 0,
  retrievedObjects = [],
  sessionSeconds = 0,
}) {
  const res = await fetch(`${BASE}/phone-yap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendName,
      targetObject,
      visibleObjects,
      focusObject,
      noObjectRounds,
      stepCount,
      retrievedObjects,
      sessionSeconds,
    }),
  });
  return parseResponse(res, "phone-yap");
}

// Ongoing route narration while user walks to destination.
export async function phoneRouteYap({
  friendName,
  originPlaceName,
  destinationName,
  distanceRemainingMeters,
  stepCount,
  sessionSeconds,
  storySeed = "",
  noProgressRounds = 0,
  nativeLanguage = "English",
}) {
  const res = await fetch(`${BASE}/phone-route-yap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendName,
      originPlaceName,
      destinationName,
      distanceRemainingMeters,
      stepCount,
      sessionSeconds,
      storySeed,
      noProgressRounds,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "phone-route-yap");
}

// User interruption handling while searching
export async function phoneInterrupt({
  transcript,
  friendName,
  targetObject,
  visibleObjects = [],
}) {
  const res = await fetch(`${BASE}/phone-interrupt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript,
      friendName,
      targetObject,
      visibleObjects,
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

// Fitness treasure-hunt found: get continuation script for next target
export async function phoneFound(
  friendName,
  foundObject,
  nextTarget,
  retrievedObjects = [],
  stepCount = 0,
  sessionSeconds = 0,
) {
  const res = await fetch(`${BASE}/phone-found`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendName,
      foundObject,
      nextTarget,
      retrievedObjects,
      stepCount,
      sessionSeconds,
    }),
  });
  return parseResponse(res, "phone-found");
}

// Final line when user reaches the meeting destination.
export async function phoneArrived({
  friendName,
  originPlaceName,
  destinationName,
  stepCount,
  sessionSeconds,
  nativeLanguage = "English",
}) {
  const res = await fetch(`${BASE}/phone-arrived`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendName,
      originPlaceName,
      destinationName,
      stepCount,
      sessionSeconds,
      nativeLanguage,
    }),
  });
  return parseResponse(res, "phone-arrived");
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

// Check CV: use YOLO server first, then fall back to Gemini CV route
export async function phoneCheckCv(imageBase64, targetObject) {
  try {
    const yolo = await yoloCheckCv(imageBase64, targetObject);
    return yolo;
  } catch (yoloErr) {
    if (!hasWarnedYoloFallback) {
      console.warn("YOLO CV unavailable, falling back to Gemini CV:", yoloErr);
      hasWarnedYoloFallback = true;
    }
    return geminiCheckCv(imageBase64, targetObject);
  }
}
