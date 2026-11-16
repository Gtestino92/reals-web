// Initial-load structure only: no private cache, artificial delay or animation.
export function ProfilePlaceholder({label}:{label:string}) {
  return <div className="home-card profile-placeholder" role="status">
    <span className="loading-label">{label}</span>
    <div aria-hidden="true"><div className="placeholder-line placeholder-title"/><div className="placeholder-line"/><div className="placeholder-photo"/></div>
  </div>;
}
