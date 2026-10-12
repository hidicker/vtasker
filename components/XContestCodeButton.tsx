import React, { useEffect, useRef, useState } from 'react';
import { ClipboardDocumentIcon, CheckIcon, ArrowPathIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import type { XctskFile } from '../lib/xctrack';
import { getXContestCode, fingerprintFile, xcontestOpenUrl, CODE_VALID_MS, type XContestCode } from '../lib/xcontestShare';

interface XContestCodeButtonProps {
  /** Built on demand, so the code always reflects the task as it is now. */
  buildFile: () => XctskFile | null;
  /** Narrow layout for tight spaces such as beside a QR code. */
  compact?: boolean;
  /** A code already made for this exact task, e.g. stored on a fly day. */
  initial?: XContestCode | null;
  /** Fetch straight away rather than waiting for a tap. */
  autoGenerate?: boolean;
  /** Told about a fresh code and the file fingerprint it was made from, so it can be stored. */
  onGenerated?: (result: XContestCode, fingerprint: string) => void;
}

/**
 * A task as an XContest share: a short code to type into XCTrack, and a link
 * that opens the task in XCTrack directly on an Android phone.
 *
 * Only uploads when asked — a tap, or a caller that has decided the task is
 * meant to be shared (a scheduled fly day) — never just because a screen opened.
 */
const XContestCodeButton: React.FC<XContestCodeButtonProps> = ({ buildFile, compact, initial, autoGenerate, onGenerated }) => {
  const [result, setResult] = useState<XContestCode | null>(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const autoTried = useRef(false);

  // A stored code can arrive after first render (the fly day loads async).
  useEffect(() => { if (initial) setResult(initial); }, [initial?.code, initial?.hash]);

  const codeValid = !!result && Date.now() - result.savedAt < CODE_VALID_MS;

  const fetchCode = async () => {
    const file = buildFile();
    if (!file || file.turnpoints.length < 2) { setError('This task needs at least two points.'); return; }
    setLoading(true);
    setError('');
    try {
      const fresh = await getXContestCode(file);
      setResult(fresh);
      onGenerated?.(fresh, fingerprintFile(file));
    } catch (err: any) {
      setError(err?.message || 'Could not reach XContest.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!autoGenerate || autoTried.current || (result && codeValid)) return;
    autoTried.current = true;
    fetchCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, result, codeValid]);

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.code).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => window.prompt('Copy this XCTrack code:', result.code),
    );
  };

  const wrap = compact ? 'w-full flex flex-col items-center text-center mt-2' : 'flex flex-col items-start';

  return (
    <div className={`${wrap} gap-1.5`}>
      {result && (
        // The hash link never expires, so it stays useful after the code lapses.
        <a
          href={xcontestOpenUrl(result)}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-semibold transition"
        >
          <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" /> Open in XCTrack
        </a>
      )}

      {result && codeValid && (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 pl-3 pr-1 py-1">
          <span className="text-[11px] text-slate-500">or code</span>
          <span className="font-mono text-sm font-semibold tracking-widest text-slate-900">{result.code}</span>
          <button onClick={copy} title="Copy code" className="rounded-full p-1 text-slate-400 hover:text-slate-700 hover:bg-white transition">
            {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-600" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {(!result || !codeValid) && (
        <button
          onClick={fetchCode}
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-600 px-4 py-2 text-xs font-medium transition disabled:opacity-60"
        >
          {loading && <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />}
          {loading ? 'Getting code…' : result ? 'Get a new XCTrack code' : 'Get XCTrack code'}
        </button>
      )}

      {result && (
        <p className="text-[11px] text-slate-500 leading-snug">
          {codeValid
            ? 'Tap on your Android phone, or type the code into XCTrack. The code works for a month.'
            : 'Tap on your Android phone to load the task.'}
        </p>
      )}
      {error && <p className="text-[11px] text-red-600 leading-snug">{error}</p>}
    </div>
  );
};

export default XContestCodeButton;
