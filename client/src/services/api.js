const BASE = "/api";

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

// Check CV: verify if the target object is in the camera frame
export async function phoneCheckCv(imageBase64, targetObject) {
  const res = await fetch(`${BASE}/phone-check-cv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, targetObject }),
  });
  return parseResponse(res, "phone-check-cv");
}
