/** Browser text-to-speech (speechSynthesis) with a preferred English voice (spec 13.2). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toSpeakable } from './speakable';

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  // Natural/online voices sound far better where available (Edge "Natural", Chrome "Google").
  return (
    english.find((v) => /natural/i.test(v.name)) ??
    english.find((v) => /google/i.test(v.name) && /us|uk|english/i.test(v.name)) ??
    english.find((v) => v.lang === 'en-US') ??
    english[0] ??
    null
  );
}

export function useSpeechSynthesis() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      voiceRef.current = pickVoice();
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load);
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback((text: string) => {
    if (!supported || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(toSpeakable(text));
    utterance.lang = 'en-US';
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = 1.02;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [supported]);

  return { supported, speaking, speak, cancel };
}
