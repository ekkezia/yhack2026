const BASE = '/api';

// Send a camera frame (base64 JPEG) → get object, position, script, and target word
export async function detectAndScript(imageBase64, targetLanguage = 'Portuguese', nativeLanguage = 'English') {
  const res = await fetch(`${BASE}/detect-and-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, targetLanguage, nativeLanguage }),
  });
  if (!res.ok) throw new Error(`detect-and-script ${res.status}`);
  return res.json();
  // Returns: { object, position, script, targetWord, targetPronunciation }
}

// Send script text → get base64 MP3 audio from ElevenLabs via Lava
export async function speak(text) {
  const res = await fetch(`${BASE}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`speak ${res.status}`);
  return res.json();
  // Returns: { audioBase64, mimeType }
}

// Validate user's guess with Gemini (fuzzy matching)
export async function checkAnswer(guess, correctObject, targetLanguage = 'Portuguese', nativeLanguage = 'English') {
  const res = await fetch(`${BASE}/check-answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guess, correctObject, targetLanguage, nativeLanguage }),
  });
  if (!res.ok) throw new Error(`check-answer ${res.status}`);
  return res.json();
  // Returns: { correct: bool, feedback: string }
}

// Play base64 audio in the browser
export function playBase64Audio(base64, mimeType = 'audio/mpeg') {
  const audio = new Audio(`data:${mimeType};base64,${base64}`);
  return audio.play();
}
