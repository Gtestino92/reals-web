import './chat.css';

export function SecondChatSkeleton() {
  return <div className="first-chat second-chat-skeleton" role="status">
    <span className="chat-visually-hidden">Cargando el segundo chat…</span>
    <div className="chat-heading" aria-hidden="true"><div className="placeholder-line"/></div>
    <div className="chat-timeline" aria-hidden="true">
      <div className="placeholder-line"/>
      <div className="placeholder-line"/>
      <div className="placeholder-line"/>
    </div>
    <div className="placeholder-control" aria-hidden="true"/>
  </div>;
}
