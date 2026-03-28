const BASE = "/api";

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
  if (!res.ok) throw new Error(`detect-and-script ${res.status}`);
  return res.json();
  // Returns: { object, position, script, targetWord, targetPronunciation }
}

// Send script text → get base64 MP3 audio from ElevenLabs via Lava
export async function speak(text) {
  const res = await fetch(`${BASE}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`speak ${res.status}`);
  return res.json();
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
  if (!res.ok) throw new Error(`check-answer ${res.status}`);
  return res.json();
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
  if (!res.ok) throw new Error(`phone-start ${res.status}`);
  return res.json();
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
  if (!res.ok) throw new Error(`phone-reply ${res.status}`);
  return res.json();
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
  if (!res.ok) throw new Error(`phone-struggle ${res.status}`);
  return res.json();
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
  if (!res.ok) throw new Error(`phone-found ${res.status}`);
  return res.json();
}

// Check CV: verify if the target object is in the camera frame
export async function phoneCheckCv(imageBase64, targetObject) {
  const res = await fetch(`${BASE}/phone-check-cv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, targetObject }),
  });
  if (!res.ok) throw new Error(`phone-check-cv ${res.status}`);
  return res.json();
}
