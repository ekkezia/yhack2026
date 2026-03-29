require("dotenv").config({ path: "../.env.local" });
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

const FRIEND_NAMES = [
  "Adi",
  "Budi",
  "Rizky",
  "Fajar",
  "Dimas",
  "Andi",
  "Arif",
  "Agus",
  "Bayu",
  "Hendra",
];

const TARGET_OBJECTS = [
  "trash bin",
  "plant",
  "handphone",
  "paper",
  "pencil",
  "flower",
  "backpack",
  "chair",
  "table",
];

let lastPhoneTargetObject = null;
const semanticMatchCache = new Map();
const wordImageCache = new Map();
const SEMANTIC_MATCH_CACHE_MAX = Number(process.env.SEMANTIC_MATCH_CACHE_MAX || 300);

function pickRandomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickRandomObjectNoImmediateRepeat() {
  if (TARGET_OBJECTS.length <= 1) return TARGET_OBJECTS[0];

  let next = pickRandomFrom(TARGET_OBJECTS);
  while (next === lastPhoneTargetObject) {
    next = pickRandomFrom(TARGET_OBJECTS);
  }
  lastPhoneTargetObject = next;
  return next;
}

function normText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function semanticCacheGet(key) {
  if (!semanticMatchCache.has(key)) return null;
  const value = semanticMatchCache.get(key);
  // Touch for simple LRU behavior.
  semanticMatchCache.delete(key);
  semanticMatchCache.set(key, value);
  return value;
}

function semanticCacheSet(key, value) {
  semanticMatchCache.set(key, value);
  while (semanticMatchCache.size > SEMANTIC_MATCH_CACHE_MAX) {
    const firstKey = semanticMatchCache.keys().next().value;
    semanticMatchCache.delete(firstKey);
  }
}

function normalizeChosenLanguage(value, nativeLanguage, targetLanguage) {
  const raw = normText(value);
  if (!raw) return nativeLanguage;

  const native = normText(nativeLanguage);
  const target = normText(targetLanguage);
  if (raw.includes(target) || target.includes(raw)) return targetLanguage;
  if (raw.includes(native) || native.includes(raw)) return nativeLanguage;
  return nativeLanguage;
}

function canonicalLanguageKey(value) {
  const raw = normText(value);
  if (!raw) return "";
  if (
    raw.includes("indones") ||
    raw.includes("bahasa indonesia") ||
    raw.includes("bahasa")
  ) {
    return "indonesian";
  }
  if (raw.includes("portugu")) return "portuguese";
  if (raw.includes("spanish") || raw.includes("espanol") || raw.includes("espanhol")) {
    return "spanish";
  }
  if (raw.includes("english") || raw.includes("inggris")) return "english";
  return "";
}

function resolveVoiceIdForLanguage(language) {
  const defaultVoiceId =
    process.env.VOICE_ID ||
    process.env.ELEVENLABS_VOICE_ID ||
    "21m00Tcm4TlvDq8ikWAM";

  const byLanguage = {
    english:
      process.env.VOICE_ID_ENGLISH ||
      process.env.ELEVENLABS_VOICE_ID_ENGLISH ||
      "",
    spanish:
      process.env.VOICE_ID_SPANISH ||
      process.env.ELEVENLABS_VOICE_ID_SPANISH ||
      "",
    indonesian:
      process.env.VOICE_ID_INDONESIAN ||
      process.env.ELEVENLABS_VOICE_ID_INDONESIAN ||
      "",
    portuguese:
      process.env.VOICE_ID_PORTUGUESE ||
      process.env.ELEVENLABS_VOICE_ID_PORTUGUESE ||
      "",
  };

  const key = canonicalLanguageKey(language);
  if (key && byLanguage[key]) {
    return byLanguage[key];
  }

  // Backward-compatible native/target fallback.
  const nativeLanguage = process.env.NATIVE_LANGUAGE || "English";
  const targetLanguage = process.env.TARGET_LANGUAGE || "Portuguese";
  const normalized = normText(language);
  if (normalized) {
    if (normText(targetLanguage) === normalized && process.env.VOICE_TARGET_ID) {
      return process.env.VOICE_TARGET_ID;
    }
    if (normText(nativeLanguage) === normalized && process.env.VOICE_NATIVE_ID) {
      return process.env.VOICE_NATIVE_ID;
    }
  }

  return (
    defaultVoiceId ||
    process.env.VOICE_NATIVE_ID ||
    process.env.VOICE_TARGET_ID ||
    process.env.ELEVENLABS_TARGET_VOICE_ID ||
    process.env.ELEVENLABS_VOICE_ID_TARGET ||
    "21m00Tcm4TlvDq8ikWAM"
  );
}

function sanitizeNormalizedBoundingBox(box) {
  if (!box || typeof box !== "object") return null;
  const firstFinite = (...values) => {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  let x = firstFinite(box.x, box.left, box.xMin, box.xmin, box.minX, box.x1);
  let y = firstFinite(box.y, box.top, box.yMin, box.ymin, box.minY, box.y1);
  let width = firstFinite(box.width, box.w);
  let height = firstFinite(box.height, box.h);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    const right = firstFinite(
      box.right,
      box.xMax,
      box.xmax,
      box.maxX,
      box.x2,
    );
    const bottom = firstFinite(
      box.bottom,
      box.yMax,
      box.ymax,
      box.maxY,
      box.y2,
    );
    if (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(right) &&
      Number.isFinite(bottom)
    ) {
      width = right - x;
      height = bottom - y;
    }
  }

  if (![x, y, width, height].every(Number.isFinite)) return null;

  // Accept percentage-style [0..100] values as well.
  const looksLikePercent =
    [x, y, width, height].every((v) => v >= 0 && v <= 100) &&
    [x, y, width, height].some((v) => v > 1);
  if (looksLikePercent) {
    x /= 100;
    y /= 100;
    width /= 100;
    height /= 100;
  }

  if (width <= 0 || height <= 0) return null;

  const clampedX = Math.max(0, Math.min(1, x));
  const clampedY = Math.max(0, Math.min(1, y));
  const clampedWidth = Math.max(0, Math.min(1 - clampedX, width));
  const clampedHeight = Math.max(0, Math.min(1 - clampedY, height));
  if (clampedWidth <= 0 || clampedHeight <= 0) return null;

  return {
    x: clampedX,
    y: clampedY,
    width: clampedWidth,
    height: clampedHeight,
  };
}

function sanitizeVisibleObjectDetections(detections) {
  if (!Array.isArray(detections)) return [];

  return detections
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name =
        typeof item.name === "string"
          ? item.name.trim()
          : typeof item.object === "string"
            ? item.object.trim()
            : "";
      const boundingBox = sanitizeNormalizedBoundingBox(
        item.boundingBox || item.box || item.targetBoundingBox,
      );
      const confidence = Number.isFinite(Number(item.confidence))
        ? Math.max(0, Math.min(1, Number(item.confidence)))
        : null;

      if (!name || !boundingBox) return null;
      return { name, boundingBox, confidence };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeModelJsonText(rawText) {
  if (typeof rawText !== "string") return "";
  let text = rawText.trim();

  if (text.startsWith("```")) {
    text = text
      .replace(/^```[a-zA-Z]*\s*/, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

function parseModelJsonSafe(rawText, contextLabel = "model-json") {
  const base = normalizeModelJsonText(rawText);
  if (!base) throw new Error(`${contextLabel}: empty response text`);

  const attempts = [
    base,
    base.replace(/,\s*([}\]])/g, "$1"),
    base
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3'),
  ];

  let lastErr;
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      if (i > 0) {
        console.warn(`[${contextLabel}] using JSON recovery pass #${i}`);
      }
      return JSON.parse(attempts[i]);
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(
    `${contextLabel}: JSON parse failed after recovery attempts: ${lastErr?.message || "unknown error"}`,
  );
}

// ─── Lava forward-proxy helper ───────────────────────────────────────────────
// Lava routes your request to the provider and meters usage.
// Format: POST https://api.lava.so/v1/forward?u=<URL-encoded provider endpoint>
async function lavaForward(providerUrl, body, extraHeaders = {}) {
  const url = `https://api.lava.so/v1/forward?u=${encodeURIComponent(providerUrl)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LAVA_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Lava/provider error ${res.status}: ${err}`);
  }
  return res;
}

// ─── POST /api/detect-and-script ─────────────────────────────────────────────
// Accepts a base64 JPEG frame, returns detected object + position + TTS script.
// One Gemini call handles CV + script generation for minimum latency.
app.post("/api/detect-and-script", async (req, res) => {
  const {
    imageBase64,
    targetLanguage = process.env.TARGET_LANGUAGE || "Indonesian",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
  } = req.body;
  if (!imageBase64)
    return res.status(400).json({ error: "imageBase64 required" });

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt = `You are a fun, encouraging language-learning assistant.
Analyze this camera image from a mobile user's perspective.

Tasks:
1. Find ONE common, nameable object clearly visible in the scene (something with a vocabulary word).
2. Determine its approximate position: "left", "center", or "right" side of the image.
3. Write a short enthusiastic voice script (2–3 natural sentences) in ${nativeLanguage} that:
   - Tells the user you spotted something interesting on their [position]
   - Asks if they want to guess what it is in ${targetLanguage}
   - Keep it playful and under 40 words total
4. Provide the ${targetLanguage} translation of the object's name.

Respond ONLY with valid JSON (no markdown fences):
{
  "object": "${nativeLanguage} object name",
  "position": "left|center|right",
  "script": "the voice script text in ${nativeLanguage}",
  "targetWord": "${targetLanguage} word",
  "targetPronunciation": "pronunciation hint"
}

If no clear object is found, return: { "object": null }`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/jpeg", data: imageBase64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
    });

    const geminiData = await geminiRes.json();
    let text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error("Empty Gemini response");

    // Strip Markdown code block formatting if present
    const parsed = parseModelJsonSafe(text, "phone-check-cv");
    res.json(parsed);
  } catch (err) {
    console.error("detect-and-script error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/speak ──────────────────────────────────────────────────────────
// Sends script text to ElevenLabs via Lava, returns audio as base64.
app.post("/api/speak", async (req, res) => {
  const { text, voiceId: customVoiceId, language } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  const voiceId = customVoiceId || resolveVoiceIdForLanguage(language);
  const elUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  try {
    const elRes = await lavaForward(
      elUrl,
      {
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      { "xi-api-key": process.env.ELEVENLABS_API_KEY },
    );

    const audioBuffer = await elRes.buffer();
    res.json({
      audioBase64: audioBuffer.toString("base64"),
      mimeType: "audio/mpeg",
    });
  } catch (err) {
    console.error("speak error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/check-answer ───────────────────────────────────────────────────
// Uses Gemini to validate a user's guess (fuzzy match, accept partial/phonetic).
app.post("/api/check-answer", async (req, res) => {
  const {
    guess,
    correctObject,
    targetLanguage = process.env.TARGET_LANGUAGE || "Indonesian",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
  } = req.body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [
        {
          parts: [
            {
              text: `The correct object is "${correctObject}". The user guessed "${guess}" (they may answer in ${nativeLanguage} or ${targetLanguage}).
Is this correct or close enough? Accept reasonable synonyms and phonetic approximations.
Respond ONLY with JSON: { "correct": true|false, "feedback": "short encouraging message in ${nativeLanguage} (max 10 words)" }`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.3, maxOutputTokens: 64 },
    });

    const data = await geminiRes.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    // Strip Markdown code block formatting if present
    if (text && text.startsWith("```")) {
      text = text
        .replace(/^```[a-zA-Z]*\s*/, "")
        .replace(/\s*```$/, "")
        .trim();
    }

    res.json(JSON.parse(text));
  } catch (err) {
    console.error("check-answer error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-start ────────────────────────────────────────────────────
app.post("/api/phone-start", async (req, res) => {
  const {
    targetLanguage = process.env.TARGET_LANGUAGE || "Indonesian",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
  } = req.body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const friendName = pickRandomFrom(FRIEND_NAMES);
  const targetObject = pickRandomObjectNoImmediateRepeat();
  const prompt = `You are designing a script for an AI friend calling the user.
Use this exact friend name: "${friendName}".
Use this exact object in ${nativeLanguage}: "${targetObject}".

Tasks:
1. Translate "${targetObject}" to ${targetLanguage}.
2. Write one short, natural opener from "${friendName}" in a mixed style:
   - starts with "Hi babe!"
   - 85% ${nativeLanguage}, 15% ${targetLanguage} (naturally weave in a few ${targetLanguage} words/phrases)
   - says: "I need your help finding something"
   - directly asks user to find the object using the ${targetLanguage} term.
3. Do NOT ask the user to choose a language.

Respond ONLY with valid JSON (no markdown fences):
{
  "targetObjectTranslated": "object name in ${targetLanguage}",
  "script": "opening script in mixed ${nativeLanguage}+${targetLanguage}"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 256 },
    });

    const data = await geminiRes.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error("Empty Gemini response");

    if (text.startsWith("```")) {
      text = text
        .replace(/^```[a-zA-Z]*\s*/, "")
        .replace(/\s*```$/, "")
        .trim();
    }

    const parsed = JSON.parse(text);
    const payload = {
      friendName,
      targetObject,
      targetObjectTranslated: parsed.targetObjectTranslated || targetObject,
      script:
        parsed.script ||
        `Hi babe! I need your help finding something. I might switch between ${nativeLanguage} and ${targetLanguage} a bit. Can you find my ${parsed.targetObjectTranslated || targetObject}?`,
    };

    console.log(
      `[phone-start] friend=${payload.friendName} object=${payload.targetObject} translated=${payload.targetObjectTranslated}`,
    );
    res.json(payload);
  } catch (err) {
    console.error("phone-start error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-reply ────────────────────────────────────────────────────
app.post("/api/phone-reply", async (req, res) => {
  const {
    transcript,
    friendName,
    targetObject,
    targetObjectTranslated,
    targetLanguage = process.env.TARGET_LANGUAGE || "Indonesian",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
  } = req.body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt = `The user was asked whether they prefer to speak in ${nativeLanguage} or ${targetLanguage}.
Their reply was: "${transcript}"
1. Determine which language they chose (default to ${nativeLanguage} if unsure).
2. Determine gameMode:
   - "english_practice" if chosen language is ${nativeLanguage}
   - "find_requested" if chosen language is ${targetLanguage}
3. Write a follow-up script from "${friendName}" in the CHOSEN language:
   - If gameMode is "find_requested": in ${targetLanguage}, ask the user to help find your missing object now. Use "${targetObjectTranslated}" naturally, and do NOT ask them to do vocabulary quiz.
   - If gameMode is "english_practice": ask them to show any object in front of the camera, because you'll test their ${targetLanguage} vocabulary for that object.

Respond ONLY with valid JSON (no markdown fences):
{
  "chosenLanguage": "the language they picked (${nativeLanguage} or ${targetLanguage})",
  "gameMode": "english_practice|find_requested",
  "script": "the follow-up script"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
    });

    const data = await geminiRes.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error("Empty Gemini response");

    const parsed = parseModelJsonSafe(text, "phone-reply");
    const chosenLanguageNorm = normalizeChosenLanguage(
      parsed?.chosenLanguage,
      nativeLanguage,
      targetLanguage,
    );
    const gameMode =
      chosenLanguageNorm === nativeLanguage ? "english_practice" : "find_requested";
    const fallbackScript =
      gameMode === "english_practice"
        ? `Great, let's speak in ${nativeLanguage}. Show me any object in front of you and I'll ask you its ${targetLanguage} word.`
        : `Let's continue in ${targetLanguage}. I need help finding my ${targetObjectTranslated}. Can you help me now?`;

    res.json({
      chosenLanguage: chosenLanguageNorm,
      gameMode,
      script:
        typeof parsed?.script === "string" && parsed.script.trim()
          ? parsed.script.trim()
          : fallbackScript,
    });
  } catch (err) {
    console.error("phone-reply error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-yap ──────────────────────────────────────────────────────
app.post("/api/phone-yap", async (req, res) => {
  const {
    friendName,
    targetObject,
    targetObjectTranslated,
    gameMode = "find_requested",
    chosenLanguage,
    visibleObjects = [],
    focusObject = "",
    noObjectRounds = 0,
    targetLanguage = process.env.TARGET_LANGUAGE || "Indonesian",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
  } = req.body;

  const preferredLanguage = normalizeChosenLanguage(
    chosenLanguage,
    nativeLanguage,
    targetLanguage,
  );
  const visibleList = Array.isArray(visibleObjects)
    ? visibleObjects.filter((v) => typeof v === "string").slice(0, 6)
    : [];
  const cleanFocusObject =
    typeof focusObject === "string" ? focusObject.trim() : "";
  const targetForPreferredLanguage =
    preferredLanguage === targetLanguage ? targetObjectTranslated : targetObject;
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const prompt =
    gameMode === "english_practice"
      ? `You are "${friendName}" on a live call. The user chose ${nativeLanguage}.
Speak in ${nativeLanguage}.

Context:
- Goal: conversational vocabulary mini-practice, not object hunt.
- Visible objects: ${visibleList.length ? visibleList.join(", ") : "none detected"}
- Focus object (if any): ${cleanFocusObject || "none"}
- Target language: ${targetLanguage}

Instructions:
1. If a focus object exists, ask the user how to say that object in ${targetLanguage}.
2. Include the correct translation of that focus object in field "teachingTranslation".
3. Keep script short (max 24 words), friendly, and natural.
4. If no object is visible, encourage them to point camera at any nearby object.

Respond ONLY with valid JSON:
{
  "script": "one short line in ${nativeLanguage}",
  "teachingObject": "focus object in ${nativeLanguage} or empty string",
  "teachingTranslation": "that object in ${targetLanguage} or empty string"
}`
      : `You are "${friendName}", on a fun live call while user searches for your "${targetObject}".
Speak in a mixed style: 70% ${nativeLanguage}, 30% ${targetLanguage} — naturally weave in ${targetLanguage} words and short phrases.

Context:
- Target object in ${nativeLanguage}: ${targetObject}
- Target object in ${targetLanguage}: ${targetObjectTranslated}
- Other objects currently visible: ${visibleList.length ? visibleList.join(", ") : "none detected"}
- Focus object (if any): ${cleanFocusObject || "none"}
- Consecutive rounds with no clear objects: ${Number(noObjectRounds) || 0}

Instructions:
1. Keep it conversational, short (max 24 words), and encouraging.
2. If focus object exists and it is NOT "${targetObject}", clearly say this is not the right object and redirect them to "${targetForPreferredLanguage}".
3. Briefly describe "${targetForPreferredLanguage}" in everyday terms (shape, typical look, use) and why you need it.
4. If no object is visible, keep yapping with a human reason why you need "${targetForPreferredLanguage}" and encourage them.
5. Always include at least one short ${targetLanguage} phrase naturally.

Respond ONLY with valid JSON:
{
  "script": "one short line in mixed ${nativeLanguage}+${targetLanguage}",
  "teachingObject": "non-target object you taught or empty string",
  "teachingTranslation": "that object's ${targetLanguage} word or empty string"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 120 },
    });

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const parsed = parseModelJsonSafe(text, "phone-yap");
    const fallbackScript =
      gameMode === "english_practice"
        ? `Show me any object in front of your camera and I will quiz you on the ${targetLanguage} word.`
      : `Not that one yet. I still need ${targetObjectTranslated}. Keep looking, please.`;

    res.json({
      script:
        typeof parsed.script === "string" && parsed.script.trim()
          ? parsed.script.trim()
          : fallbackScript,
      teachingObject:
        typeof parsed.teachingObject === "string"
          ? parsed.teachingObject.trim()
          : "",
      teachingTranslation:
        typeof parsed.teachingTranslation === "string"
          ? parsed.teachingTranslation.trim()
          : "",
    });
  } catch (err) {
    console.error("phone-yap error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-interrupt ────────────────────────────────────────────────
app.post("/api/phone-interrupt", async (req, res) => {
  const {
    transcript,
    friendName,
    targetObject,
    targetObjectTranslated,
    gameMode = "find_requested",
    chosenLanguage,
    visibleObjects = [],
    targetLanguage = process.env.TARGET_LANGUAGE || "Indonesian",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
  } = req.body;

  if (!transcript) return res.status(400).json({ error: "transcript required" });

  const preferredLanguage = normalizeChosenLanguage(
    chosenLanguage,
    nativeLanguage,
    targetLanguage,
  );
  const visibleList = Array.isArray(visibleObjects)
    ? visibleObjects.filter((v) => typeof v === "string").slice(0, 8)
    : [];
  const targetForPreferredLanguage =
    preferredLanguage === targetLanguage ? targetObjectTranslated : targetObject;
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt =
    gameMode === "english_practice"
      ? `You are "${friendName}" speaking in a live call.
User just interrupted and said: "${transcript}".
Speak in: ${nativeLanguage}.

Context:
- User chose ${nativeLanguage} mode.
- You are doing a vocabulary mini-practice for nearby objects in ${targetLanguage}.
- Visible objects in scene: ${visibleList.length ? visibleList.join(", ") : "none detected"}.

Instructions:
1. Reply naturally to the user's interruption/question.
2. Be warm, concise, and conversational.
3. Bring them back to naming visible objects in ${targetLanguage}.
4. Max 26 words.

Respond ONLY with valid JSON:
{
  "script": "short response in ${nativeLanguage}"
}`
      : `You are "${friendName}" speaking in a live call.
User just interrupted and said: "${transcript}".
Speak in a mixed style: 70% ${nativeLanguage}, 30% ${targetLanguage} — naturally weave in ${targetLanguage} words and short phrases.

Context:
- You are trying to find "${targetObject}" (${targetObjectTranslated} in ${targetLanguage}).
- Other visible objects in scene: ${visibleList.length ? visibleList.join(", ") : "none detected"}.

Instructions:
1. Reply naturally to the user's interruption/question.
2. Be warm, concise, and conversational.
3. If they show or mention the wrong item, say it's not the right one and guide them back to "${targetForPreferredLanguage}".
4. Mention one simple clue for how "${targetForPreferredLanguage}" usually looks or is used.
5. Include at least one short ${targetLanguage} phrase naturally.
5. Max 26 words.

Respond ONLY with valid JSON:
{
  "script": "short mixed-language response"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 140 },
    });

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const parsed = parseModelJsonSafe(text, "phone-interrupt");
    res.json({
      script:
        parsed.script ||
        (gameMode === "english_practice"
          ? `Great question. Keep showing objects and let's practice ${targetLanguage} words together.`
          : `Good question. We still need ${targetObjectTranslated}. Let's keep looking.`),
    });
  } catch (err) {
    console.error("phone-interrupt error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-english-prompt ──────────────────────────────────────────
app.post("/api/phone-english-prompt", async (req, res) => {
  const {
    friendName,
    objectName,
    targetLanguage = process.env.TARGET_LANGUAGE || "Indonesian",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
  } = req.body;

  if (!objectName) {
    return res.status(400).json({ error: "objectName required" });
  }

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const prompt = `You are "${friendName}" on a friendly voice call.
The detected object is "${objectName}" in ${nativeLanguage}.

Tasks:
1. Translate "${objectName}" into ${targetLanguage}.
2. Write one short natural line in ${nativeLanguage} asking:
   "How do you say ${objectName} in ${targetLanguage}?"

Respond ONLY with valid JSON:
{
  "objectTranslated": "the ${targetLanguage} translation",
  "script": "one short question in ${nativeLanguage}"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 140 },
    });

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const parsed = parseModelJsonSafe(text, "phone-english-prompt");

    const objectTranslated =
      typeof parsed.objectTranslated === "string" && parsed.objectTranslated.trim()
        ? parsed.objectTranslated.trim()
        : objectName;

    res.json({
      objectTranslated,
      script:
        typeof parsed.script === "string" && parsed.script.trim()
          ? parsed.script.trim()
          : `I can see a ${objectName}. How do you say "${objectName}" in ${targetLanguage}?`,
    });
  } catch (err) {
    console.error("phone-english-prompt error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-english-evaluate ────────────────────────────────────────
app.post("/api/phone-english-evaluate", async (req, res) => {
  const {
    friendName,
    objectName,
    objectTranslated,
    guess,
    targetLanguage = process.env.TARGET_LANGUAGE || "Indonesian",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
  } = req.body;

  if (!objectName || !objectTranslated) {
    return res
      .status(400)
      .json({ error: "objectName and objectTranslated required" });
  }

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const prompt = `You are "${friendName}" in a language-learning voice call.
The object is "${objectName}" in ${nativeLanguage}.
Correct ${targetLanguage} word: "${objectTranslated}".
User guessed: "${guess || ""}".

Tasks:
1. Decide whether guess is correct (allow minor spelling/accent variation).
2. Write one short final line in ${nativeLanguage} that:
   - says if they were right or gives the correction,
   - includes the correct ${targetLanguage} word "${objectTranslated}",
   - says thank you and bye.
3. The call ends after this line, so keep it concise.

Respond ONLY with valid JSON:
{
  "correct": true|false,
  "finalScript": "one short final line in ${nativeLanguage}"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 160 },
    });

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const parsed = parseModelJsonSafe(text, "phone-english-evaluate");
    const correct = Boolean(parsed.correct);

    const fallbackFinal = correct
      ? `Nice one. ${objectName} in ${targetLanguage} is "${objectTranslated}". Thanks for helping me, bye!`
      : `Good try. ${objectName} in ${targetLanguage} is "${objectTranslated}". Thanks for helping me, bye!`;

    res.json({
      correct,
      finalScript:
        typeof parsed.finalScript === "string" && parsed.finalScript.trim()
          ? parsed.finalScript.trim()
          : fallbackFinal,
    });
  } catch (err) {
    console.error("phone-english-evaluate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-struggle ─────────────────────────────────────────────────
app.post("/api/phone-struggle", async (req, res) => {
  const {
    friendName,
    targetObject,
    targetLanguage = process.env.TARGET_LANGUAGE || "Indonesian",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
  } = req.body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt = `The user is struggling to find the object in ${targetLanguage}.
Write a script from ${friendName} in ${nativeLanguage} saying something like: "Oh sorry, you probably don't really understand me, I'll speak it in ${nativeLanguage}. I need help to find this ${targetObject}. Can you help?"

Respond ONLY with valid JSON (no markdown fences):
{
  "script": "the script in ${nativeLanguage}"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
    });

    const data = await geminiRes.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error("Empty Gemini response");

    if (text.startsWith("```")) {
      text = text
        .replace(/^```[a-zA-Z]*\s*/, "")
        .replace(/\s*```$/, "")
        .trim();
    }

    res.json(JSON.parse(text));
  } catch (err) {
    console.error("phone-struggle error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-found ────────────────────────────────────────────────────
app.post("/api/phone-found", async (req, res) => {
  const {
    friendName,
    targetObject,
    targetObjectTranslated,
    chosenLanguage,
    targetLanguage = process.env.TARGET_LANGUAGE || "Indonesian",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
    struggled = false,
  } = req.body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt = `The user successfully found the object.
If the chosen language was ${nativeLanguage} (or if struggled=true):
Write a script from ${friendName} saying: "Nice, thank you! Just to let you know the ${targetLanguage} word for this object is ${targetObjectTranslated}, so next time you know what I need from you!"

If the chosen language was ${targetLanguage} and struggled=false:
Write a short line (70% ${nativeLanguage}, 30% ${targetLanguage}) thanking and congratulating the user for finding "${targetObjectTranslated}", then say you gotta go now.

The chosen language was ${chosenLanguage} and struggled is ${struggled}.

Respond ONLY with valid JSON (no markdown fences):
{
  "script": "the final success script"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
    });

    const data = await geminiRes.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error("Empty Gemini response");

    if (text.startsWith("```")) {
      text = text
        .replace(/^```[a-zA-Z]*\s*/, "")
        .replace(/\s*```$/, "")
        .trim();
    }

    res.json(JSON.parse(text));
  } catch (err) {
    console.error("phone-found error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-semantic-match ─────────────────────────────────────────
// Text-only Gemini check to forgive near-synonym object labels from CV.
app.post("/api/phone-semantic-match", async (req, res) => {
  const { targetObject, candidates } = req.body || {};
  if (!targetObject || !Array.isArray(candidates)) {
    return res.status(400).json({ error: "targetObject and candidates[] required" });
  }

  const cleanCandidates = candidates
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (cleanCandidates.length === 0) {
    return res.json({
      matched: false,
      matchedCandidate: "",
      confidence: 0,
      reason: "No candidates provided",
      modelUsed: "none",
    });
  }

  const cacheKey = `${normText(targetObject)}::${cleanCandidates
    .map((v) => normText(v))
    .join("|")}`;
  const cached = semanticCacheGet(cacheKey);
  if (cached) return res.json(cached);

  const modelName = process.env.GEMINI_SEMANTIC_MODEL || "gemini-2.0-flash";
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const prompt = `You are validating object-label similarity for a camera game.

Target object label: "${targetObject}"
Candidate labels detected by CV: ${cleanCandidates.join(", ")}

Goal:
- Decide if ANY candidate can reasonably mean the same physical object as the target in everyday usage.

Rules:
- Accept common synonyms, regional variants, and naming style differences.
- Example accepted: mobile phone, cellphone, handphone, smartphone.
- Reject candidates that are genuinely different object categories.
- If matched, choose the single best candidate from the provided list.

Respond ONLY with valid JSON:
{
  "matched": true|false,
  "matchedCandidate": "exact candidate string from the list or empty",
  "confidence": 0.0,
  "reason": "short reason"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 180,
      },
    });

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const parsed = parseModelJsonSafe(text, "phone-semantic-match");

    const requestedCandidate =
      typeof parsed?.matchedCandidate === "string" ? parsed.matchedCandidate.trim() : "";
    const normalizedRequested = normText(requestedCandidate);
    const chosenCandidate =
      cleanCandidates.find((c) => normText(c) === normalizedRequested) ||
      cleanCandidates.find((c) => {
        const n = normText(c);
        return n && normalizedRequested && (n.includes(normalizedRequested) || normalizedRequested.includes(n));
      }) ||
      "";
    const confidence = clamp(Number(parsed?.confidence) || 0, 0, 1);
    const minSemanticConfidence = clamp(
      Number(process.env.SEMANTIC_MATCH_MIN_CONFIDENCE) || 0.7,
      0,
      1,
    );
    const matched = Boolean(parsed?.matched) && Boolean(chosenCandidate) && confidence >= minSemanticConfidence;

    const response = {
      matched,
      matchedCandidate: matched ? chosenCandidate : "",
      confidence: matched ? confidence : 0,
      reason:
        typeof parsed?.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : matched
            ? "Semantic synonym accepted"
            : "No reliable semantic match",
      modelUsed: modelName,
    };

    semanticCacheSet(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error("phone-semantic-match error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-check-cv ─────────────────────────────────────────────────
app.post("/api/phone-check-cv", async (req, res) => {
  const { imageBase64, targetObject } = req.body;
  if (!imageBase64 || !targetObject) {
    return res
      .status(400)
      .json({ error: "imageBase64 and targetObject required" });
  }

  const primaryCvModel =
    process.env.GEMINI_CV_MODEL || "gemini-3.1-flash-image-preview";
  const fallbackCvModel =
    process.env.GEMINI_CV_FALLBACK_MODEL || "gemini-2.0-flash";
  const prompt = `You are a strict visual verifier for a language-learning game.
Target object to verify: "${targetObject}".

Rules:
- Only set "found" to true if the target object is clearly visible and you are highly confident.
- If uncertain, ambiguous, tiny, blurry, or partially hidden, set "found" to false.
- Accept close synonyms only when confidence is still high.
- If target is visible, include a normalized bounding box as x/y/width/height in [0,1] relative to the full image.
- Regardless of target match, detect other clearly visible objects in the scene.
- Always populate "visibleObjectDetections" with up to 8 objects when possible.

Respond ONLY with valid JSON (no markdown fences):
{
  "found": true|false,
  "confidence": 0.0,
  "matchType": "exact|synonym|none",
  "detectedObject": "best matching object name or empty string",
  "targetBoundingBox": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 } | null,
  "evidence": "short reason",
  "visibleObjects": ["obj1", "obj2", "obj3"],
  "visibleObjectDetections": [
    {
      "name": "object name",
      "confidence": 0.0,
      "boundingBox": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 }
    }
  ]
}`;

  const scenePrompt = `Identify clearly visible objects in this camera image.
Return up to 8 objects with normalized bounding boxes (x/y/width/height in [0,1]).

Respond ONLY with valid JSON (no markdown fences):
{
  "visibleObjects": ["obj1", "obj2", "obj3"],
  "visibleObjectDetections": [
    {
      "name": "object name",
      "confidence": 0.0,
      "boundingBox": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 }
    }
  ]
}`;

  try {
    const runCvModel = async (modelName, promptText = prompt) => {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      return lavaForward(geminiUrl, {
        contents: [
          {
            parts: [
              { text: promptText },
              { inline_data: { mime_type: "image/jpeg", data: imageBase64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 220 },
      });
    };

    let modelUsed = primaryCvModel;
    let geminiRes;

    try {
      geminiRes = await runCvModel(primaryCvModel);
    } catch (primaryErr) {
      if (fallbackCvModel && fallbackCvModel !== primaryCvModel) {
        console.warn(
          `[phone-check-cv] primary CV model "${primaryCvModel}" failed; falling back to "${fallbackCvModel}"`,
        );
        modelUsed = fallbackCvModel;
        geminiRes = await runCvModel(fallbackCvModel);
      } else {
        throw primaryErr;
      }
    }

    const data = await geminiRes.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error("Empty Gemini response");

    if (text.startsWith("```")) {
      text = text
        .replace(/^```[a-zA-Z]*\s*/, "")
        .replace(/\s*```$/, "")
        .trim();
    }

    const parsed = JSON.parse(text);
    const confidence = Number.isFinite(Number(parsed.confidence))
      ? Math.max(0, Math.min(1, Number(parsed.confidence)))
      : 0;
    const targetBoundingBox = sanitizeNormalizedBoundingBox(
      parsed.targetBoundingBox,
    );
    let visibleObjectDetections = sanitizeVisibleObjectDetections(
      parsed.visibleObjectDetections || parsed.objects || parsed.detections,
    );
    let fallbackSceneUsed = false;

    if (visibleObjectDetections.length === 0) {
      try {
        fallbackSceneUsed = true;
        const sceneRes = await runCvModel(modelUsed, scenePrompt);
        const sceneData = await sceneRes.json();
        let sceneText = sceneData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        const sceneParsed = sceneText
          ? parseModelJsonSafe(sceneText, "phone-check-cv-scene")
          : {};
        visibleObjectDetections = sanitizeVisibleObjectDetections(
          sceneParsed.visibleObjectDetections ||
            sceneParsed.objects ||
            sceneParsed.detections,
        );
      } catch (sceneErr) {
        console.warn("[phone-check-cv] scene fallback failed:", sceneErr.message);
      }
    }

    const visibleObjectsFromDetections = visibleObjectDetections.map((item) => item.name);
    const matchType =
      parsed.matchType === "exact" || parsed.matchType === "synonym"
        ? parsed.matchType
        : "none";
    const modelFound = Boolean(parsed.found);
    const found = modelFound && confidence >= 0.85 && matchType !== "none";

    const response = {
      found,
      confidence,
      matchType,
      detectedObject:
        typeof parsed.detectedObject === "string" ? parsed.detectedObject : "",
      targetBoundingBox,
      evidence: typeof parsed.evidence === "string" ? parsed.evidence : "",
      visibleObjects:
        visibleObjectsFromDetections.length > 0
          ? visibleObjectsFromDetections
          : Array.isArray(parsed.visibleObjects)
        ? parsed.visibleObjects
            .filter((v) => typeof v === "string")
            .slice(0, 5)
            : [],
      visibleObjectDetections,
      fallbackSceneUsed,
      modelFound,
      modelUsed,
    };

    console.log("[phone-check-cv]", {
      targetObject,
      modelUsed: response.modelUsed,
      found: response.found,
      modelFound: response.modelFound,
      confidence: response.confidence,
      matchType: response.matchType,
      detectedObject: response.detectedObject,
      targetBoundingBox: response.targetBoundingBox,
      evidence: response.evidence,
      visibleObjects: response.visibleObjects,
      visibleObjectDetections: response.visibleObjectDetections,
      fallbackSceneUsed: response.fallbackSceneUsed,
    });
    res.json(response);
  } catch (err) {
    console.error("phone-check-cv error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-transcribe ──────────────────────────────────────────────
// Gemini-based speech-to-text for short microphone chunks.
app.post("/api/phone-transcribe", async (req, res) => {
  const {
    audioBase64,
    mimeType = "audio/webm",
    languageHint = "en-US",
    context = "general",
  } = req.body || {};

  if (!audioBase64 || typeof audioBase64 !== "string") {
    return res.status(400).json({ error: "audioBase64 required" });
  }

  const modelName = process.env.GEMINI_STT_MODEL || "gemini-2.0-flash";
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt = `You are a speech-to-text engine.
Transcribe the user's short microphone audio exactly.

Rules:
- Language hint: ${languageHint}
- Context: ${context}
- Output plain words only (no commentary).
- If speech is unclear or silence, return an empty transcript.

Respond ONLY with valid JSON:
{
  "transcript": "recognized speech or empty string"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: audioBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 128,
      },
    });

    const data = await geminiRes.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawText) {
      return res.json({ transcript: "", modelUsed: modelName });
    }

    let transcript = "";
    try {
      const parsed = parseModelJsonSafe(rawText, "phone-transcribe");
      transcript =
        typeof parsed?.transcript === "string" ? parsed.transcript.trim() : "";
    } catch (jsonErr) {
      // Fallback: treat model output as raw transcript text.
      transcript = String(rawText)
        .replace(/^"+|"+$/g, "")
        .replace(/^transcript\s*:\s*/i, "")
        .trim();
    }

    res.json({
      transcript,
      modelUsed: modelName,
    });
  } catch (err) {
    console.error("phone-transcribe error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/generate-word-image ───────────────────────────────────────────
app.post("/api/generate-word-image", async (req, res) => {
  const { word } = req.body || {};
  if (!word || typeof word !== "string") {
    return res.status(400).json({ error: "word required" });
  }
  const key = word.toLowerCase().trim();
  if (wordImageCache.has(key)) {
    return res.json(wordImageCache.get(key));
  }
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${process.env.GEMINI_API_KEY}`;
  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: `Simple flat icon of a ${key}. White background, no text, bold clear shape, sticker style, minimal.` }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    });
    const data = await geminiRes.json();
    console.log("[generate-word-image] raw response keys:", JSON.stringify(Object.keys(data)));
    const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part?.inlineData) throw new Error(`No image in response: ${JSON.stringify(data).slice(0, 200)}`);
    const result = { imageBase64: part.inlineData.data, mimeType: part.inlineData.mimeType || "image/png" };
    wordImageCache.set(key, result);
    res.json(result);
  } catch (err) {
    console.error("generate-word-image error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
