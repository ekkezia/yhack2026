require("dotenv").config({ path: "../.env.local" });
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

const FRIEND_NAMES = [
  "Alex",
  "Maya",
  "Jordan",
  "Sam",
  "Katy",
  "Riley",
  "Noah",
  "Avery",
  "Emma",
  "Leo",
];

const TARGET_OBJECTS = [
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

let lastPhoneTargetObject = null;

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

function normalizeChosenLanguage(value, nativeLanguage, targetLanguage) {
  const raw = normText(value);
  if (!raw) return nativeLanguage;

  const native = normText(nativeLanguage);
  const target = normText(targetLanguage);
  if (raw.includes(target) || target.includes(raw)) return targetLanguage;
  if (raw.includes(native) || native.includes(raw)) return nativeLanguage;
  return nativeLanguage;
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

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function estimateWalkingMinutes(distanceMeters) {
  const speedMetersPerMin = 78;
  return Math.max(1, Math.round((Number(distanceMeters) || 0) / speedMetersPerMin));
}

async function fetchJson(url, options = {}, context = "fetch-json") {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${context} ${res.status}: ${text}`);
  }
  return res.json();
}

function simplifyPlaceLabel(reverseData) {
  if (!reverseData || typeof reverseData !== "object") return "";
  const address = reverseData.address || {};
  return (
    address.building ||
    address.amenity ||
    address.attraction ||
    address.university ||
    address.college ||
    address.school ||
    address.house ||
    address.road ||
    reverseData.name ||
    reverseData.display_name ||
    ""
  );
}

async function reverseGeocode(latitude, longitude) {
  const lat = numberOrNull(latitude);
  const lon = numberOrNull(longitude);
  if (lat === null || lon === null) return null;

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  try {
    const data = await fetchJson(
      url.toString(),
      {
        headers: {
          "User-Agent": "yhack2026/1.0 (location-mission)",
          "Accept-Language": "en",
        },
      },
      "reverse-geocode",
    );
    return data;
  } catch (err) {
    console.warn("reverseGeocode failed:", err.message);
    return null;
  }
}

async function findNearbyPlaces(latitude, longitude, radiusMeters = 900) {
  const lat = numberOrNull(latitude);
  const lon = numberOrNull(longitude);
  if (lat === null || lon === null) return [];

  const query = `[out:json][timeout:15];
(
  node(around:${Math.round(radiusMeters)},${lat},${lon})["name"]["amenity"];
  way(around:${Math.round(radiusMeters)},${lat},${lon})["name"]["amenity"];
  node(around:${Math.round(radiusMeters)},${lat},${lon})["name"]["building"];
  way(around:${Math.round(radiusMeters)},${lat},${lon})["name"]["building"];
  node(around:${Math.round(radiusMeters)},${lat},${lon})["name"]["tourism"];
  way(around:${Math.round(radiusMeters)},${lat},${lon})["name"]["tourism"];
  node(around:${Math.round(radiusMeters)},${lat},${lon})["name"]["leisure"];
  way(around:${Math.round(radiusMeters)},${lat},${lon})["name"]["leisure"];
);
out center 120;`;

  try {
    const data = await fetchJson(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: query,
      },
      "overpass-nearby",
    );
    const elements = Array.isArray(data?.elements) ? data.elements : [];
    const dedup = new Map();

    for (const item of elements) {
      const name = typeof item?.tags?.name === "string" ? item.tags.name.trim() : "";
      if (!name) continue;
      const itemLat =
        numberOrNull(item.lat) ?? numberOrNull(item.center?.lat);
      const itemLon =
        numberOrNull(item.lon) ?? numberOrNull(item.center?.lon);
      if (itemLat === null || itemLon === null) continue;
      const key = normText(name);
      if (!key) continue;
      const distanceMeters = haversineMeters(lat, lon, itemLat, itemLon);
      const previous = dedup.get(key);
      if (!previous || distanceMeters < previous.distanceMeters) {
        dedup.set(key, {
          name,
          latitude: itemLat,
          longitude: itemLon,
          distanceMeters,
        });
      }
    }

    return Array.from(dedup.values())
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 40);
  } catch (err) {
    console.warn("findNearbyPlaces failed:", err.message);
    return [];
  }
}

function chooseDestinationFromNearby(nearbyPlaces, shortTime = false) {
  if (!Array.isArray(nearbyPlaces) || nearbyPlaces.length === 0) return null;
  const places = nearbyPlaces.filter((p) => p.distanceMeters >= 25);
  if (places.length === 0) return nearbyPlaces[0];

  if (shortTime) {
    const close = places.find((p) => p.distanceMeters <= 220);
    return close || places[0];
  }

  const medium = places.find((p) => p.distanceMeters >= 350 && p.distanceMeters <= 950);
  return medium || places[Math.min(2, places.length - 1)] || places[0];
}

function inferShortTime(replyText) {
  const t = normText(replyText);
  if (!t) return true;
  const shortSignals = [
    "short",
    "quick",
    "few",
    "2 min",
    "2 mins",
    "3 min",
    "brief",
    "little time",
    "not much",
  ];
  if (shortSignals.some((s) => t.includes(s))) return true;

  const longerSignals = [
    "10 min",
    "10 mins",
    "ten min",
    "ten mins",
    "more time",
    "i can walk",
    "longer",
  ];
  if (longerSignals.some((s) => t.includes(s))) return false;
  return true;
}

async function runGeminiJsonPrompt({
  prompt,
  contextLabel,
  temperature = 0.7,
  maxOutputTokens = 220,
}) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const geminiRes = await lavaForward(geminiUrl, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens },
  });
  const data = await geminiRes.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return parseModelJsonSafe(text, contextLabel);
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
    targetLanguage = process.env.TARGET_LANGUAGE || "Portuguese",
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

  const targetLanguage = process.env.TARGET_LANGUAGE || "Portuguese";
  const isTargetLanguage =
    language &&
    language.trim().toLowerCase() === targetLanguage.trim().toLowerCase();
  const voiceId =
    customVoiceId ||
    (isTargetLanguage ? "e06XicPETIbfUaeHM9zH" : null) ||
    process.env.ELEVENLABS_VOICE_ID ||
    "21m00Tcm4TlvDq8ikWAM";
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
    targetLanguage = process.env.TARGET_LANGUAGE || "Portuguese",
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
  const { nativeLanguage = "English" } = req.body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const friendName = pickRandomFrom(FRIEND_NAMES);
  const prompt = `You are writing a short opening line for a friendly phone call.
Friend name: "${friendName}".
Language: ${nativeLanguage} only.

Goal:
- Ask where the user is right now so you can meet them.

Instructions:
1. Keep it casual and warm, like a friend meeting up.
2. Ask user their current location.
3. Max 24 words.

Respond ONLY with valid JSON:
{
  "script": "opening line in ${nativeLanguage}"
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

    const parsed = parseModelJsonSafe(text, "phone-start");
    const payload = {
      friendName,
      targetObject: "",
      targetObjectTranslated: "",
      script:
        parsed.script ||
        `Hey, it's ${friendName}. Where are you right now? I want to meet you nearby.`,
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

// ─── POST /api/phone-confirm-location ────────────────────────────────────────
app.post("/api/phone-confirm-location", async (req, res) => {
  const {
    friendName = "Avery",
    transcript = "",
    latitude,
    longitude,
    nativeLanguage = "English",
  } = req.body;

  const lat = numberOrNull(latitude);
  const lon = numberOrNull(longitude);
  if (!transcript || lat === null || lon === null) {
    return res
      .status(400)
      .json({ error: "transcript, latitude, and longitude required" });
  }

  try {
    const reverse = await reverseGeocode(lat, lon);
    const gpsPlace = simplifyPlaceLabel(reverse) || "your area";
    const displayAddress = reverse?.display_name || gpsPlace;
    const claimNorm = normText(transcript);
    const gpsNorm = normText(`${gpsPlace} ${displayAddress}`);
    const heuristicMatch =
      claimNorm &&
      gpsNorm &&
      (gpsNorm.includes(claimNorm) ||
        claimNorm
          .split(" ")
          .filter((t) => t.length >= 4)
          .some((token) => gpsNorm.includes(token)));

    const prompt = `You are "${friendName}" on a casual call in ${nativeLanguage}.
User said they are at: "${transcript}".
GPS reverse-geocoded place label: "${gpsPlace}".
GPS full address context: "${displayAddress}".
Heuristic text match result: ${heuristicMatch ? "likely match" : "uncertain"}.

Task:
1. Confirm where user is in a natural, friendly way like trying to meet them.
2. Keep it concise (max 28 words).
3. If uncertain mismatch, gently say what GPS suggests and ask a quick confirm.

Respond ONLY with valid JSON:
{
  "claimMatchesGps": true|false,
  "confirmedPlaceName": "short place/building name",
  "script": "friendly confirmation line"
}`;

    let parsed = {};
    try {
      parsed = await runGeminiJsonPrompt({
        prompt,
        contextLabel: "phone-confirm-location",
        temperature: 0.5,
        maxOutputTokens: 170,
      });
    } catch (modelErr) {
      console.warn("phone-confirm-location model fallback:", modelErr.message);
    }

    const modelMatch = Boolean(parsed.claimMatchesGps);
    const claimMatchesGps =
      heuristicMatch || (!heuristicMatch && modelMatch && claimNorm.length > 0);
    const confirmedPlaceName =
      typeof parsed.confirmedPlaceName === "string" &&
      parsed.confirmedPlaceName.trim()
        ? parsed.confirmedPlaceName.trim()
        : gpsPlace;

    res.json({
      claimMatchesGps,
      confirmedPlaceName,
      latitude: lat,
      longitude: lon,
      script:
        typeof parsed.script === "string" && parsed.script.trim()
          ? parsed.script.trim()
          : claimMatchesGps
            ? `Perfect, got you at ${confirmedPlaceName}. I'll head near there.`
            : `Got it, I see you around ${confirmedPlaceName}. Is that right?`,
    });
  } catch (err) {
    console.error("phone-confirm-location error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-plan-destination ────────────────────────────────────────
app.post("/api/phone-plan-destination", async (req, res) => {
  const {
    friendName = "Avery",
    originPlaceName = "",
    latitude,
    longitude,
    timeBudgetReply = "",
    nativeLanguage = "English",
  } = req.body;

  const lat = numberOrNull(latitude);
  const lon = numberOrNull(longitude);
  if (lat === null || lon === null) {
    return res.status(400).json({ error: "latitude and longitude required" });
  }

  try {
    const shortTime = inferShortTime(timeBudgetReply);
    const reverse = await reverseGeocode(lat, lon);
    const originName =
      originPlaceName ||
      simplifyPlaceLabel(reverse) ||
      "your current building";

    const nearby = await findNearbyPlaces(lat, lon, shortTime ? 420 : 1400);
    const chosen = chooseDestinationFromNearby(nearby, shortTime);

    const destinationName = chosen?.name || `${originName} Entrance`;
    const destinationLat =
      numberOrNull(chosen?.latitude) ?? lat;
    const destinationLon =
      numberOrNull(chosen?.longitude) ?? lon;
    const rawDistance = haversineMeters(lat, lon, destinationLat, destinationLon);
    const distanceMeters = Math.max(20, Math.round(rawDistance));
    const walkMinutesRaw = estimateWalkingMinutes(distanceMeters);
    const walkMinutes = shortTime
      ? clamp(walkMinutesRaw, 1, 3)
      : clamp(walkMinutesRaw, 4, 12);

    const prompt = `You are "${friendName}" planning a meetup.
Speak in ${nativeLanguage}.

User origin place: "${originName}".
Chosen destination: "${destinationName}".
Estimated walk: ${walkMinutes} minutes.
Time preference reply: "${timeBudgetReply}".

Tasks:
1. Write one inviting line asking user to meet you at "${destinationName}".
2. Add one interesting "selling-point" story hook about what you are doing there.
3. Keep it natural and concise (max 36 words).

Respond ONLY with valid JSON:
{
  "script": "friendly meetup request with destination and story hook",
  "storySeed": "1 short sentence seed for ongoing route narration"
}`;

    let parsed = {};
    try {
      parsed = await runGeminiJsonPrompt({
        prompt,
        contextLabel: "phone-plan-destination",
        temperature: 0.7,
        maxOutputTokens: 220,
      });
    } catch (modelErr) {
      console.warn("phone-plan-destination model fallback:", modelErr.message);
    }

    const storySeed =
      typeof parsed.storySeed === "string" && parsed.storySeed.trim()
        ? parsed.storySeed.trim()
        : `I found something cool at ${destinationName} and want to show you when you arrive.`;

    res.json({
      originPlaceName: originName,
      destinationName,
      destinationLatitude: destinationLat,
      destinationLongitude: destinationLon,
      walkMinutes,
      arrivalRadiusMeters: shortTime ? 45 : 60,
      shortTime,
      storySeed,
      script:
        typeof parsed.script === "string" && parsed.script.trim()
          ? parsed.script.trim()
          : `Do you have ${walkMinutes} minutes? Meet me at ${destinationName}. I have a great story for you there.`,
    });
  } catch (err) {
    console.error("phone-plan-destination error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-route-yap ───────────────────────────────────────────────
app.post("/api/phone-route-yap", async (req, res) => {
  const {
    friendName = "Avery",
    originPlaceName = "your starting point",
    destinationName = "the destination",
    distanceRemainingMeters = 0,
    stepCount = 0,
    sessionSeconds = 0,
    storySeed = "",
    noProgressRounds = 0,
    nativeLanguage = "English",
  } = req.body;

  try {
    const distance = Math.max(0, Math.round(Number(distanceRemainingMeters) || 0));
    const prompt = `You are "${friendName}" on a live call in ${nativeLanguage}.
User is walking from "${originPlaceName}" to "${destinationName}" to meet you.

Context:
- Steps so far: ${Number(stepCount) || 0}
- Session seconds: ${Number(sessionSeconds) || 0}
- Distance remaining (meters): ${distance}
- Story seed: "${storySeed}"
- Consecutive low-progress rounds: ${Number(noProgressRounds) || 0}

Instructions:
1. Keep chatting like a friend and continue the destination story hook.
2. Encourage user progress toward "${destinationName}".
3. If low-progress rounds >=2, nudge them to keep moving.
4. Max 30 words.

Respond ONLY with valid JSON:
{
  "script": "one short conversational line"
}`;

    let parsed = {};
    try {
      parsed = await runGeminiJsonPrompt({
        prompt,
        contextLabel: "phone-route-yap",
        temperature: 0.85,
        maxOutputTokens: 150,
      });
    } catch (modelErr) {
      console.warn("phone-route-yap model fallback:", modelErr.message);
    }

    const fallback = distance <= 80
      ? `You're really close. Keep going to ${destinationName}, I'm almost downstairs.`
      : `Nice pace. Keep coming toward ${destinationName}. I can't wait to tell you this story in person.`;

    res.json({
      script:
        typeof parsed.script === "string" && parsed.script.trim()
          ? parsed.script.trim()
          : fallback,
    });
  } catch (err) {
    console.error("phone-route-yap error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/phone-arrived ─────────────────────────────────────────────────
app.post("/api/phone-arrived", async (req, res) => {
  const {
    friendName = "Avery",
    originPlaceName = "your location",
    destinationName = "our meetup spot",
    stepCount = 0,
    sessionSeconds = 0,
    nativeLanguage = "English",
  } = req.body;

  try {
    const prompt = `You are "${friendName}" in ${nativeLanguage}.
User has reached "${destinationName}" from "${originPlaceName}".
Steps taken: ${Number(stepCount) || 0}.
Session seconds: ${Number(sessionSeconds) || 0}.

Write one final line:
- say they made it,
- say you'll end the call now,
- say you'll meet them downstairs.
- max 24 words.

Respond ONLY with valid JSON:
{
  "script": "final line"
}`;

    let parsed = {};
    try {
      parsed = await runGeminiJsonPrompt({
        prompt,
        contextLabel: "phone-arrived",
        temperature: 0.6,
        maxOutputTokens: 120,
      });
    } catch (modelErr) {
      console.warn("phone-arrived model fallback:", modelErr.message);
    }

    res.json({
      script:
        typeof parsed.script === "string" && parsed.script.trim()
          ? parsed.script.trim()
          : `Perfect, you made it to ${destinationName}. I'll end the call now and meet you downstairs.`,
    });
  } catch (err) {
    console.error("phone-arrived error:", err.message);
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
    targetLanguage = process.env.TARGET_LANGUAGE || "Portuguese",
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
   - If gameMode is "find_requested": ask the user to find your missing object now. Use "${targetObjectTranslated}" when speaking ${targetLanguage}.
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
        : `Perfeito, vamos em ${targetLanguage}. Preciso achar meu ${targetObjectTranslated} agora. Pode me ajudar?`;

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
    visibleObjects = [],
    focusObject = "",
    noObjectRounds = 0,
    stepCount = 0,
    retrievedObjects = [],
    sessionSeconds = 0,
    nativeLanguage = "English",
  } = req.body;

  const visibleList = Array.isArray(visibleObjects)
    ? visibleObjects.filter((v) => typeof v === "string").slice(0, 6)
    : [];
  const cleanFocusObject =
    typeof focusObject === "string" ? focusObject.trim() : "";
  const retrievedList = Array.isArray(retrievedObjects)
    ? retrievedObjects
        .filter((v) => typeof v === "string")
        .slice(-6)
    : [];
  const targetNorm = normText(targetObject);
  const focusNorm = normText(cleanFocusObject);
  const hasWrongObject =
    Boolean(cleanFocusObject) && focusNorm && targetNorm && focusNorm !== targetNorm;
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const prompt = `You are "${friendName}" in an ongoing fitness treasure-hunt phone call.
Speak in ${nativeLanguage} only.

Context:
- Current target item to retrieve: "${targetObject}"
- Focus object user is showing now: "${cleanFocusObject || "none"}"
- Clearly visible objects: ${visibleList.length ? visibleList.join(", ") : "none detected"}
- Is focus object wrong for this target: ${hasWrongObject ? "yes" : "no"}
- Objects retrieved so far this session: ${retrievedList.length ? retrievedList.join(", ") : "none yet"}
- Session footsteps so far: ${Number(stepCount) || 0}
- Session time in seconds: ${Number(sessionSeconds) || 0}
- Consecutive rounds with no clear objects: ${Number(noObjectRounds) || 0}

Instructions:
1. Keep it conversational and energetic, like a friend coaching a game.
2. If focus object is wrong, explicitly say it's the wrong item and restate the correct target "${targetObject}".
3. If no objects are visible, encourage movement and scanning the room.
4. Continue the story momentum (fitness + treasure-hunt vibe).
5. Max 28 words.

Respond ONLY with valid JSON:
{
  "script": "one short line in ${nativeLanguage}"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 120 },
    });

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const parsed = parseModelJsonSafe(text, "phone-yap");
    const fallbackScript = hasWrongObject
      ? `Close, but ${cleanFocusObject} is the wrong item. Keep moving and find the ${targetObject}.`
      : `Nice pace. Keep moving and find the ${targetObject}.`;

    res.json({
      script:
        typeof parsed.script === "string" && parsed.script.trim()
          ? parsed.script.trim()
          : fallbackScript,
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
    visibleObjects = [],
    nativeLanguage = "English",
  } = req.body;

  if (!transcript) return res.status(400).json({ error: "transcript required" });

  const visibleList = Array.isArray(visibleObjects)
    ? visibleObjects.filter((v) => typeof v === "string").slice(0, 8)
    : [];
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const prompt = `You are "${friendName}" on a live fitness treasure-hunt phone call.
User interrupted and said: "${transcript}".
Speak in ${nativeLanguage} only.

Context:
- Current target item: "${targetObject}"
- Visible objects: ${visibleList.length ? visibleList.join(", ") : "none detected"}

Instructions:
1. Reply naturally to the user's interruption/question.
2. Be warm, concise, and fun.
3. Bring them back to finding "${targetObject}".
4. Max 26 words.

Respond ONLY with valid JSON:
{
  "script": "short response in ${nativeLanguage}"
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
        `Great question. Keep moving and keep scanning, we still need the ${targetObject}.`,
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
    targetLanguage = process.env.TARGET_LANGUAGE || "Portuguese",
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
    targetLanguage = process.env.TARGET_LANGUAGE || "Portuguese",
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
    targetLanguage = process.env.TARGET_LANGUAGE || "Portuguese",
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
    foundObject,
    nextTarget,
    retrievedObjects = [],
    stepCount = 0,
    sessionSeconds = 0,
    nativeLanguage = "English",
  } = req.body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const retrievedList = Array.isArray(retrievedObjects)
    ? retrievedObjects
        .filter((v) => typeof v === "string")
        .slice(-8)
    : [];

  const prompt = `You are "${friendName}" in a live fitness treasure-hunt call.
The user just retrieved: "${foundObject}".
Next object to retrieve: "${nextTarget}".
Objects retrieved so far: ${retrievedList.length ? retrievedList.join(", ") : "none"}.
Session footsteps so far: ${Number(stepCount) || 0}.
Session time in seconds: ${Number(sessionSeconds) || 0}.

Write one short energetic continuation line in ${nativeLanguage}:
- celebrate finding "${foundObject}",
- keep the story going,
- clearly tell them the next target is "${nextTarget}",
- do NOT end the call.
- max 30 words.

Respond ONLY with valid JSON:
{
  "script": "continuation line in ${nativeLanguage}"
}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
    });

    const data = await geminiRes.json();
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error("Empty Gemini response");

    const parsed = parseModelJsonSafe(text, "phone-found");
    res.json({
      script:
        typeof parsed.script === "string" && parsed.script.trim()
          ? parsed.script.trim()
          : `Great grab, ${foundObject}! Keep moving, next mission item is ${nextTarget}.`,
    });
  } catch (err) {
    console.error("phone-found error:", err.message);
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

app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
