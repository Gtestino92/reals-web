import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { QuestionContext } from '../profile/affinities/presentation';
import { object } from '../auth/api';

const destinations = ['home', 'activity', 'profile', 'preferences', 'affinities', 'account', 'notifications', 'affinity-categories', 'affinity-review', 'affinity-question', 'profile-questions', 'profile-question-list', 'profile-question-editor', 'profile-question-selection', 'admin', 'visual-review', 'scheduling', 'partner-profile', 'second-chat'] as const;
export type HomeDestination = typeof destinations[number];
interface Entry { owner: string; trail: HomeDestination[]; question?: QuestionContext; profileQuestionId?: string; matchId?: string; connectionId?: string; partnerName?: string | null }
function destination(value: unknown): value is HomeDestination {
  return destinations.some(item => item === value);
}
function entry(value: unknown): Entry | null {
  if (!object(value) || typeof value.owner !== 'string' || !Array.isArray(value.trail) || !value.trail.length || value.trail[0] !== 'home' || !value.trail.every(destination)) return null;
  if (value.matchId !== undefined && (typeof value.matchId !== 'string' || !value.matchId.trim())) return null;
  if (value.trail.at(-1) === 'visual-review' && typeof value.matchId !== 'string') return null;
  if (value.trail.some(v => v === 'scheduling' || v === 'partner-profile' || v === 'second-chat') && (typeof value.connectionId !== 'string' || !value.connectionId.trim() || typeof value.matchId !== 'string')) return null;
  if (value.partnerName != null && typeof value.partnerName !== 'string') return null;
  const q = value.question;
  if (value.profileQuestionId !== undefined && typeof value.profileQuestionId !== 'string') return null;
  if (q !== undefined && (!object(q) || typeof q.questionId !== 'string' || !['continue', 'category', 'review'].includes(String(q.source)) || typeof q.categoryId !== 'string' || typeof q.reviewAll !== 'boolean')) return null;
  return { owner: value.owner, trail: value.trail, ...(typeof value.connectionId === 'string' ? { connectionId: value.connectionId, partnerName: typeof value.partnerName === 'string' ? value.partnerName : null } : {}), ...(typeof value.matchId === 'string' ? { matchId: value.matchId } : {}), ...(typeof value.profileQuestionId === 'string' ? { profileQuestionId: value.profileQuestionId } : {}), ...(q === undefined ? {} : { question: { questionId: String(q.questionId), source: q.source === 'category' ? 'category' : q.source === 'review' ? 'review' : 'continue', categoryId: String(q.categoryId), reviewAll: q.reviewAll === true } }) };
}

// One authenticated Home owns its same-document entries, including nested Account.
export function useHomeNavigation(canLeave: (target?: HomeDestination) => boolean, enabled = true) {
  const [initial] = useState<Entry>(() => ({ owner: crypto.randomUUID(), trail: window.location.pathname === '/admin' ? ['home', 'admin'] : ['home'] }));
  const [state, setState] = useState(initial);
  const current = useRef(initial), guard = useRef(canLeave), moving = useRef(false);
  guard.current = canLeave;
  const secondChat = useRef<{ canLeave: () => boolean; leave: () => void } | null>(null);
  const registerSecondChat = useCallback((policy: { canLeave: () => boolean; leave: () => void }) => {
    secondChat.current = policy;
    return () => { if (secondChat.current === policy) secondChat.current = null; };
  }, []);
  const path = (value: Entry) => value.trail.at(-1) === 'admin' ? '/admin' : '/';
  useLayoutEffect(() => {
    if (!enabled) return;
    window.history.replaceState(current.current, '', path(current.current));
    const pop = (event: PopStateEvent) => {
      const previous = current.current, incoming = entry(event.state);
      moving.current = false;
      if (previous.trail.at(-1) === 'second-chat' && incoming?.trail.at(-1) !== 'second-chat' && secondChat.current) {
        if (!secondChat.current.canLeave()) {
          const delta = previous.trail.length - (incoming?.trail.length ?? 1);
          if (incoming?.owner === previous.owner && delta) { moving.current = true; window.history.go(delta); }
          else window.history.replaceState(previous, '', path(previous));
          return;
        }
        const policy = secondChat.current; secondChat.current = null;
        const next: Entry = { owner: previous.owner, trail: ['home'] };
        window.history.replaceState(next, '', path(next)); current.current = next; setState(next); policy.leave(); return;
      }
      if (incoming?.trail.at(-1) === 'second-chat' && !secondChat.current) {
        if (!guard.current('home') && previous.trail.at(-1) !== 'home') {
          const delta = previous.trail.length - incoming.trail.length;
          if (incoming.owner === previous.owner && delta) { moving.current = true; window.history.go(delta); }
          else window.history.replaceState(previous, '', path(previous));
          return;
        }
        const next: Entry = { owner: previous.owner, trail: ['home'] };
        window.history.replaceState(next, '', path(next)); current.current = next; setState(next); return;
      }
      if (incoming?.owner === previous.owner) {
        if (!guard.current(incoming.trail.at(-1)) && incoming.trail.join('/') !== previous.trail.join('/')) {
          const delta = previous.trail.length - incoming.trail.length;
          if (delta) { moving.current = true; window.history.go(delta); }
          else window.history.replaceState(previous, '', path(previous));
          return;
        }
        current.current = incoming; setState(incoming);
      } else {
        // A stale identity's entry cannot restore its screens into this account.
        const next: Entry = guard.current() ? { owner: previous.owner, trail: ['home'] } : previous;
        window.history.replaceState(next, '', path(next)); current.current = next; setState(next);
      }
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [enabled]);
  const open = (next: HomeDestination, question?: QuestionContext, replace = false) => {
    if (moving.current || !guard.current(next) || (current.current.trail.at(-1) === next && !replace)) return;
    const value: Entry = { owner: initial.owner, trail: replace ? [...current.current.trail.slice(0, -1), next] : [...current.current.trail, next], ...(question ? { question } : {}) };
    if (replace) window.history.replaceState(value, '', path(value)); else window.history.pushState(value, '', path(value)); current.current = value; setState(value);
  };
  const backTo = (target: HomeDestination, replace = false) => {
    if (moving.current || !guard.current(target)) return;
    const value = current.current, index = value.trail.lastIndexOf(target);
    const installed = entry(window.history.state);
    if (!replace && index >= 0 && index < value.trail.length - 1 && installed?.owner === value.owner) {
      moving.current = true; window.history.go(index - value.trail.length + 1);
    } else if (value.trail.at(-1) !== target) {
      const next: Entry = { owner: value.owner, trail: target === 'home' ? ['home'] : ['home', target] };
      window.history.replaceState(next, '', path(next)); current.current = next; setState(next);
    }
  };
  const openProfileQuestion = (profileQuestionId: string) => {
    if (moving.current || !guard.current() || current.current.trail.at(-1) === 'profile-question-editor') return;
    const value: Entry = { owner: initial.owner, trail: [...current.current.trail, 'profile-question-editor'], profileQuestionId };
    window.history.pushState(value, '', path(value)); current.current = value; setState(value);
  };
  const openVisualReview = (matchId: string) => {
    if (moving.current || !matchId.trim() || !guard.current('visual-review') || current.current.trail.at(-1) === 'visual-review') return;
    const value: Entry = { owner: initial.owner, trail: [...current.current.trail, 'visual-review'], matchId };
    window.history.pushState(value, '', path(value)); current.current = value; setState(value);
  };
  const openScheduling = (connectionId: string, matchId: string, partnerName: string | null, browse = false) => {
    if (moving.current || !connectionId.trim() || !matchId.trim() || !guard.current('scheduling')) return;
    const value: Entry = { owner: initial.owner, trail: [...current.current.trail, browse ? 'partner-profile' : 'scheduling'], connectionId, matchId, partnerName };
    window.history.pushState(value, '', path(value)); current.current = value; setState(value);
  };
  const openPartnerProfile = () => {
    if (moving.current || !current.current.connectionId || !guard.current('partner-profile')) return;
    const value: Entry = { ...current.current, trail: [...current.current.trail, 'partner-profile'] };
    window.history.pushState(value, '', path(value)); current.current = value; setState(value);
  };
  const openSecondChat = (connectionId: string, matchId: string) => {
    if (moving.current || !connectionId.trim() || !matchId.trim() || !guard.current('second-chat')) return false;
    const value: Entry = { owner: initial.owner, trail: [...current.current.trail, 'second-chat'], connectionId, matchId };
    window.history.pushState(value, '', '/'); current.current = value; setState(value); return true;
  };
  const closeSecondChat = () => {
    secondChat.current = null; moving.current = false;
    const value: Entry = { owner: initial.owner, trail: ['home'] };
    window.history.replaceState(value, '', '/'); current.current = value; setState(value);
  };
  return { registerSecondChat, openSecondChat, closeSecondChat, trailIncludesScheduling: state.trail.includes('scheduling'), connectionId: state.connectionId, partnerName: state.partnerName, openScheduling, openPartnerProfile, trailIncludesActivity: state.trail.includes('activity'), matchId: state.matchId, openVisualReview, destination: state.trail.at(-1) ?? 'home', question: state.question, profileQuestionId: state.profileQuestionId, open, openProfileQuestion, backTo };
}
export type HomeNavigation = ReturnType<typeof useHomeNavigation>;
