import { expect, it } from 'vitest';
import { parseHome } from './contracts';
import { emptyHome } from './fixtures';
import { activityPresentation } from './presentation';
import { reconcileHiddenFirstChats, visibleHome } from './hiddenFirstChats';
it('filters by match ID across chat IDs without hiding unrelated interactions or inflating summaries',()=>{
  const raw=emptyHome();raw.pendingActions=[{type:'FIRST_CHAT',matchId:'closed',chatId:'new-id'},{type:'FIRST_CHAT',matchId:'active',chatId:'other'},{type:'VISUAL_REVIEW',matchId:'visual',chatId:null}];raw.activeInteractionsSummary.activeInitialCount=3;
  const model=parseHome(raw),hidden=new Set(['closed']),projected=visibleHome(model,hidden);
  expect(projected.pendingActions.map(i=>i.matchId)).toEqual(['active','visual']);expect(projected.summary.activeInitialCount).toBe(2);expect(model.pendingActions).toHaveLength(3);
  const presentation=activityPresentation(projected);expect(presentation.priorities.map(i=>i.matchId)).toEqual(['active']);expect(presentation.groups.flatMap(g=>g.items).some(i=>i.matchId==='closed')).toBe(false);
});
it('retires suppression only after authoritative Home omits the interaction',()=>{
  const hidden=new Set(['closed']);const raw=emptyHome();raw.pendingActions=[{type:'FIRST_CHAT',matchId:'closed',chatId:'c'}];
  reconcileHiddenFirstChats(parseHome(raw),hidden);expect(hidden.has('closed')).toBe(true);
  reconcileHiddenFirstChats(parseHome(emptyHome()),hidden);expect(hidden.size).toBe(0);
});
it('does not resurrect a known-terminal match after an intervening clean Home snapshot',()=>{
  const hidden=new Set(['closed']),closed=new Set(['closed']),raw=emptyHome();
  reconcileHiddenFirstChats(parseHome(raw),hidden,closed);expect(hidden.size).toBe(0);
  raw.pendingActions=[{type:'FIRST_CHAT',matchId:'closed',chatId:'c'}];
  const stale=parseHome(raw);expect(visibleHome(stale,closed).pendingActions).toEqual([]);
  reconcileHiddenFirstChats(stale,hidden,closed);expect(hidden.has('closed')).toBe(true);
});
