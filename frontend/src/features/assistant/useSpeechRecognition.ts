/**
 * Browser speech-to-text (Web Speech API), spec 13.2:
 * window.SpeechRecognition || window.webkitSpeechRecognition, lang en-US,
 * interimResults true, continuous false; the final result is delivered once.
 * Best in Chrome and Edge; `supported` is false elsewhere (e.g. Firefox).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal typings - the Web Speech API is not in TypeScript's DOM library.
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow the microphone in your browser and try again.',
  'service-not-allowed': 'Microphone access was blocked. Allow the microphone in your browser and try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs an internet connection.',
};

export function useSpeechRecognition(onFinal: (text: string) => void) {
  const supported = typeof window !== 'undefined' && getCtor() !== null;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef('');
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    finalRef.current = '';
    rec.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else text += r[0].transcript;
      }
      setInterim(finalRef.current + text);
    };
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') setError(ERRORS[e.error] ?? 'Speech recognition failed. You can type instead.');
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim('');
      const said = finalRef.current.trim();
      finalRef.current = '';
      if (said) onFinalRef.current(said); // send automatically on the final result
    };
    recRef.current = rec;
    setError(null);
    setInterim('');
    setListening(true);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
    }
  }, []);

  /** Stop listening and deliver what was heard (push-to-talk release). */
  const stop = useCallback(() => recRef.current?.stop(), []);

  /** Stop without delivering anything. */
  const abort = useCallback(() => {
    finalRef.current = '';
    recRef.current?.abort();
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, error, start, stop, abort };
}
