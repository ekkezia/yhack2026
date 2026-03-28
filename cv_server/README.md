# YOLO CV Server

Separate Python server for real-time object detection using YOLO.
This is independent from the existing Node/Gemini server.

## Endpoints
- `GET /health`
- `POST /detect` with body:
  - `imageBase64` (JPEG base64 string, no data URL prefix)
  - `targetObject` (string)

Response shape matches the client CV contract (`found`, `visibleObjectDetections`, `targetBoundingBox`, etc.).

## Quick Start
1. Install deps:
```bash
npm run install:cv
```
This uses a local virtualenv at `cv_server/.venv` (safe on macOS/Homebrew Python).
2. Run server:
```bash
npm run dev:cv
```
First startup may take a moment while YOLO model weights are downloaded.

Default port is `8001` (override with `CV_SERVER_PORT`).

## Env vars (optional)
- `YOLO_MODEL` (default: `yolov8n.pt`)
- `YOLO_CONF_THRESHOLD` (default: `0.2`)
- `YOLO_TARGET_MATCH_THRESHOLD` (default: `0.32`)
- `YOLO_MAX_OBJECTS` (default: `8`)
- `YOLO_IMAGE_SIZE` (default: `640`)
- `CV_SERVER_PORT` (default: `8001`)
