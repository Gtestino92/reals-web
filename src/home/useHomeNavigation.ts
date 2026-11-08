import { useLayoutEffect, useRef, useState } from 'react';
import type { QuestionContext } from '../profile/affinities/presentation';
import { object } from '../auth/api';

const destinations = ['home', 'activity', 'profile', 'preferences', 'affinities', 'account', 'notifications', 'affinity-categories', 'affinity-review', 'affinity-question'] as const;
export type HomeDestination = typeof destinations[number];
interface Entry { owner: string; trail: HomeDestination[]; question?: QuestionContext }
function destination(value: unknown): value is HomeDestination {
  return destinations.some(item => item === value);
}
function entry(value: unknown): Entry | null {
  if (!object(value) || typeof value.owner !== 'string' || !Array.isArray(value.trail) || !value.trail.length || value.trail[0] !== 'home' || !value.trail.every(destination)) return null;
  const q = value.question;
  if (q !== undefined && (!object(q) || typeof q.questionId !== 'string' || !['continue', 'category', 'review'].includes(String(q.source)) || typeof q.categoryId !== 'string' || typeof q.reviewAll !== 'boolean')) return null;
  return { owner: value.owner, trail: value.trail, ...(q === undefined ? {} : { question: { questionId: String(q.questionId), source: q.source === 'category' ? 'category' : q.source === 'review' ? 'review' : 'continue', categoryId: String(q.categoryId), reviewAll: q.reviewAll === true } }) };
}

// One authenticated Home owns its same-document entries, including nested Account.
export function useHomeNavigation(canLeave: () => boolean) {
  const [initial] = useState<Entry>(() => ({ owner: crypto.randomUUID(), trail: ['home'] }));
  const [state, setState] = useState(initial);
  const current = useRef(initial), guard = useRef(canLeave), moving = useRef(false);
  guard.current = canLeave;
  useLayoutEffect(() => {
    window.history.replaceState(current.current, '');
    const pop = (event: PopStateEvent) => {
      const previous = current.current, incoming = entry(event.state);
      moving.current = false;
      if (incoming?.owner === previous.owner) {
        if (!guard.current() && incoming.trail.length !== previous.trail.length) {
          moving.current = true;
          window.history.go(previous.trail.length - incoming.trail.length);
          return;
        }
        current.current = incoming; setState(incoming);
      } else {
        // A stale identity's entry cannot restore its screens into this account.
        const next: Entry = guard.current() ? { owner: previous.owner, trail: ['home'] } : previous;
        window.history.replaceState(next, ''); current.current = next; setState(next);
      }
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const open = (next: HomeDestination, question?: QuestionContext, replace = false) => {
    if (moving.current || !guard.current() || (current.current.trail.at(-1) === next && !replace)) return;
    const value: Entry = { owner: initial.owner, trail: replace ? [...current.current.trail.slice(0, -1), next] : [...current.current.trail, next], ...(question ? { question } : {}) };
    if (replace) window.history.replaceState(value, ''); else window.history.pushState(value, ''); current.current = value; setState(value);
  };
  const backTo = (target: HomeDestination) => {
    if (moving.current || !guard.current()) return;
    const value = current.current, index = value.trail.lastIndexOf(target);
    const installed = entry(window.history.state);
    if (index >= 0 && index < value.trail.length - 1 && installed?.owner === value.owner) {
      moving.current = true; window.history.go(index - value.trail.length + 1);
    } else if (value.trail.at(-1) !== target) {
      const next: Entry = { owner: value.owner, trail: target === 'home' ? ['home'] : ['home', target] };
      window.history.replaceState(next, ''); current.current = next; setState(next);
    }
  };
  return { destination: state.trail.at(-1) ?? 'home', question: state.question, open, backTo };
}
