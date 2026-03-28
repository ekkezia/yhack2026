import { useRef, useCallback } from 'react';

const SAMPLE_WIDTH = 80;    // downscale resolution for perf
const SAMPLE_HEIGHT = 60;
const MOTION_THRESHOLD = 18; // per-channel mean diff to classify as moving
const STILL_DURATION_MS = 3000;

/*
  useMotionDetection
  ──────────────────
  Runs a lightweight pixel-diff motion detector on a <video> element.

  Callbacks:
    onMotion()   — fires every tick while motion is detected
    onStill()    — fires once after STILL_DURATION_MS of no motion
    onCalmTick({ stillMs }) — fires every tick while calm (useful for progress rings)
*/
export function useMotionDetection({ onMotion, onStill, onCalmTick }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const prevDataRef = useRef(null);
  const stillSinceRef = useRef(null);
  const triggeredRef = useRef(false); // prevent onStill firing repeatedly
  const timerRef = useRef(null);

  function getCanvas() {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = SAMPLE_WIDTH;
      canvasRef.current.height = SAMPLE_HEIGHT;
      ctxRef.current = canvasRef.current.getContext('2d', { willReadFrequently: true });
    }
    return { canvas: canvasRef.current, ctx: ctxRef.current };
  }

  const analyze = useCallback(
    (videoEl) => {
      const { ctx } = getCanvas();
      ctx.drawImage(videoEl, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      const { data } = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);

      let diff = 0;
      if (prevDataRef.current) {
        const len = data.length;
        for (let i = 0; i < len; i += 4) {
          diff += Math.abs(data[i]     - prevDataRef.current[i]);
          diff += Math.abs(data[i + 1] - prevDataRef.current[i + 1]);
          diff += Math.abs(data[i + 2] - prevDataRef.current[i + 2]);
        }
        diff /= (len / 4) * 3;
      }

      prevDataRef.current = new Uint8ClampedArray(data);

      const isMoving = diff > MOTION_THRESHOLD;

      if (isMoving) {
        stillSinceRef.current = null;
        triggeredRef.current = false;
        onMotion?.();
      } else {
        if (!stillSinceRef.current) stillSinceRef.current = Date.now();
        const stillMs = Date.now() - stillSinceRef.current;

        onCalmTick?.({ stillMs });

        if (stillMs >= STILL_DURATION_MS && !triggeredRef.current) {
          triggeredRef.current = true;
          stillSinceRef.current = null; // reset so we can fire again next time
          onStill?.();
        }
      }
    },
    [onMotion, onStill, onCalmTick]
  );

  // Capture a full-res JPEG from a video element, returns base64 string
  const captureFrame = useCallback((videoEl, quality = 0.8) => {
    const c = document.createElement('canvas');
    c.width = videoEl.videoWidth || 640;
    c.height = videoEl.videoHeight || 480;
    c.getContext('2d').drawImage(videoEl, 0, 0);
    const dataUrl = c.toDataURL('image/jpeg', quality);
    return dataUrl.split(',')[1];
  }, []);

  const startLoop = useCallback(
    (videoEl, intervalMs = 200) => {
      clearInterval(timerRef.current);
      const tick = () => {
        if (videoEl && videoEl.readyState >= 2) analyze(videoEl);
      };
      timerRef.current = setInterval(tick, intervalMs);
    },
    [analyze]
  );

  const stopLoop = useCallback(() => {
    clearInterval(timerRef.current);
    stillSinceRef.current = null;
    triggeredRef.current = false;
    prevDataRef.current = null;
  }, []);

  return { startLoop, stopLoop, captureFrame };
}
