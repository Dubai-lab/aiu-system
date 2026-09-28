/**
 * Assistant state for all logged-in layouts (spec 13.2). Lives in the layout, so
 * the conversation survives page navigation. Sends messages to the backend,
 * speaks replies, and performs the returned UI actions:
 *   navigate -> React Router navigate(path)
 *   refresh  -> invalidate TanStack Query keys so pages show new data at once.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { api, ApiError } from '@/lib/api';
import { useSpeechRecognition } from './useSpeechRecognition';
import { useSpeechSynthesis } from './useSpeechSynthesis';

export type AssistantStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
}

interface Pending {
  id: string;
  summary: string;
}

interface Reply {
  conversation_id: string;
  reply: string;
  actions: ({ type: 'navigate'; path: string } | { type: 'refresh'; keys: string[] })[];
  pending_action: Pending | null;
}

interface AssistantContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessage[];
  status: AssistantStatus;
  interim: string;
  pending: Pending | null;
  speakerOn: boolean;
  setSpeakerOn: (on: boolean) => void;
  voiceSupported: boolean;
  voiceError: string | null;
  send: (text: string) => Promise<void>;
  confirm: (decision: 'confirm' | 'cancel') => Promise<void>;
  startListening: () => void;
  stopListening: () => void;
  newConversation: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistant must be used inside <AssistantProvider>');
  return ctx;
}

const storage = {
  get(key: string) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string | null) {
    try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch { /* ignore */ }
  },
};

const newId = () => Math.random().toString(36).slice(2);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const convoKey = `aiu-assistant-conversation-${profile?.id ?? 'anon'}`;

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [speakerOn, setSpeakerOnState] = useState(() => {
    try { return localStorage.getItem('aiu-assistant-speaker') !== 'off'; } catch { return true; }
  });
  const conversationId = useRef<string | null>(storage.get(convoKey));
  const restored = useRef(false);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const tts = useSpeechSynthesis();
  const speakerRef = useRef(speakerOn);
  speakerRef.current = speakerOn;

  const setSpeakerOn = useCallback((on: boolean) => {
    setSpeakerOnState(on);
    try { localStorage.setItem('aiu-assistant-speaker', on ? 'on' : 'off'); } catch { /* ignore */ }
    if (!on) tts.cancel();
  }, [tts]);

  const applyReply = useCallback((r: Reply) => {
    conversationId.current = r.conversation_id;
    storage.set(convoKey, r.conversation_id);
    setMessages((m) => [...m, { id: newId(), role: 'assistant', text: r.reply }]);
    setPending(r.pending_action);
    for (const action of r.actions) {
      if (action.type === 'navigate') navigate(action.path);
      // Any change also affects the dashboard summary and the audit log.
      if (action.type === 'refresh') [...action.keys, 'dashboard', 'audit-logs'].forEach((key) => void qc.invalidateQueries({ queryKey: [key] }));
    }
    if (speakerRef.current) tts.speak(r.reply);
  }, [convoKey, navigate, qc, tts]);

  const fail = useCallback((err: unknown) => {
    const text = err instanceof ApiError ? err.message : 'Sorry, the assistant is unavailable right now - you can still use the menus.';
    setMessages((m) => [...m, { id: newId(), role: 'assistant', text, error: true }]);
    if (speakerRef.current) tts.speak(text);
  }, [tts]);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || thinking) return;
    tts.cancel();
    setMessages((m) => [...m, { id: newId(), role: 'user', text }]);
    setThinking(true);
    try {
      applyReply(await api.post<Reply>('/assistant/message', {
        conversation_id: conversationId.current, message: text, current_path: pathRef.current,
      }));
    } catch (err) {
      fail(err);
    } finally {
      setThinking(false);
    }
  }, [applyReply, fail, thinking, tts]);

  const confirm = useCallback(async (decision: 'confirm' | 'cancel') => {
    if (!pending || thinking) return;
    tts.cancel();
    const current = pending;
    setPending(null);
    setMessages((m) => [...m, { id: newId(), role: 'user', text: decision === 'confirm' ? 'Confirm' : 'Cancel' }]);
    setThinking(true);
    try {
      applyReply(await api.post<Reply>('/assistant/confirm', {
        pending_action_id: current.id, decision, current_path: pathRef.current,
      }));
    } catch (err) {
      fail(err);
    } finally {
      setThinking(false);
    }
  }, [applyReply, fail, pending, thinking, tts]);

  const stt = useSpeechRecognition((said) => void send(said));

  const startListening = useCallback(() => {
    tts.cancel(); // tapping the mic while it speaks stops speech and starts listening
    stt.start();
  }, [stt, tts]);

  const newConversation = useCallback(() => {
    tts.cancel();
    stt.abort();
    conversationId.current = null;
    storage.set(convoKey, null);
    setMessages([]);
    setPending(null);
  }, [convoKey, stt, tts]);

  // Restore the current conversation's visible messages the first time the panel opens.
  useEffect(() => {
    if (!open || restored.current) return;
    restored.current = true;
    const id = conversationId.current;
    if (!id) return;
    api.get<{ role: 'user' | 'assistant'; text: string }[]>(`/assistant/conversations/${id}`)
      .then((rows) => setMessages(rows.map((r) => ({ id: newId(), role: r.role, text: r.text }))))
      .catch(() => { conversationId.current = null; storage.set(convoKey, null); });
  }, [open, convoKey]);

  // Stop talking and listening when the panel closes.
  const { cancel: cancelSpeech } = tts;
  const { abort: abortListening } = stt;
  useEffect(() => {
    if (!open) {
      cancelSpeech();
      abortListening();
    }
  }, [open, cancelSpeech, abortListening]);

  const status: AssistantStatus = stt.listening ? 'listening' : thinking ? 'thinking' : tts.speaking ? 'speaking' : 'idle';

  const value = useMemo<AssistantContextValue>(() => ({
    open, setOpen, messages, status, interim: stt.interim, pending, speakerOn, setSpeakerOn,
    voiceSupported: stt.supported, voiceError: stt.error,
    send, confirm, startListening, stopListening: stt.stop, newConversation,
  }), [open, messages, status, stt.interim, stt.supported, stt.error, stt.stop, pending, speakerOn, setSpeakerOn,
    send, confirm, startListening, newConversation]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
