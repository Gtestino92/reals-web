import { useId, useState } from 'react';

const preferenceKey = 'reals:ios-install-guidance:v1';
let dismissedInDocument = false;

function shouldOfferInstallation() {
  const browser = window.navigator;
  const ios = /\b(iPhone|iPad)\b/.test(browser.userAgent) ||
    (browser.platform === 'MacIntel' && browser.maxTouchPoints > 1);
  const safari = browser.vendor === 'Apple Computer, Inc.' &&
    /\bVersion\/[\d.]+\b.*\bSafari\/[\d.]+$/.test(browser.userAgent) &&
    !/\b(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA)\//.test(browser.userAgent);
  // These signals describe the current window, including when Safari and a
  // Home Screen app coexist. Safari exposes no installed-app inventory here.
  if (!ios || !safari || window.top !== window ||
    ('standalone' in browser && browser.standalone === true) ||
    window.matchMedia?.('(display-mode: standalone)').matches) return false;
  if (dismissedInDocument) return false;
  try { return window.localStorage.getItem(preferenceKey) !== 'dismissed'; }
  catch { return true; }
}

export function InstallGuidance({ onDismiss }: { onDismiss: () => void }) {
  const title = useId();
  const [visible, setVisible] = useState(shouldOfferInstallation);
  if (!visible) return null;

  const dismiss = () => {
    try { window.localStorage.setItem(preferenceKey, 'dismissed'); }
    catch { dismissedInDocument = true; }
    setVisible(false);
    onDismiss();
  };

  return <section className="home-card home-install" aria-labelledby={title}>
    <h3 id={title}>Instalá Reals</h3>
    <p>Accedé directamente desde la pantalla de inicio de tu dispositivo.</p>
    <ol>
      <li>Tocá <strong>Compartir</strong> en Safari.</li>
      <li>Elegí <strong>Agregar a Inicio</strong>. Si aparece <strong>Abrir como app web</strong>, activalo y tocá <strong>Agregar</strong>.</li>
    </ol>
    <div className="home-install-actions">
      <button type="button" className="login-button login-outlined" onClick={dismiss}>Ya la instalé</button>
      <button type="button" className="login-button login-outlined" onClick={dismiss}>Ahora no</button>
    </div>
  </section>;
}
