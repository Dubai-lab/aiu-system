import { useState, type FormEvent } from 'react';
import { KeyRound, ScanFace } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { FaceLoginPanel } from '@/features/face/FaceLoginPanel';
import AuthLayout from '@/layouts/AuthLayout';
import { ApiError } from '@/lib/api';

type Tab = 'password' | 'face';

/** Staff type an email; students type a registration number (upper-cased and trimmed). */
export function normaliseIdentifier(raw: string): string {
  const value = raw.trim();
  return value.includes('@') ? value.toLowerCase() : value.toUpperCase();
}

function PasswordLoginForm() {
  const { signInWithPassword } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      setError('Enter your registration number or email, and your password.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signInWithPassword(normaliseIdentifier(identifier), password);
      // GuestRoute redirects to the dashboard once the profile has loaded.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <TextField
        label="Registration number or email"
        placeholder="AIU-2026-0001 or name@aiu.edu"
        autoComplete="username"
        autoFocus
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" loading={submitting} className="w-full">
        Log in
      </Button>
      <p className="text-center text-xs text-slate-500">
        Forgot your password? Ask the administrator to reset it.
      </p>
    </form>
  );
}

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>('password');

  const tabClass = (t: Tab) =>
    `flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      tab === t ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
    }`;

  return (
    <AuthLayout>
      <div className="mb-8 lg:hidden">
        <span className="flex size-12 items-center justify-center rounded-xl bg-brand-700 font-bold text-accent-400">AIU</span>
      </div>
      <h2 className="text-2xl font-semibold text-slate-900">Welcome back</h2>
      <p className="mt-1 text-sm text-slate-500">Log in to the AIU Management System.</p>

      <div role="tablist" aria-label="Login method" className="mt-6 flex gap-1 rounded-lg bg-slate-100 p-1">
        <button type="button" role="tab" aria-selected={tab === 'password'} className={tabClass('password')} onClick={() => setTab('password')}>
          <KeyRound className="size-4" aria-hidden /> Password
        </button>
        <button type="button" role="tab" aria-selected={tab === 'face'} className={tabClass('face')} onClick={() => setTab('face')}>
          <ScanFace className="size-4" aria-hidden /> Face ID
        </button>
      </div>

      <div role="tabpanel" className="mt-6">
        {tab === 'password' ? (
          <PasswordLoginForm />
        ) : (
          <FaceLoginPanel />
        )}
      </div>
    </AuthLayout>
  );
}
