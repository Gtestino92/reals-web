import type { Availability, Negotiation, Proposal } from './contracts';
export type Stage = 'Loading' | 'WaitingForMyProposals' | 'WaitingForPartnerProposals' | 'ReviewPartnerProposals' | 'Scheduled' | 'Failed' | 'Unknown';
export function roundState(loading: boolean, n: Negotiation | null, proposals: Proposal[], me: string) {
  const current = proposals.filter(p => p.roundNumber === n?.roundNumber).sort((a,b) => a.preferenceOrder-b.preferenceOrder);
  const mine = current.filter(p => p.userId === me), partner = current.filter(p => p.userId !== me);
  const myPending = mine.filter(p => p.status === 'PENDING'), received = partner.filter(p => p.status === 'PENDING');
  const stage: Stage = loading ? 'Loading' : !n ? 'Unknown' : n.status === 'CONFIRMED' ? 'Scheduled' : n.status === 'FAILED' ? 'Failed' : n.status !== 'PENDING' ? 'Unknown' : received.length ? 'ReviewPartnerProposals' : !mine.length ? 'WaitingForMyProposals' : 'WaitingForPartnerProposals';
  return { stage, mine, partner, myPending, received };
}
export const conflicts = (value: string, a: Availability) => a.unavailableWindows.some(w => Date.parse(value) >= Date.parse(w.startsAt) && Date.parse(value) <= Date.parse(w.endsAt));
export function reviewReason(value: string, now: number, a: Availability | null) {
  if (!Number.isFinite(Date.parse(value))) return 'No disponible';
  if (Date.parse(value) <= now) return 'Vencido';
  if (!a) return 'Disponibilidad sin verificar';
  return conflicts(value,a) ? 'Se superpone con otra cita confirmada' : '';
}
const pad = (n: number) => String(n).padStart(2,'0');
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
export function days(now: number) { return Array.from({length:7},(_,i)=>{ const d=new Date(now); d.setDate(d.getDate()+i);return localDay(d); }); }
// Date's normalization must never silently turn a DST gap into a different hour.
export function localSlot(day: string, hour: number, minute: number): string | null {
  const d = new Date(`${day}T${pad(hour)}:${pad(minute)}:00`);
  if (!Number.isFinite(d.getTime()) || localDay(d)!==day || d.getHours()!==hour || d.getMinutes()!==minute) return null;
  const offset = -d.getTimezoneOffset();
  return `${day}T${pad(hour)}:${pad(minute)}:00${offset>=0?'+':'-'}${pad(Math.floor(Math.abs(offset)/60))}:${pad(Math.abs(offset)%60)}`;
}
export function validateSlots(values: string[], now: number, a: Availability | null): string {
  if (!a) return 'No pudimos verificar la disponibilidad. Reintentá antes de enviar.';
  if (!values.length) return 'Seleccioná al menos un horario.';
  if (values.length>3) return 'Podés elegir hasta 3 horarios.';
  if (values.some(v=>!Number.isFinite(Date.parse(v)))) return 'Hay un horario con formato inválido.';
  if (new Set(values.map(Date.parse)).size!==values.length) return 'Los horarios no pueden repetirse.';
  if (values.some(v=>Date.parse(v)<=now)) return 'Uno o más horarios elegidos ya pasaron. Quitalos o elegí otro horario.';
  if (values.some(v=>Date.parse(v)<now+1200000)) return 'Los horarios tienen que tener al menos 20 minutos de margen.';
  if (values.some(v=>!/^\d{4}-\d\d-\d\dT\d\d:(00|30):00(?:\.0+)?(?:Z|[+-]\d\d:\d\d)$/.test(v))) return 'Los horarios tienen que estar alineados a media hora.';
  if (values.some(v=>!days(now).includes(localDay(new Date(v))))) return 'Elegí un día entre hoy y los próximos seis días.';
  if (values.some(v=>conflicts(v,a))) return 'Uno o más horarios elegidos se superponen con otra cita confirmada. Quitalos o elegí otro horario.';
  return '';
}
