/** Face ID tab of the login page (spec 8.3): liveness challenge -> 2 photos -> session. */
import { useRef } from 'react';
import { useAuth } from '@/auth/useAuth';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { FaceCapture, type CaptureStep, type CapturedFrame } from './FaceCapture';

interface Challenge {
  challenge_id: string;
  steps: string[];
  expires_in: number;
}

const INSTRUCTIONS: Record<string, string> = {
  center: 'Look straight at the camera',
  turn_left: 'Turn your head to the LEFT',
  turn_right: 'Turn your head to the RIGHT',
};

// Shown before the first challenge arrives (two progress dots).
const PLACEHOLDER_STEPS: CaptureStep[] = [
  { key: 'center', instruction: INSTRUCTIONS.center },
  { key: 'turn', instruction: 'Turn your head' },
];

export function FaceLoginPanel() {
  const { signInWithFaceToken } = useAuth();
  const challengeId = useRef<string | null>(null);

  // A fresh single-use challenge each time capture starts (incl. "Try again").
  const prepare = async (): Promise<CaptureStep[]> => {
    const challenge = await api.post<Challenge>('/auth/face/challenge');
    challengeId.current = challenge.challenge_id;
    return challenge.steps.map((key) => ({ key, instruction: INSTRUCTIONS[key] ?? key }));
  };

  const onComplete = async (frames: CapturedFrame[]) => {
    const result = await api.post<{ token_hash: string; profile: Omit<Me, 'force_password_change'> }>(
      '/auth/face/login',
      { challenge_id: challengeId.current, frames },
    );
    await signInWithFaceToken(result.token_hash);
    // GuestRoute sends the user to their dashboard once the profile has loaded.
  };

  return (
    <div className="space-y-3">
      <FaceCapture mode="login" steps={PLACEHOLDER_STEPS} prepare={prepare} onComplete={onComplete} startLabel="Log in with Face ID" />
      <p className="text-center text-xs text-slate-500">
        Your face is compared with enrolled users. No photo is stored.
      </p>
    </div>
  );
}
