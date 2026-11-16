import type { Activity } from './contracts';
import { priorityKind } from './presentation';
import { secondHomeCopy, secondHomePresentation } from './secondHomePresentation';
export function HomePriorities({ items, overflow, now, disabled, onOpen, onActivity }: { items: Activity[]; overflow: number; now: number; disabled: boolean; onOpen: (item: Activity) => void; onActivity: () => void }) {
  if (!items.length) return null;
  return <section className="home-card home-priority" aria-label="Prioridad ahora"><h3>Prioridad ahora</h3>
    {items.map(item => {
      const kind = priorityKind(item,now); if (!kind) return null;
      const p = secondHomePresentation(item,now), partner = item.partnerName ? ` con ${item.partnerName}` : '';
      const title = kind === 'visual' ? item.partnerName ? `El perfil de ${item.partnerName} está por vencer` : 'Descubrimiento por vencer' : `Tu segundo chat${partner} ${kind === 'open' ? 'ya empezó' : 'empieza pronto'}`;
      const label = kind === 'visual' ? 'Descubrir ahora' : kind === 'open' ? 'Entrar al chat' : 'Ver en Actividad';
      return <button key={`${item.type}-${item.matchId}-${item.connectionId}`} className="home-priority-row" disabled={disabled || (kind === 'open' && !p?.canOpen)} onClick={() => {
        if (disabled) return;
        const current = priorityKind(item,Date.now());
        if (kind === 'soon' && (current === 'soon' || current === 'open')) onActivity();
        else if (kind === 'visual' && current === 'visual' || kind === 'open' && current === 'open' && secondHomePresentation(item,Date.now())?.canOpen) onOpen(item);
      }}><span className="home-priority-title">{title}</span><span>{kind === 'visual' ? 'Revisá antes de que venza.' : kind === 'open' ? 'Ya está disponible.' : secondHomeCopy(item,now)}</span><span className="home-priority-action">{label}</span><span className="home-priority-chevron" aria-hidden="true">›</span></button>;
    })}
    {overflow > 0 && <button className="login-button login-outlined" disabled={disabled} onClick={onActivity}>Ver {overflow} más en Actividad</button>}
  </section>;
}
