import { useEffect, useRef, useState } from 'react';
import type { AudioPolicy } from './contracts';
import { inspectAudio, recordingMime } from './audio';

export function AudioComposer({ policy, disabled, onSend, onDirtyChange, payloadLocked = false }: { policy: AudioPolicy | null; disabled: boolean; onSend: (file: Blob) => void; onDirtyChange: (dirty: boolean) => void; payloadLocked?: boolean }) {
  const [phase, setPhase] = useState<'idle'|'permission'|'recording'|'checking'>('idle');
  const [draft,setDraft] = useState<{ file: Blob; url: string } | null>(null), [error,setError] = useState(''), [seconds,setSeconds] = useState(0), [incompatible,setIncompatible] = useState(false);
  const owner = useRef<{ recorder: MediaRecorder | null; stream: MediaStream | null; canceled: boolean; timer: number | null; url: string | null; alive: boolean; generation: number }>({ recorder: null, stream: null, canceled: false, timer: null, url: null, alive: true, generation: 0 });
  useEffect(() => { onDirtyChange(!!draft || phase !== 'idle'); }, [draft,phase,onDirtyChange]);
  const stop = (cancel = false) => {
    const r = owner.current; r.canceled = cancel;
    if (r.timer !== null) clearInterval(r.timer); r.timer = null;
    if (r.recorder && r.recorder.state !== 'inactive') r.recorder.stop();
    r.stream?.getTracks().forEach(t => t.stop()); r.stream = null;
  };
  useEffect(() => {
    const r = owner.current; r.alive = true;
    const hide = () => { if (document.visibilityState !== 'visible') { stop(true); r.generation++; setPhase('idle'); } };
    document.addEventListener('visibilitychange',hide);
    return () => { r.alive = false; r.generation++; stop(true); if (r.url) URL.revokeObjectURL(r.url); document.removeEventListener('visibilitychange',hide); };
  }, []);
  useEffect(() => { if (disabled || !policy?.enabled) { const r = owner.current; r.generation++; stop(true); setPhase('idle'); } }, [disabled, policy?.enabled]);
  const start = async () => {
    const mime = recordingMime(), r = owner.current;
    if (!mime || !policy?.enabled || disabled || phase !== 'idle') return;
    const generation = ++r.generation;
    setPhase('permission'); setError(''); r.canceled = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!r.alive || generation !== r.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      r.stream = stream;
      const recorder = new MediaRecorder(stream,{ mimeType: mime, audioBitsPerSecond: 64000 }); r.recorder = recorder;
      const chunks: Blob[] = []; let size = 0; const started = performance.now();
      recorder.ondataavailable = e => { chunks.push(e.data); size+=e.data.size; if (size > policy.maxFileSizeBytes) { setError('La grabación superó el tamaño permitido.'); stop(true); } };
      recorder.onerror = () => { setError('No pudimos grabar. Revisá el micrófono y volvé a intentar.'); stop(true); setPhase('idle'); };
      recorder.onstop = async () => {
        if (!r.alive || generation !== r.generation) return;
        if (r.canceled) { setPhase('idle'); return; }
        setPhase('checking'); stop();
        try {
          const native = new Blob(chunks,{ type: recorder.mimeType });
          inspectAudio(await native.arrayBuffer(),policy.maxDurationMillis,policy.maxFileSizeBytes);
          if (!r.alive || generation !== r.generation) return;
          // MIME normalization only after binary MP4/AAC inspection, never a WebM conversion.
          const file = new Blob(chunks,{ type: 'audio/mp4' });
          if (r.url) URL.revokeObjectURL(r.url);
          r.url = URL.createObjectURL(file); setDraft({ file, url: r.url });
        } catch { if (r.alive && generation === r.generation) { setIncompatible(true); setError('Este navegador no produjo MP4/AAC compatible con Reals. La grabación está deshabilitada; podés usar texto o Android.'); } }
        finally { if (r.alive && generation === r.generation) setPhase('idle'); }
      };
      recorder.start(250); setSeconds(0); setPhase('recording');
      r.timer = window.setInterval(() => { const elapsed = performance.now()-started; setSeconds(Math.floor(elapsed/1000)); if (elapsed >= Math.max(1000,policy.maxDurationMillis-500)) stop(); },100);
    } catch { stop(true); if (r.alive && generation === r.generation) { setError('No pudimos acceder al micrófono. Permití su uso en el navegador y volvé a intentar.'); setPhase('idle'); } }
  };
  const mime = recordingMime();
  const reasons: Record<string,string> = { GUIDANCE_REQUIRED: 'Avancen en las preguntas guiadas para habilitar audios.', LIMIT_REACHED: 'Alcanzaste el límite de audios.', GUIDANCE_NOT_AVAILABLE: 'Este chat no tiene audios habilitados.' };
  return <section aria-label="Audio" className="chat-audio-composer">
    {!mime || !navigator.mediaDevices?.getUserMedia ? <p>Este navegador no puede grabar MP4/AAC compatible. Podés usar texto o Android.</p> : !policy?.enabled ? <p>{reasons[policy?.unavailableReason ?? ''] ?? 'El servidor no habilitó los audios en este momento.'}</p> : <>
      <p>Hasta {Math.floor(policy.maxDurationMillis/1000)} s · {policy.remainingMessages ?? '—'} audios disponibles</p>
      {phase === 'recording' ? <><span role="timer">Grabando: {seconds} s</span><button onClick={() => stop()}>Detener</button><button onClick={() => stop(true)}>Cancelar grabación</button></> : <button disabled={disabled || incompatible || phase !== 'idle' || !!draft} onClick={() => void start()}>{phase === 'permission' ? 'Esperando permiso…' : phase === 'checking' ? 'Comprobando formato…' : 'Grabar audio'}</button>}
    </>}
    {error && <p role="alert">{error}</p>}
    {draft && <><audio controls src={draft.url} aria-label="Vista previa del audio" /><button disabled={disabled || !policy?.enabled} onClick={() => onSend(draft.file)}>Enviar audio</button><button disabled={payloadLocked} onClick={() => { if (owner.current.url) URL.revokeObjectURL(owner.current.url); owner.current.url = null; setDraft(null); }}>Eliminar grabación</button></>}
  </section>;
}
