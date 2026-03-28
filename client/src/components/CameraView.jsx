import { useEffect, useRef, forwardRef } from 'react';

// CameraView: fullscreen video feed optimised for mobile (back camera preferred)
const CameraView = forwardRef(function CameraView({ onReady, onError }, ref) {
  const localRef = useRef(null);
  const videoRef = ref || localRef;

  useEffect(() => {
    let stream = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' }, // back camera on mobile
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();
            onReady?.();
          };
        }
      } catch (err) {
        onError?.(err);
      }
    }

    startCamera();

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
