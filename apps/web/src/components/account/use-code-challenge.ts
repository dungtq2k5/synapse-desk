'use client';

import {
  ApiError,
  type OtpStatusResponseDto,
  type RequestOtpResponseDto,
  type VerifyOtpResponseDto,
} from '@synapsedesk/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RESEND_WAIT_SECONDS } from '@/lib/codes';
import { announce } from '@/lib/toast';

/** The code that's out: where it went, how long it lasts, its digits. */
export type Challenge = {
  target: string;
  expiresInMinutes: number;
  codeLength: number;
};

/** Why the code field can't take the code as it stands. */
export type CodeProblem =
  | { kind: 'wrong'; attemptsRemaining: number }
  /** The fifth wrong code: a 429 without `Retry-After`. Request a new one. */
  | { kind: 'out-of-attempts' }
  /** No code is pending any more (expired, or used up). */
  | { kind: 'expired' }
  /** Checking is paused for a while: a 429 with `Retry-After`. */
  | { kind: 'paused'; seconds: number | null }
  | { kind: 'failed'; message: string };

/**
 * One emailed or texted code, from sending to verified: the status first (a
 * code already out is used as it is), a new code when none is, a 60-second
 * wait before another, and every answer the check can give.
 *
 * A request refused for too many requests (429 with `Retry-After`) keeps the
 * last code usable and makes the resend wait follow the server's.
 */
export function useCodeChallenge({
  status,
  request,
  verify,
  onVerified,
}: {
  /** `GET /auth/otp/status` for this purpose, or null to send a code at once. */
  status: (() => Promise<OtpStatusResponseDto | undefined>) | null;
  request: () => Promise<RequestOtpResponseDto | undefined>;
  verify: (code: string) => Promise<VerifyOtpResponseDto | undefined>;
  onVerified?: () => void;
}) {
  const [phase, setPhase] = useState<
    'loading' | 'sending' | 'ready' | 'verifying' | 'verified'
  >('loading');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<CodeProblem | null>(null);
  /** A 429 on requesting a code: minutes until another is allowed. */
  const [limited, setLimited] = useState<{ seconds: number } | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);

  const send = useCallback(async () => {
    setPhase('sending');
    setProblem(null);
    setCode('');
    try {
      const sent = await request();
      if (sent) {
        setChallenge({
          target: sent.target,
          expiresInMinutes: sent.expiresInMinutes,
          codeLength: sent.codeLength,
        });
      }
      setLimited(null);
      setNow(Date.now());
      setResendAt(Date.now() + RESEND_WAIT_SECONDS * 1000);
      announce('Code sent.');
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 429) {
        const seconds = failure.retryAfterSeconds ?? RESEND_WAIT_SECONDS;
        setLimited({ seconds });
        setNow(Date.now());
        setResendAt(Date.now() + seconds * 1000);
      } else {
        setProblem({
          kind: 'failed',
          message:
            failure instanceof Error
              ? failure.message
              : 'Check your connection and try again.',
        });
      }
    }
    setPhase('ready');
  }, [request]);

  // On opening: the code already out, or a new one.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const pending = status ? await status().catch(() => undefined) : null;
      if (pending?.pending && pending.target && pending.expiresAt) {
        setChallenge({
          target: pending.target,
          expiresInMinutes: Math.max(
            1,
            Math.ceil((Date.parse(pending.expiresAt) - Date.now()) / 60_000),
          ),
          codeLength: pending.codeLength,
        });
        setPhase('ready');
      } else {
        await send();
      }
    })();
  }, [status, send]);

  // The resend countdown, announced once when it's over.
  const waiting = resendAt > now;
  useEffect(() => {
    if (!waiting) return;
    const timer = globalThis.setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (next >= resendAt) announce('You can resend the code now.');
    }, 1000);
    return () => globalThis.clearInterval(timer);
  }, [waiting, resendAt]);

  const check = async (value: string) => {
    if (phase === 'verifying') return;
    setPhase('verifying');
    setProblem(null);
    try {
      const answer = await verify(value);
      if (answer?.verified) {
        setPhase('verified');
        onVerified?.();
        return;
      }
      setProblem({
        kind: 'wrong',
        attemptsRemaining: answer?.attemptsRemaining ?? 0,
      });
      // Cleared, so the next try is typed from slot 1, where focus goes.
      setCode('');
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 429) {
        setProblem(
          failure.retryAfterSeconds === null
            ? { kind: 'out-of-attempts' }
            : { kind: 'paused', seconds: failure.retryAfterSeconds },
        );
      } else if (failure instanceof ApiError && failure.status < 500) {
        setProblem({ kind: 'expired' });
      } else {
        setProblem({
          kind: 'failed',
          message:
            failure instanceof Error
              ? failure.message
              : 'Check your connection and try again.',
        });
      }
    }
    setPhase('ready');
  };

  return {
    phase,
    challenge,
    code,
    setCode,
    problem,
    /** The slots can't take a code: request a new one instead. */
    spent: problem?.kind === 'out-of-attempts' || problem?.kind === 'expired',
    limited,
    resendIn: waiting ? (resendAt - now) / 1000 : 0,
    send,
    check,
  };
}
