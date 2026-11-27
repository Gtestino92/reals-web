export function ContactHeader({ onBack }: { onBack: () => void }) {
  return <header className="home-heading"><h2 tabIndex={-1}>Contactos</h2><button className="login-button login-outlined" onClick={onBack}>Volver a Cuenta</button></header>;
}

export function ContactSkeleton() {
  return <div className="home-card" role="status" aria-label="Cargando contactos" aria-busy="true">
    <div className="placeholder-line" aria-hidden="true"/><div className="placeholder-control" aria-hidden="true"/>
  </div>;
}

export function ContactLoadError({ onBack }: { onBack: () => void }) {
  return <section className="home-account contacts"><ContactHeader onBack={onBack}/>
    <p role="alert">No pudimos cargar Contactos. Revisá tu conexión y recargá Reals para volver a entrar.</p>
    <button onClick={() => window.location.reload()}>Recargar Reals</button>
  </section>;
}
