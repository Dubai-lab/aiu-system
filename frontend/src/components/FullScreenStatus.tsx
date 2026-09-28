import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';

export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <Loader2 className="size-8 animate-spin text-brand-700" aria-hidden />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

export function FullScreenError({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut?: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div role="alert" className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <AlertTriangle className="mx-auto size-8 text-amber-500" aria-hidden />
        <p className="mt-3 font-medium text-slate-900">We couldn't load your account</p>
        <p className="mt-1 text-sm text-slate-500">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={onRetry}>Try again</Button>
          {onSignOut && (
            <Button variant="secondary" onClick={onSignOut}>
              Log out
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
