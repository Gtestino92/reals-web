import { useSyncExternalStore } from 'react';
let clock = Date.now();
const listeners = new Set<()=>void>();
let timer: ReturnType<typeof setInterval> | undefined;
const tick = () => { clock=Date.now(); listeners.forEach(fn=>fn()); };
const subscribe = (fn:()=>void) => {
  listeners.add(fn);
  if(listeners.size===1){clock=Date.now();timer=setInterval(tick,1000);document.addEventListener('visibilitychange',tick);}
  return()=>{listeners.delete(fn);if(!listeners.size){clearInterval(timer);document.removeEventListener('visibilitychange',tick);}};
};
export function useVisualNow() { return useSyncExternalStore(subscribe,()=>clock); }
const valid = (v: string | null) => v && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
export function remaining(start: string | null, end: string | null, now: number) {
  const a = valid(start), b = valid(end);
  return a === null || b === null || b <= a ? null : Math.max(0, Math.min(1, (b-now)/(b-a)));
}
export function deadline(end: string | null, now: number, detail = false): string | null {
  const value = valid(end); if (value === null) return null;
  const d = new Date(value), n = new Date(now), minutes = Math.ceil((value-now)/60000);
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = `${d.toLocaleDateString('es-AR', { weekday: 'long' })} ${d.getDate()} de ${d.toLocaleDateString('es-AR', { month: 'long' })}${d.getFullYear() === n.getFullYear() ? '' : ` de ${d.getFullYear()}`}`;
  if (detail) return `${value > now ? 'Vence' : 'Venció'} el ${date} a las ${time}`;
  if (minutes <= 0) return 'vencida';
  if (value-now < 3600000) return `vence en ${Math.max(1,minutes)} min`;
  if (d.toDateString() === n.toDateString()) return `vence hoy ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(n.getDate()+1);
  if (d.toDateString() === tomorrow.toDateString()) return `vence mañana ${time}`;
  return `vence el ${date}, ${time}`;
}
export function VisualDeadline({ start, end, now: authoritativeNow }: { start: string | null; end: string | null; now?: number }) {
  const clock = useVisualNow(), now = authoritativeNow ?? clock, fraction = remaining(start,end,now), text = deadline(end,now);
  return <>{text && <span>{text}</span>}{fraction !== null && <progress className={`visual-progress ${fraction <= .1 ? 'critical' : fraction <= .4 ? 'warning' : ''}`} aria-label={`${Math.round(fraction*100)} % del tiempo restante`} value={fraction} max={1}/>}</>;
}
