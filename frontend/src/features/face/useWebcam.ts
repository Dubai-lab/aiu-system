/**
 * Webcam access via getUserMedia (works on localhost and HTTPS only).
 * The camera is ALWAYS stopped when the component using this hook unmounts,
 * or when stop() is called.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type WebcamStatus = 'idle' | 'starting' | 'ready' | 'error';

function describe(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (!window.isSecureContext) return 'The camera only works on localhost or a secure (https) address.';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera access was blocked. Allow the camera in your browser (address bar icon) and try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another application. Close it and try again.';
  return 'The camera could not be started. Please try again.';
}

export function useWebcam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Every start()/stop() bumps the generation. A camera request that resolves after
  // it was superseded (double start, stop, unmount) stops its own stream at once,
  // so a slow permission prompt can never leave the camera running.
  const generation = useRef(0);
  const [status, setStatus] = useState<WebcamStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    generation.current += 1;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    const myGeneration = ++generation.current;
    setStatus('starting');
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('unsupported', 'NotSupportedError');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (myGeneration !== generation.current) {
        stream.getTracks().forEach((t) => t.stop()); // superseded while waiting
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setStatus('ready');
    } catch (err) {
      if (myGeneration !== generation.current) return;
      setError(describe(err));
      setStatus('error');
    }
  }, []);

  // Release the camera when leaving the page.
  useEffect(() => stop, [stop]);

  /** Grab the current frame UN-mirrored (so yaw direction is correct), 640 px wide JPEG. */
  const capture = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const width = 640;
    const height = Math.round((video.videoHeight / video.videoWidth) * width);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }, []);

  return { videoRef, status, error, start, stop, capture };
}
