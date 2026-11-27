import { ChatIcon } from './ChatIcon';

export function ReactionLane({ confirmed, pending, eligible, disabled, react }: {
  confirmed: boolean; pending: boolean; eligible: boolean; disabled: boolean; react: () => void;
}) {
  return <div className="chat-reaction-lane">
    {confirmed || pending ? <span className="chat-given-heart" role="img" aria-busy={pending} aria-label={pending ? 'Guardando corazón' : 'Reaccionaste con corazón'}><ChatIcon name="heart"/></span> : eligible &&
      <button className="chat-heart" aria-label="Reaccionar con corazón" disabled={disabled} onClick={react}><ChatIcon name="heartOutline"/></button>}
  </div>;
}
