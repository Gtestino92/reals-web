import { useEffect, useState } from 'react';
// Advisory presentation clock only. Authoritative lifecycle stays in Home polling.
export function useHomeTime(active = true) {
  const [now,setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const update = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
    update(); const timer = window.setInterval(update,1000);
    document.addEventListener('visibilitychange',update); window.addEventListener('pageshow',update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange',update); window.removeEventListener('pageshow',update); };
  },[active]);
  return now;
}
