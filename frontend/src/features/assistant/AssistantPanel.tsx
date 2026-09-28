/**
 * Floating mic button (bottom-right, every page) + assistant side panel (spec 13.2).
 * - Conversation bubbles, big mic, text input + Send, speaker toggle, New conversation.
 * - States: idle, listening (pulsing mic + live transcript), thinking (typing dots),
 *   speaking (animated wave; tapping the mic stops speech and starts listening).
 * - Confirmation card with Confirm / Cancel when an action needs approval.
 * - Keyboard: Ctrl+K opens/closes; hold Space (panel open, no input focused) to talk; Esc closes.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, Mic, MicOff, Plus, Send, ShieldQuestion, Square, Volume2, VolumeX, X } from 'lucide-react';
import { useAssistant } from './AssistantProvider';

function Dots() {
  return (
    <span className="inline-flex gap-1" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

function Wave() {
  return (
    <span className="inline-flex h-4 items-end gap-0.5" aria-hidden>
      {[0, 120, 240, 360, 480].map((d) => (
        <span key={d} className="w-1 animate-pulse rounded-full bg-brand-500" style={{ height: `${40 + ((d / 120) % 3) * 30}%`, animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

const isTyping = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.tagName === 'BUTTON' ||
    (el as HTMLElement).isContentEditable);

export function AssistantPanel() {
  const a = useAssistant();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const spaceHeld = useRef(false);
  const { open, setOpen, startListening, stopListening, voiceSupported } = a;

  // Ctrl+K toggles the panel; Esc closes it; hold Space to talk.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') setOpen(false);
      if (e.code === 'Space' && !e.repeat && voiceSupported && !isTyping(document.activeElement)) {
        e.preventDefault();
        spaceHeld.current = true;
        startListening();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spaceHeld.current) {
        spaceHeld.current = false;
        stopListening();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [open, setOpen, startListening, stopListening, voiceSupported]);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [a.messages, a.status, a.pending]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    void a.send(draft);
    setDraft('');
  };

  const micClick = () => (a.status === 'listening' ? a.stopListening() : a.startListening());

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex size-14 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg ring-4 ring-white transition hover:scale-105 hover:bg-brand-800 print:hidden"
        aria-label="Open the AIU Assistant (Ctrl+K)"
        title="AIU Assistant (Ctrl+K)"
      >
        <Mic className="size-6" aria-hidden />
      </button>
    );
  }

  const busy = a.status === 'thinking';
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="AIU Assistant"
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl ring-1 ring-slate-200 sm:w-[420px] print:hidden"
    >
      <header className="flex items-center gap-2 border-b border-slate-200 bg-brand-700 px-4 py-3 text-white">
        <Bot className="size-5 text-accent-400" aria-hidden />
        <h2 className="flex-1 font-semibold">AIU Assistant</h2>
        <button type="button" onClick={() => a.setSpeakerOn(!a.speakerOn)} className="rounded-md p-2 hover:bg-white/10"
          aria-label={a.speakerOn ? 'Turn voice replies off' : 'Turn voice replies on'} aria-pressed={a.speakerOn}>
          {a.speakerOn ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
        </button>
        <button type="button" onClick={a.newConversation} className="rounded-md p-2 hover:bg-white/10" aria-label="New conversation" title="New conversation">
          <Plus className="size-5" aria-hidden />
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 hover:bg-white/10" aria-label="Close assistant">
          <X className="size-5" aria-hidden />
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4" aria-live="polite">
        {a.messages.length === 0 && (
          <div className="rounded-xl bg-white p-4 text-sm text-slate-600 ring-1 ring-slate-200">
            <p className="font-medium text-slate-900">Hi! Ask me anything you'd do in this system.</p>
            <p className="mt-2">For example: "Open my invoices", "What can you do?"</p>
            <p className="mt-2 text-xs text-slate-500">Tip: hold Space to talk, or press Ctrl+K to open and close me.</p>
          </div>
        )}
        {a.messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
              m.role === 'user' ? 'rounded-br-md bg-brand-700 text-white'
                : m.error ? 'rounded-bl-md bg-red-50 text-red-800 ring-1 ring-red-200' : 'rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200'}`}>
              {m.text}
            </p>
          </div>
        ))}
        {a.status === 'listening' && (
          <div className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-br-md border border-dashed border-brand-500 px-4 py-2.5 text-sm italic text-slate-600">
              {a.interim || 'Listening…'}
            </p>
          </div>
        )}
        {busy && (
          <div className="flex justify-start" role="status" aria-label="Assistant is thinking">
            <span className="rounded-2xl rounded-bl-md bg-white px-4 py-3 ring-1 ring-slate-200"><Dots /></span>
          </div>
        )}
        {a.pending && !busy && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4" role="alertdialog" aria-label="Confirm action">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <ShieldQuestion className="size-4" aria-hidden /> Please confirm
            </p>
            <p className="mt-1 text-sm text-amber-900">{a.pending.summary}</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => void a.confirm('confirm')} className="flex-1 rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800">
                Confirm
              </button>
              <button type="button" onClick={() => void a.confirm('cancel')} className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
                Cancel
              </button>
            </div>
            <p className="mt-2 text-xs text-amber-800">You can also just say "yes" or "no".</p>
          </div>
        )}
      </div>

      <footer className="border-t border-slate-200 bg-white p-4">
        {!a.voiceSupported && (
          <p className="mb-3 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
            <MicOff className="size-4 shrink-0" aria-hidden /> Voice input works in Chrome or Edge - you can type instead.
          </p>
        )}
        {a.voiceError && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{a.voiceError}</p>}
        <div className="mb-3 flex items-center justify-center gap-3 text-sm text-slate-500" aria-live="polite">
          {a.status === 'listening' && <span className="font-medium text-brand-700">Listening…</span>}
          {a.status === 'thinking' && <span>Thinking…</span>}
          {a.status === 'speaking' && <span className="flex items-center gap-2 text-brand-700"><Wave /> Speaking - tap the mic to interrupt</span>}
          {a.status === 'idle' && a.voiceSupported && <span>Tap the mic or hold Space to talk</span>}
        </div>
        <div className="flex items-center gap-3">
          {a.voiceSupported && (
            <button
              type="button"
              onClick={micClick}
              disabled={busy}
              className={`relative flex size-14 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-50 ${
                a.status === 'listening' ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-700 hover:bg-brand-800'}`}
              aria-label={a.status === 'listening' ? 'Stop listening' : 'Start talking'}
            >
              {a.status === 'listening' && <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-40" aria-hidden />}
              {a.status === 'listening' ? <Square className="relative size-5" aria-hidden /> : <Mic className="relative size-6" aria-hidden />}
            </button>
          )}
          <form onSubmit={submit} className="flex flex-1 items-center gap-2">
            <label htmlFor="assistant-input" className="sr-only">Message the assistant</label>
            <input
              id="assistant-input"
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message…"
              autoComplete="off"
              maxLength={2000}
              className="min-w-0 flex-1 rounded-full border border-slate-300 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <button type="submit" disabled={busy || !draft.trim()} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-40" aria-label="Send">
              <Send className="size-4" aria-hidden />
            </button>
          </form>
        </div>
      </footer>
    </aside>
  );
}
