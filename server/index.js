require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

// ─── Lava forward-proxy helper ───────────────────────────────────────────────
// Lava routes your request to the provider and meters usage.
// Format: POST https://api.lava.so/v1/forward?u=<URL-encoded provider endpoint>
async function lavaForward(providerUrl, body, extraHeaders = {}) {
  const url = `https://api.lava.so/v1/forward?u=${encodeURIComponent(providerUrl)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LAVA_SECRET_KEY}`,
      'Content-Type': 'application/json',
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
app.post('/api/detect-and-script', async (req, res) => {
  const { imageBase64, targetLanguage = process.env.TARGET_LANGUAGE || 'Spanish' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt = `You are a fun, encouraging language-learning assistant.
Analyze this camera image from a mobile user's perspective.

Tasks:
1. Find ONE common, nameable object clearly visible in the scene (something with a vocabulary word).
2. Determine its approximate position: "left", "center", or "right" side of the image.
3. Write a short enthusiastic voice script (2–3 natural sentences) in English that:
   - Tells the user you spotted something interesting on their [position]
   - Asks if they want to guess what it is in ${targetLanguage}
   - Keep it playful and under 40 words total
4. Provide the ${targetLanguage} translation of the object's name.

Respond ONLY with valid JSON (no markdown fences):
{
  "object": "english object name",
  "position": "left|center|right",
  "script": "the voice script text",
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
            { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
    });

    const geminiData = await geminiRes.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Empty Gemini response');

    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    console.error('detect-and-script error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/speak ──────────────────────────────────────────────────────────
// Sends script text to ElevenLabs via Lava, returns audio as base64.
app.post('/api/speak', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const elUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  try {
    const elRes = await lavaForward(
      elUrl,
      {
        text,
        model_id: 'eleven_turbo_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
    );

    const audioBuffer = await elRes.buffer();
    res.json({ audioBase64: audioBuffer.toString('base64'), mimeType: 'audio/mpeg' });
  } catch (err) {
    console.error('speak error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/check-answer ───────────────────────────────────────────────────
// Uses Gemini to validate a user's guess (fuzzy match, accept partial/phonetic).
app.post('/api/check-answer', async (req, res) => {
  const { guess, correctObject, targetLanguage = process.env.TARGET_LANGUAGE || 'Spanish' } = req.body;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  try {
    const geminiRes = await lavaForward(geminiUrl, {
      contents: [
        {
          parts: [
            {
              text: `The correct object is "${correctObject}". The user guessed "${guess}" (they may answer in English or ${targetLanguage}).
Is this correct or close enough? Accept reasonable synonyms and phonetic approximations.
Respond ONLY with JSON: { "correct": true|false, "feedback": "short encouraging message (max 10 words)" }`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.3, maxOutputTokens: 64 },
    });

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    res.json(JSON.parse(text));
  } catch (err) {
    console.error('check-answer error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
