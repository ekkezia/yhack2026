# LinguaLens: Real-Time Visual Language Learning

LinguaLens is a mobile-first web application that turns the physical world into a language-learning playground. It uses a camera feed to detect objects in real-time, generates contextual voice scripts in a native language (e.g., English), and challenges users to identify objects in a target language (e.g., Portuguese).

## 🏗 Project Architecture

The project is structured as a monorepo with a decoupled Client and Server.

### 1. Server (`/server`)
- **Runtime:** Node.js + Express (CommonJS).
- **Core Logic:** `server/index.js` handles API orchestration and "Lava" proxying.
- **Lava Forward Proxy:** All external LLM/AI requests are routed through `https://api.lava.so/v1/forward`. This provides a unified interface for metering and routing to providers like Google Gemini and ElevenLabs.
- **Endpoints:**
    - `POST /api/detect-and-script`: Receives a base64 image frame. Uses **Gemini 2.0 Flash** to perform both object detection and creative script writing in a single LLM pass to minimize latency.
    - `POST /api/speak`: Forwards text to **ElevenLabs** (via Lava) to generate high-quality TTS audio.
    - `POST /api/check-answer`: Uses Gemini to perform "fuzzy" validation of user guesses (accepting phonetic approximations or synonyms).

### 2. Client (`/client`)
- **Framework:** React + Vite (ESM).
- **Styling:** CSS Modules / standard CSS in `App.css`.
- **Core Components:**
    - `CameraView.jsx`: Manages `getUserMedia` and provides the raw video stream.
    - `GameOverlay.jsx`: The UI layer handling the "Game Loop" phases.
    - `useMotionDetection.js`: A custom hook that analyzes the video stream for pixel-level changes. It triggers the "Scan" event only when the user holds the camera still for a set duration (3 seconds).
- **API Services:** `client/src/services/api.js` centralizes fetch calls to the server.

## 🔄 The Game Loop (State Machine)

The application moves through several distinct phases defined in `App.jsx`:

1.  **Idle**: Initial state before camera access.
2.  **Watching**: Monitoring motion. A progress ring fills as the user holds the camera still.
3.  **Scanning**: Triggered by the motion hook. A frame is captured and sent to the server.
4.  **Speaking**: The server returns a script and audio. The client plays the audio immediately.
5.  **Guessing**: The user is prompted to type or speak the target word.
6.  **Result**: Feedback is shown based on the LLM's evaluation of the guess.

## 🛠 Tech Stack & Dependencies

| Component | Technology |
| :--- | :--- |
| **Intelligence** | Google Gemini 2.0 Flash |
| **Voice** | ElevenLabs (TTS) |
| **Proxy/Metering** | Lava (api.lava.so) |
| **Frontend** | React 18, Vite 6 |
| **Backend** | Express, Node-Fetch |
| **Motion** | Canvas API (Pixel-diffing) |

## 🚀 Setup & Development

### Prerequisites
- Node.js (v18+)
- A `.env.local` file in the root directory (one level above `server/`) containing:
    - `GEMINI_API_KEY`
    - `ELEVENLABS_API_KEY`
    - `LAVA_SECRET_KEY`
    - `TARGET_LANGUAGE` (e.g., Portuguese)
    - `NATIVE_LANGUAGE` (e.g., English)

### Installation
Run the helper script from the root:
```bash
npm run install:all
```

### Running Locally
```bash
npm run dev
```
- Client runs on: `http://localhost:5173`
- Server runs on: `http://localhost:3001`
- The Vite config is pre-configured with a proxy to route `/api` requests to the Node server.

### Remote Access (ngrok)
To test on mobile devices, use ngrok to tunnel the Vite port. The `vite.config.js` is configured with `allowedHosts: true` and `host: true` to support external tunneling without Host header collisions.

## 🤖 LLM Implementation Details
- **Single-Pass Inference:** To avoid "chaining" latency, `detect-and-script` asks Gemini to return a structured JSON object containing object metadata, side-of-screen positioning, and the TTS script simultaneously.
- **Fuzzy Matching:** `check-answer` uses a low-temperature Gemini prompt (0.3) to ensure it acts as a reliable validator rather than a creative agent.