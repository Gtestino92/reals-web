import { useEffect, useRef, useState } from 'react';

export function ReactionLane({ confirmed, eligible, disabled, react }: {
  confirmed: boolean; eligible: boolean; disabled: boolean; react: () => Promise<void> | undefined;
}) {
  const [pending, setPending] = useState(false);
  const flight = useRef(false), lifetime = useRef(0);
  useEffect(() => { lifetime.current++; return () => { lifetime.current++; }; }, []);
  return <div className="chat-reaction-lane">
    {confirmed ? <span className="chat-given-heart" role="img" aria-label="Reaccionaste con corazón">♥</span> : eligible &&
      <button className="chat-heart" aria-label={pending ? 'Guardando corazón' : 'Reaccionar con corazón'} aria-busy={pending} disabled={disabled || pending} onClick={() => {
        if (flight.current) return;
        flight.current = true; setPending(true);
        const generation = lifetime.current;
        // ChatSession owns failures and reconciliation; this state only locks the control.
        void (async () => { try { await react(); } finally {
          if (generation === lifetime.current) { flight.current = false; setPending(false); }
        } })();
      }}>♡</button>}
  </div>;
}
