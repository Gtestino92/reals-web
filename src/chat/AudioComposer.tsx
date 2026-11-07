import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AudioPolicy } from './contracts';
import { inspectAudio, recordingMime } from './audio';
import { ChatIcon } from './ChatIcon';

type Phase = 'idle' | 'permission' | 'recording' | 'checking';
type Draft = { file: Blob; url: string; duration: number };
export function AudioComposer({ policy, disabled, onSend, onDirtyChange, payloadLocked = false, confirmedFile, delivery, onRetry, children }: {
  policy: AudioPolicy | null; disabled: boolean; onSend: (file: Blob) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void; payloadLocked?: boolean; confirmedFile?: Blob | null;
  delivery?: 'pending' | 'failed' | 'uncertain' | null; onRetry?: () => Promise<void>;
  children?: (microphone: ReactNode) => ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>('idle'), [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState(''), [seconds, setSeconds] = useState(0), [incompatible, setIncompatible] = useState(false), [sending, setSending] = useState(false);
  const preview = useRef<HTMLAudioElement>(null), stopIntent = useRef<((file: Blob) => Promise<void> | void) | null>(null);
  const callbacks = useRef({ onSend }); callbacks.current = { onSend };
  const settings = useRef({ policy, disabled, payloadLocked }); settings.current = { policy, disabled, payloadLocked };
  const owner = useRef({ recorder: null as MediaRecorder | null, stream: null as MediaStream | null, timer: null as number | null,
    url: null as string | null, generation: 0, alive: true, life: 0, phase: 'idle' as Phase, sending: false });
  const changePhase = (next: Phase) => { owner.current.phase = next; setPhase(next); };
  const releaseTracks = () => {
    const r = owner.current;
    if (r.timer !== null) clearInterval(r.timer); r.timer = null;
    r.stream?.getTracks().forEach(track => track.stop()); r.stream = null;
  };
  const cancel = () => {
    const r = owner.current; r.generation++;
    const recorder = r.recorder; r.recorder = null;
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); }
    catch { if (r.alive) setError('No pudimos finalizar la grabación. El micrófono fue liberado.'); }
    finally { releaseTracks(); changePhase('idle'); }
  };
  const discard = () => {
    preview.current?.pause();
    if (owner.current.url) URL.revokeObjectURL(owner.current.url);
    owner.current.url = null; setDraft(null); setError('');
  };
  useEffect(() => { onDirtyChange(!!draft || phase !== 'idle'); }, [draft, phase, onDirtyChange]);
  useEffect(() => {
    const r = owner.current; r.alive = true; r.life++;
    const hide = () => { if (document.visibilityState !== 'visible') { cancel(); preview.current?.pause(); } };
    document.addEventListener('visibilitychange', hide);
    return () => { r.alive = false; r.life++; cancel(); if (r.url) URL.revokeObjectURL(r.url); document.removeEventListener('visibilitychange', hide); };
  }, []);
  useEffect(() => { if (disabled || payloadLocked || !policy?.enabled || policy.remainingMessages === 0) { cancel(); preview.current?.pause(); } }, [disabled, payloadLocked, policy?.enabled, policy?.remainingMessages]);
  useEffect(() => { if (draft && confirmedFile === draft.file) discard(); }, [confirmedFile, draft]);
  const performUpload = async (operation: () => Promise<void> | void) => {
    const r = owner.current;
    if (r.sending) return;
    r.sending = true; setSending(true); const life = r.life;
    try { await operation(); }
    catch { if (r.alive && r.life === life) setError('No pudimos enviar el audio. Revisá el estado antes de reintentar.'); }
    finally { if (r.alive && r.life === life) { r.sending = false; setSending(false); } }
  };
  const send = (file: Blob, submission = callbacks.current.onSend) => {
    const current = settings.current;
    if (current.disabled || current.payloadLocked || !current.policy?.enabled || current.policy.remainingMessages === 0) return;
    return performUpload(() => submission(file));
  };
  const stop = (sendAfter = false) => {
    const r = owner.current;
    if (r.phase !== 'recording' || !r.recorder) return;
    changePhase('checking'); stopIntent.current = sendAfter ? callbacks.current.onSend : null;
    try { r.recorder.stop(); releaseTracks(); }
    catch { cancel(); setError('No pudimos finalizar la grabación. Volvé a intentar.'); }
  };
  const start = async () => {
    const mime = recordingMime(), r = owner.current;
    if (!mime || !policy?.enabled || policy.remainingMessages === 0 || disabled || payloadLocked || r.phase !== 'idle' || r.url || r.sending || incompatible) return;
    const generation = ++r.generation; changePhase('permission'); setError(''); stopIntent.current = null;
    document.querySelectorAll('audio').forEach(audio => audio.pause());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!r.alive || generation !== r.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      r.stream = stream;
      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 }); r.recorder = recorder;
      const owns = () => r.alive && generation === r.generation && r.recorder === recorder;
      const chunks: Blob[] = []; let size = 0; const started = performance.now();
      recorder.ondataavailable = event => {
        if (!owns()) return;
        size += event.data.size; chunks.push(event.data);
        if (size > (settings.current.policy?.maxFileSizeBytes ?? 0)) { cancel(); setError('La grabación superó el tamaño permitido.'); }
      };
      recorder.onerror = () => { if (owns()) { cancel(); setError('No pudimos grabar. Revisá el micrófono y volvé a intentar.'); } };
      recorder.onstop = async () => {
        if (!owns()) return;
        const sendAfter = stopIntent.current; changePhase('checking'); releaseTracks();
        try {
          const native = new Blob(chunks, { type: recorder.mimeType });
          const bytes = await native.arrayBuffer(), current = settings.current.policy;
          if (!owns() || !current?.enabled || current.remainingMessages === 0) return;
          const duration = inspectAudio(bytes, current.maxDurationMillis, current.maxFileSizeBytes);
          if (!owns()) return;
          // Normalize MIME only after binary admission; never transcode.
          const file = new Blob(chunks, { type: 'audio/mp4' });
          r.url = URL.createObjectURL(file); setDraft({ file, url: r.url, duration }); changePhase('idle');
          if (sendAfter) void send(file,sendAfter);
        } catch { if (owns()) { setIncompatible(true); setError('Este navegador no produjo MP4/AAC compatible con Reals. Podés usar texto o Android.'); } }
        finally { if (owns()) { r.recorder = null; changePhase('idle'); } }
      };
      recorder.start(250); setSeconds(0); changePhase('recording');
      r.timer = window.setInterval(() => {
        if (!owns()) return;
        const elapsed = performance.now() - started; setSeconds(Math.floor(elapsed / 1000));
        if (elapsed >= Math.max(1000, (settings.current.policy?.maxDurationMillis ?? 0) - 500)) stop(true);
      }, 100);
    } catch { if (r.alive && generation === r.generation) { cancel(); setError('No pudimos acceder al micrófono. Permití su uso en el navegador y volvé a intentar.'); } }
  };
  const compatible = !!recordingMime() && !!navigator.mediaDevices?.getUserMedia;
  const locked = payloadLocked || sending;
  const microphone = compatible && policy?.enabled ? <button type="button" className="chat-icon-button" aria-label="Grabar audio" title="Grabar audio" disabled={disabled || incompatible || locked || policy.remainingMessages === 0} onClick={() => void start()}><ChatIcon name="mic" /></button> : null;
  const reasons: Record<string, string> = { GUIDANCE_REQUIRED: 'Avancen en las preguntas guiadas para habilitar audios.', LIMIT_REACHED: 'Alcanzaste el límite de audios.', GUIDANCE_NOT_AVAILABLE: 'Este chat no tiene audios habilitados.' };
  return <section aria-label="Audio y mensaje" className="chat-audio-composer">
    {phase === 'recording' ? <div className="chat-recording"><span role="timer">Grabando: {seconds} s / {Math.ceil((policy?.maxDurationMillis ?? 0) / 1000)} s</span><progress aria-label="Duración de la grabación" value={seconds} max={(policy?.maxDurationMillis ?? 1000) / 1000} /><div className="chat-composer-row"><button type="button" className="chat-icon-button" aria-label="Cancelar grabación" onClick={cancel}><ChatIcon name="close" /></button><button type="button" className="chat-icon-button" aria-label="Detener" title="Detener y revisar" onClick={() => stop()}><ChatIcon name="stop" /></button><button type="button" className="chat-icon-button chat-send" aria-label="Enviar audio" onClick={() => stop(true)}><ChatIcon name="send" /></button></div></div>
      : phase !== 'idle' ? <div className="chat-composer-row"><p role="status">{phase === 'permission' ? 'Esperando permiso de micrófono…' : 'Comprobando formato…'}</p><button type="button" className="chat-icon-button" aria-label="Cancelar grabación" onClick={cancel}><ChatIcon name="close"/></button></div>
      : draft ? <div className="chat-audio-draft"><span>Audio listo para enviar · {Math.ceil(draft.duration / 1000)} s</span><div className="chat-composer-row"><audio ref={preview} controls preload="metadata" src={draft.url} aria-label="Vista previa del audio" onError={event => { if (event.currentTarget === preview.current && owner.current.url === draft.url) setError('No pudimos reproducir la vista previa. Podés eliminar la grabación y volver a intentar.'); }} onPlay={event => document.querySelectorAll('audio').forEach(audio => { if (audio !== event.currentTarget) audio.pause(); })}/><button type="button" className="chat-icon-button" aria-label="Eliminar grabación" disabled={payloadLocked || sending} onClick={discard}><ChatIcon name="close" /></button><button type="button" className="chat-icon-button chat-send" aria-label="Enviar audio" disabled={disabled || !policy?.enabled || policy.remainingMessages === 0 || locked} onClick={() => void send(draft.file)}><ChatIcon name="send" /></button></div>
        {(delivery === 'pending' || sending) && <div role="status">Enviando audio…<progress aria-label="Envío de audio" /></div>}
        {delivery && delivery !== 'pending' && <p role="status">{delivery === 'uncertain' ? 'Envío sin confirmar.' : 'No se pudo enviar el audio.'} {onRetry && <button type="button" disabled={sending} onClick={() => void performUpload(onRetry)}>Reconciliar y reintentar audio</button>}</p>}
      </div> : children ? children(microphone) : microphone}
    {error && <p role="alert">{error}</p>}
    {!compatible ? <p className="chat-composer-help">Este navegador no puede grabar MP4/AAC compatible. Podés usar texto o Android.</p> : !policy?.enabled && <p className="chat-composer-help">{reasons[policy?.unavailableReason ?? ''] ?? 'El servidor no habilitó los audios en este momento.'}</p>}
  </section>;
}
