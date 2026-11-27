export function ContactHeader({ onBack }: { onBack: () => void }) {
  return <header className="home-heading"><h2 tabIndex={-1}>Contactos</h2><button className="login-button login-outlined" onClick={onBack}>Volver a Cuenta</button></header>;
}

export function ContactSkeleton({ actionsOnly = false }: { actionsOnly?: boolean }) {
  const actions = <><span className="placeholder-control"/><span className="placeholder-control"/></>;
  return <div className="contact-skeleton" role="status" aria-label="Cargando contactos" aria-busy="true">
    {actionsOnly ? <div className="contact-skeleton-actions" aria-hidden="true">{actions}</div> : <>
      <div className="home-card" aria-hidden="true">
        <span className="placeholder-line contact-skeleton-title"/>
        <span className="placeholder-line"/>
        <span className="placeholder-line contact-skeleton-description"/>
        {actions}
      </div>
      <div className="home-card" aria-hidden="true">
        <span className="placeholder-line contact-skeleton-title"/>
        {actions}
      </div>
    </>}
  </div>;
}

export function ContactLoadError({ onBack }: { onBack: () => void }) {
  return <section className="home-account contacts"><ContactHeader onBack={onBack}/>
    <p role="alert">No pudimos cargar Contactos. Revisá tu conexión y recargá Reals para volver a entrar.</p>
    <button onClick={() => window.location.reload()}>Recargar Reals</button>
  </section>;
}
