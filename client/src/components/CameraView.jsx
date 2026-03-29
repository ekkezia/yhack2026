import { useEffect, useRef, forwardRef } from 'react';

const CameraView = forwardRef(function CameraView({ onReady, onError, facingMode = 'environment' }, ref) {
  const localRef = useRef(null);
  const videoRef = ref || localRef;

  useEffect(() => {
    let stream = null;
    let cancelled = false;

    async function startCamera() {
      // Stop existing stream before switching
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();
            onReady?.();
          };
        }
      } catch (err) {
        if (!cancelled) onError?.(err);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <video
      ref={videoRef}
      className="camera-video"
      playsInline
      muted
      autoPlay
      aria-label="Camera feed"
    />
  );
});

export default CameraView;
