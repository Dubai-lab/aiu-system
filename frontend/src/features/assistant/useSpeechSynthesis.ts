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

  // iPhone/iPad (WebKit, which every iOS browser uses) only allow speech that starts
  // inside a tap. Our replies arrive later from the server, so they would be silently
  // blocked. Speaking one silent utterance during the user's first tap "unlocks"
  // speech for the rest of the visit; later replies can then be spoken normally.
  useEffect(() => {
    if (!supported) return;
    const events = ['touchend', 'click', 'keydown'] as const;
    const unlock = () => {
      const silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
      events.forEach((e) => window.removeEventListener(e, unlock, true));
    };
    events.forEach((e) => window.addEventListener(e, unlock, true));
    return () => events.forEach((e) => window.removeEventListener(e, unlock, true));
  }, [supported]);

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback((text: string) => {
    if (!supported || !text) return;
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(toSpeakable(text));
    utterance.lang = 'en-US';
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = 1.02;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    if (synth.speaking || synth.pending) {
      // Safari drops an utterance queued in the same tick as cancel(); wait a moment.
      synth.cancel();
      window.setTimeout(() => synth.speak(utterance), 80);
    } else {
      synth.speak(utterance);
    }
  }, [supported]);

  return { supported, speaking, speak, cancel };
}
