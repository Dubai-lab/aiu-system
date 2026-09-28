import { Link } from 'react-router-dom';
import { ShieldX } from 'lucide-react';

export default function NotAuthorisedPage() {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <ShieldX className="mx-auto size-12 text-red-500" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Not authorised</h1>
        <p className="mt-2 text-sm text-slate-500">Your account does not have access to this page.</p>
        <Link to="/" className="mt-6 inline-block rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800">
          Go to my dashboard
        </Link>
      </div>
    </div>
  );
}
