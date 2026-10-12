import React, { useState } from 'react';
import { XMarkIcon, EnvelopeIcon } from '@heroicons/react/24/outline';

interface AuthModalProps {
  onClose: () => void;
  signInWithMagicLink: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
}

/** Google's brandmark, inlined so the button works with no external requests. */
const GoogleMark: React.FC = () => (
  <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z" />
    <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.500 46 24 46z" />
    <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.5C3 17 2 20.4 2 24s1 7 2.5 9.9l7.3-5.7z" />
    <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.5 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z" />
  </svg>
);

const AuthModal: React.FC<AuthModalProps> = ({ onClose, signInWithMagicLink, signInWithGoogle }) => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    try {
      await signInWithMagicLink(email.trim());
      setStatus('sent');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  const handleGoogle = async () => {
    setGoogleBusy(true);
    setErrorMsg('');
    try {
      // On success the browser navigates away to Google, so there's nothing to
      // do here — we only land back in this handler if the redirect failed.
      await signInWithGoogle();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not start Google sign-in.');
      setStatus('error');
      setGoogleBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col ">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-base font-semibold text-slate-900">Sign In</h3>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"><XMarkIcon className="w-6 h-6" /></button>
        </div>

        {status === 'sent' ? (
          <div className="p-8 flex flex-col items-center gap-4 text-center">
            <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-100">
              <EnvelopeIcon className="w-8 h-8 text-emerald-600" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900">Check your email</p>
              <p className="text-sm text-slate-500 mt-1">We sent a sign-in link to <span className="font-bold">{email}</span>. Click it to finish signing in.</p>
            </div>
            <button onClick={onClose} className="w-full rounded-full bg-slate-900 hover:bg-slate-800 text-white py-3 text-sm font-medium transition mt-2">Close</button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-500">Sign in to share tasks, vote, join fly days and submit flights.</p>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleBusy}
              className="w-full flex items-center justify-center gap-2.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 py-3 text-sm font-medium transition"
            >
              <GoogleMark /> {googleBusy ? 'Redirecting…' : 'Continue with Google'}
            </button>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400">or use email</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                required
                placeholder="you@example.com"
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {status === 'error' && <p className="text-sm text-red-500">{errorMsg}</p>}
              <button
                type="submit"
                disabled={status === 'sending'}
                className="w-full rounded-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white py-3 text-sm font-medium transition"
              >
                {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthModal;
