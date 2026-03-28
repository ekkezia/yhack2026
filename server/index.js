require("dotenv").config({ path: "../.env.local" });
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

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
    if (text.startsWith("```")) {
      text = text
        .replace(/^```[a-zA-Z]*\s*/, "")
        .replace(/\s*```$/, "")
        .trim();
    }

    const parsed = JSON.parse(text);
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
  const {
    targetLanguage = process.env.TARGET_LANGUAGE || "Portuguese",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
  } = req.body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt = `You are designing a script for an AI friend calling the user.
Randomly choose a friend's name (e.g., Katy, Alex) and a common household object (e.g., keys, mug, shoe) the user must find.
Write an opening line for a phone call in ${nativeLanguage} saying something like: "Hey long time no see, it's [Name]. Do you prefer I talk in ${nativeLanguage} or ${targetLanguage}?" Make it friendly and natural.

Respond ONLY with valid JSON (no markdown fences):
{
  "friendName": "Friend's name",
  "targetObject": "object name in ${nativeLanguage}",
  "targetObjectTranslated": "object name in ${targetLanguage}",
  "script": "opening script"
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

    res.json(JSON.parse(text));
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
    targetLanguage = process.env.TARGET_LANGUAGE || "Portuguese",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
  } = req.body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt = `The user was asked whether they prefer to speak in ${nativeLanguage} or ${targetLanguage}.
Their reply was: "${transcript}"
1. Determine which language they chose (default to ${nativeLanguage} if unsure).
2. Write a follow-up script from the friend "${friendName}" in the CHOSEN language.
The script should say something like: "I need help from you, I left my [object] with you, can you help me find it? I need it asap."
Use "${targetObject}" if the chosen language is ${nativeLanguage}, and "${targetObjectTranslated}" if the chosen language is ${targetLanguage}.

Respond ONLY with valid JSON (no markdown fences):
{
  "chosenLanguage": "the language they picked (${nativeLanguage} or ${targetLanguage})",
  "script": "the script asking to find the object"
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
    console.error("phone-reply error:", err.message);
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
    targetObject,
    targetObjectTranslated,
    chosenLanguage,
    targetLanguage = process.env.TARGET_LANGUAGE || "Portuguese",
    nativeLanguage = process.env.NATIVE_LANGUAGE || "English",
    struggled = false,
  } = req.body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt = `The user successfully found the object.
If the chosen language was ${nativeLanguage} (or if struggled=true):
Write a script from ${friendName} saying: "Nice, thank you! Just to let you know the ${targetLanguage} word for this object is ${targetObjectTranslated}, so next time you know what I need from you!"

If the chosen language was ${targetLanguage} and struggled=false:
Write a script in ${targetLanguage} saying: "Nice, thanks so much!" and complimenting them.

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

// ─── POST /api/phone-check-cv ─────────────────────────────────────────────────
app.post("/api/phone-check-cv", async (req, res) => {
  const { imageBase64, targetObject } = req.body;
  if (!imageBase64 || !targetObject) {
    return res
      .status(400)
      .json({ error: "imageBase64 and targetObject required" });
  }

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const prompt = `Look at this image from a mobile user's perspective.
Is there a clearly visible "${targetObject}" in it?
Respond ONLY with valid JSON (no markdown fences):
{
  "found": true|false
}`;

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
      generationConfig: { temperature: 0.1, maxOutputTokens: 64 },
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
    console.error("phone-check-cv error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
