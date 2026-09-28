import type { ReactNode } from 'react';

/** Public pages (login): university branding on the left, form on the right. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full">
      <div className="hidden w-1/2 flex-col justify-between bg-brand-700 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent-400 font-bold text-brand-900">AIU</span>
          <span className="text-lg font-semibold">AIU Management System</span>
        </div>
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Voice Assistance and Face ID Management System</h1>
          <p className="mt-4 max-w-md text-brand-100">
            Log in with your face, mark attendance with a quick face check, and run the system by simply asking.
          </p>
        </div>
        <p className="text-sm text-brand-100">© {new Date().getFullYear()} AIU</p>
      </div>
      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
