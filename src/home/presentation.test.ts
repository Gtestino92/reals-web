import { expect, it } from 'vitest';
import { parseHome } from './contracts';
import { emptyHome } from './fixtures';
import { activityPresentation } from './presentation';
it('limits advisory priority to two items without changing lifecycle or hiding activity', () => {
  const raw = emptyHome(), now = Date.parse('2026-11-05T12:00:00Z');
  raw.pendingActions = [1,2,3].map(i => ({ type: 'VISUAL_REVIEW', matchId: String(i), chatId: null, visualStartedAt: '2026-11-05T11:01:00Z', visualExpiresAt: '2026-11-05T12:01:00Z' }));
  const home = parseHome(raw), before = JSON.stringify(home), view = activityPresentation(home, now);
  expect(view.priorities).toHaveLength(2); expect(view.groups[0]?.items).toHaveLength(3);
  expect(activityPresentation(home, now + 120000).priorities).toHaveLength(0);
  expect(activityPresentation(home, now + 120000).groups[0]?.items).toHaveLength(3); expect(JSON.stringify(home)).toBe(before);
});
it('shows no entry for empty Home and retains notices and summary-only activity', () => {
  const raw = emptyHome(); expect(activityPresentation(parseHome(raw)).hasActivity).toBe(false);
  raw.activeInteractionsSummary.hasPendingSchedulingConnection = true; expect(activityPresentation(parseHome(raw)).hasActivity).toBe(true);
});

it('classifies actionable Scheduling as required and waiting Scheduling as Others', () => {
 const raw=emptyHome();raw.nextSteps=[true,false].map((requiresAction,index)=>({type:'SCHEDULING',matchId:'m'+index,connectionId:'c'+index,requiresAction,createdAt:'2026-11-05T12:00:00Z',schedulingExpiresAt:'2026-11-06T12:00:00Z'}));
 const groups=activityPresentation(parseHome(raw)).groups;expect(groups.map(g=>g.title)).toEqual(['Requiere tu acción','Otros']);
});
