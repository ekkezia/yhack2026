import base64
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from ultralytics import YOLO

app = Flask(__name__)
CORS(app)

SCRIPT_DIR = Path(__file__).resolve().parent
YOLO_MODEL_NAME = os.getenv("YOLO_MODEL", "yolov8n.pt")
YOLO_CONF_THRESHOLD = float(os.getenv("YOLO_CONF_THRESHOLD", "0.2"))
YOLO_TARGET_MATCH_THRESHOLD = float(os.getenv("YOLO_TARGET_MATCH_THRESHOLD", "0.32"))
YOLO_MAX_OBJECTS = int(os.getenv("YOLO_MAX_OBJECTS", "8"))
YOLO_IMAGE_SIZE = int(os.getenv("YOLO_IMAGE_SIZE", "640"))
CV_SERVER_PORT = int(os.getenv("CV_SERVER_PORT", "8001"))

_model_lock = threading.Lock()
_model_path = Path(YOLO_MODEL_NAME)
if not _model_path.is_absolute():
    _model_path = SCRIPT_DIR / _model_path
_model = YOLO(str(_model_path))

TARGET_ALIASES = {
    "water bottle": ["bottle", "water bottle"],
    "remote control": ["remote", "remote control"],
    "headphones": ["headphones", "headset", "earphones"],
    "glasses": ["glasses", "sunglasses", "eyeglasses"],
    "keys": ["keys", "key"],
    "shoe": ["shoe", "shoes", "sneaker", "boot", "sandals"],
    "wallet": ["wallet", "purse"],
    "backpack": ["backpack", "bag"],
    "laptop": ["laptop", "computer"],
    "mug": ["mug", "cup"],
    "banana": ["banana"],
    "apple": ["apple"],
    "plate": ["plate", "dish"],
    "book": ["book"],
    "toothbrush": ["toothbrush", "tooth brush"],
}


def norm_text(value: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", (value or "").lower()).strip()


def decode_base64_image(image_base64: str) -> np.ndarray:
    raw = base64.b64decode(image_base64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image data")
    return image


def clamp(v: float, low: float, high: float) -> float:
    return max(low, min(high, v))


def normalize_bbox_xyxy(x1: float, y1: float, x2: float, y2: float, w: int, h: int) -> Optional[Dict[str, float]]:
    if w <= 0 or h <= 0:
        return None

    nx1 = clamp(x1 / w, 0.0, 1.0)
    ny1 = clamp(y1 / h, 0.0, 1.0)
    nx2 = clamp(x2 / w, 0.0, 1.0)
    ny2 = clamp(y2 / h, 0.0, 1.0)

    if nx2 <= nx1 or ny2 <= ny1:
        return None

    return {
        "x": nx1,
        "y": ny1,
        "width": nx2 - nx1,
        "height": ny2 - ny1,
    }


def build_target_aliases(target_object: str) -> List[str]:
    base = norm_text(target_object)
    if not base:
        return []

    aliases = {base}
    if base.endswith("s"):
        aliases.add(base[:-1])
    else:
        aliases.add(f"{base}s")

    for extra in TARGET_ALIASES.get(base, []):
        aliases.add(norm_text(extra))

    return [a for a in aliases if a]


def is_target_match(det_name: str, target_aliases: List[str]) -> str:
    det = norm_text(det_name)
    if not det:
        return "none"

    if det in target_aliases:
        return "exact"

    for alias in target_aliases:
        if not alias:
            continue
        if alias in det or det in alias:
            return "synonym"

    return "none"


def unique_visible_names(detections: List[Dict[str, Any]]) -> List[str]:
    seen = set()
    out = []
    for det in detections:
        name = det["name"]
        key = norm_text(name)
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out[:YOLO_MAX_OBJECTS]


def get_model_name(cls_id: int) -> str:
    names = _model.names
    if isinstance(names, dict):
        return str(names.get(cls_id, f"class_{cls_id}"))
    if isinstance(names, list) and 0 <= cls_id < len(names):
        return str(names[cls_id])
    return f"class_{cls_id}"


@app.get("/health")
@app.get("/cvapi/health")
def health() -> Any:
    return jsonify(
        {
            "ok": True,
            "model": str(_model_path),
            "confThreshold": YOLO_CONF_THRESHOLD,
            "targetMatchThreshold": YOLO_TARGET_MATCH_THRESHOLD,
            "maxObjects": YOLO_MAX_OBJECTS,
        }
    )


@app.post("/detect")
@app.post("/cvapi/detect")
def detect() -> Any:
    payload = request.get_json(silent=True) or {}
    image_base64 = payload.get("imageBase64")
    target_object = payload.get("targetObject", "")

    if not image_base64 or not target_object:
        return jsonify({"error": "imageBase64 and targetObject required"}), 400

    try:
        image = decode_base64_image(image_base64)
        h, w = image.shape[:2]

        with _model_lock:
            results = _model.predict(
                source=image,
                conf=YOLO_CONF_THRESHOLD,
                imgsz=YOLO_IMAGE_SIZE,
                verbose=False,
            )

        detections: List[Dict[str, Any]] = []
        if results:
            boxes = results[0].boxes
            if boxes is not None:
                for box in boxes:
                    cls_id = int(box.cls[0].item())
                    conf = float(box.conf[0].item())
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    bbox = normalize_bbox_xyxy(x1, y1, x2, y2, w, h)
                    if not bbox:
                        continue

                    detections.append(
                        {
                            "name": get_model_name(cls_id),
                            "confidence": conf,
                            "boundingBox": bbox,
                        }
                    )

        detections.sort(key=lambda d: d["confidence"], reverse=True)
        detections = detections[: YOLO_MAX_OBJECTS * 2]

        target_aliases = build_target_aliases(target_object)

        best_match: Optional[Dict[str, Any]] = None
        best_match_type = "none"
        for det in detections:
            match_type = is_target_match(det["name"], target_aliases)
            if match_type == "none":
                continue
            if best_match is None or det["confidence"] > best_match["confidence"]:
                best_match = det
                best_match_type = match_type

        model_found = best_match is not None
        confidence = float(best_match["confidence"]) if best_match else 0.0
        found = model_found and confidence >= YOLO_TARGET_MATCH_THRESHOLD

        visible_detections = detections[:YOLO_MAX_OBJECTS]
        visible_objects = unique_visible_names(visible_detections)

        response = {
            "found": found,
            "modelFound": model_found,
            "confidence": confidence,
            "matchType": best_match_type,
            "detectedObject": best_match["name"] if best_match else "",
            "targetBoundingBox": best_match["boundingBox"] if best_match else None,
            "evidence": (
                f'Detected target-like object "{best_match["name"]}" with confidence {confidence:.2f}'
                if best_match
                else "Target-like object not detected by YOLO"
            ),
            "visibleObjects": visible_objects,
            "visibleObjectDetections": visible_detections,
            "modelUsed": f"yolo:{_model_path}",
            "fallbackSceneUsed": False,
        }

        return jsonify(response)
    except Exception as err:
        return jsonify({"error": str(err)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=CV_SERVER_PORT, debug=False)
