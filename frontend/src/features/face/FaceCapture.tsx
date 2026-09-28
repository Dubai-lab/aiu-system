/**
 * Reusable guided face capture (spec 10.6), used for enrollment (5 steps),
 * face login and attendance (liveness steps).
 *
 * - Mirrored preview (feels natural) but frames are captured un-mirrored.
 * - Oval guide, large instruction, progress dots, 3-2-1 countdown per step.
 * - onComplete receives the frames; if it throws, the backend's message is shown
 *   with a "Try again" button that restarts the sequence.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, RotateCcw, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { useWebcam } from './useWebcam';

export interface CaptureStep {
  key: string;
  instruction: string;
}

export interface CapturedFrame {
  step: string;
  image: string; // data URL (image/jpeg)
}

type Phase = 'ready' | 'preparing' | 'countdown' | 'submitting' | 'error' | 'done';

interface FaceCaptureProps {
  mode: 'enroll' | 'login' | 'attendance';
  steps: CaptureStep[];
  /** Optional: runs when capture starts (and on every "Try again") and returns the
   *  steps to use - e.g. a fresh single-use liveness challenge from the server. */
  prepare?: () => Promise<CaptureStep[]>;
  onComplete: (frames: CapturedFrame[]) => Promise<void>;
  startLabel?: string;
  disabled?: boolean;
  /** Seconds to count down before each capture. */
  countdownSeconds?: number;
}

export function FaceCapture({ mode, steps: initialSteps, prepare, onComplete, startLabel = 'Start', disabled, countdownSeconds = 3 }: FaceCaptureProps) {
  const cam = useWebcam();
  const [phase, setPhase] = useState<Phase>('ready');
  const [steps, setSteps] = useState<CaptureStep[]>(initialSteps);
  const [stepIndex, setStepIndex] = useState(0);
  const [count, setCount] = useState(countdownSeconds);
  const [error, setError] = useState<string | null>(null);
  const frames = useRef<CapturedFrame[]>([]);
  // Latest callback in a ref, so a parent re-render can never re-trigger a capture.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const { start: startCamera, stop: stopCamera, capture } = cam;

  // Start the camera as soon as the component is shown (and not disabled).
  useEffect(() => {
    if (!disabled) void startCamera();
  }, [disabled, startCamera]);

  // Countdown -> capture -> next step.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count > 0) {
      const t = setTimeout(() => setCount((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
    const image = capture();
    if (!image) {
      setError('Could not read from the camera. Please try again.');
      setPhase('error');
      return;
    }
    frames.current.push({ step: steps[stepIndex].key, image });
    if (stepIndex + 1 < steps.length) {
      setStepIndex((i) => i + 1);
      setCount(countdownSeconds);
      return;
    }
    // All steps captured: hand over to the caller.
    setPhase('submitting');
    onCompleteRef.current(frames.current)
      .then(() => {
        setPhase('done');
        stopCamera(); // release the camera as soon as we are finished
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
        setPhase('error');
      });
  }, [phase, count, stepIndex, steps, capture, countdownSeconds, stopCamera]);

  const begin = async () => {
    frames.current = [];
    setError(null);
    setStepIndex(0);
    if (prepare) {
      setPhase('preparing');
      try {
        setSteps(await prepare());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not start the face check. Please try again.');
        setPhase('error');
        return;
      }
    }
    setCount(countdownSeconds);
    setPhase('countdown');
  };

  const current = steps[Math.min(stepIndex, steps.length - 1)];
  const cameraReady = cam.status === 'ready';

  let instruction = 'Position your face inside the oval';
  if (phase === 'preparing') instruction = 'Getting ready…';
  if (phase === 'countdown') instruction = current.instruction;
  if (phase === 'submitting') instruction = mode === 'enroll' ? 'Checking the photos…' : 'Verifying…';
  if (phase === 'done') instruction = 'Done';

  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-lg overflow-hidden rounded-2xl bg-slate-900">
        <video
          ref={cam.videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full -scale-x-100 object-cover"
          aria-label="Camera preview"
        />
        {/* Oval guide: darkened surroundings with a clear oval in the middle. */}
        {cameraReady && phase !== 'done' && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden>
            <defs>
              <mask id="oval-mask">
                <rect width="400" height="300" fill="white" />
                <ellipse cx="200" cy="145" rx="88" ry="115" fill="black" />
              </mask>
            </defs>
            <rect width="400" height="300" fill="rgba(15,23,42,0.45)" mask="url(#oval-mask)" />
            <ellipse cx="200" cy="145" rx="88" ry="115" fill="none" strokeWidth="3"
              stroke={phase === 'countdown' ? '#f2c14e' : 'rgba(255,255,255,0.8)'} strokeDasharray={phase === 'countdown' ? '0' : '8 6'} />
          </svg>
        )}
        {phase === 'countdown' && count > 0 && (
          <div className="absolute right-4 top-4 flex size-14 items-center justify-center rounded-full bg-white/90 text-2xl font-bold text-brand-700" aria-hidden>
            {count}
          </div>
        )}
        {(cam.status === 'starting' || cam.status === 'idle') && !disabled && phase !== 'done' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
            <Loader2 className="size-8 animate-spin" aria-hidden />
            <span className="text-sm">Starting camera…</span>
          </div>
        )}
        {cam.status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-slate-200">
            <VideoOff className="size-10" aria-hidden />
            <p className="text-sm">{cam.error}</p>
            <Button variant="secondary" onClick={() => void startCamera()}>Retry camera</Button>
          </div>
        )}
        {phase === 'submitting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50">
            <Loader2 className="size-10 animate-spin text-white" aria-hidden />
          </div>
        )}
        {phase === 'done' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900 text-green-400">
            <CheckCircle2 className="size-12" aria-hidden />
          </div>
        )}
      </div>

      {/* Big, live instruction for screen readers and eyes alike. */}
      <p className="text-center text-xl font-semibold text-slate-900" aria-live="assertive">
        {instruction}
      </p>

      <ol className="flex justify-center gap-2" aria-label="Progress">
        {steps.map((s, i) => {
          // After an error, 'Try again' restarts from photo 1, so no step shows as done.
          const doneStep = phase === 'done' || phase === 'submitting' || (phase === 'countdown' && i < stepIndex);
          const active = phase === 'countdown' && i === stepIndex;
          return (
            <li key={`${s.key}-${i}`} className={`size-3 rounded-full ${doneStep ? 'bg-green-500' : active ? 'bg-accent-500' : 'bg-slate-300'}`}>
              <span className="sr-only">{`Step ${i + 1}: ${s.instruction}${doneStep ? ' (done)' : ''}`}</span>
            </li>
          );
        })}
      </ol>

      {phase === 'error' && error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex justify-center">
        {phase === 'ready' && (
          <Button onClick={() => void begin()} disabled={disabled || !cameraReady} icon={<Camera className="size-4" aria-hidden />}>
            {startLabel}
          </Button>
        )}
        {phase === 'error' && (
          <Button onClick={() => void begin()} disabled={!cameraReady} icon={<RotateCcw className="size-4" aria-hidden />}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
