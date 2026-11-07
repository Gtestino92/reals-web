import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AudioPolicy } from './contracts';
import { prepareRecording, recordingMime } from './audio';
import { ChatIcon } from './ChatIcon';

type Phase = 'idle' | 'permission' | 'recording' | 'checking';
type Draft = { file: Blob; url: string; duration: number };
export function AudioComposer({ policy, disabled, onSend, onDirtyChange, payloadLocked = false, confirmedFile, delivery, onRetry, children, textConfirmationVersion = 0 }: {
  policy: AudioPolicy | null; disabled: boolean; onSend: (file: Blob) => Promise<void> | void;
  onDirtyChange: (dirty: boolean) => void; payloadLocked?: boolean; confirmedFile?: Blob | null;
  delivery?: 'pending' | 'failed' | 'uncertain' | null; onRetry?: () => Promise<void>;
  children?: (microphone: ReactNode) => ReactNode;
  textConfirmationVersion?: number;
}) {
  const [phase, setPhase] = useState<Phase>('idle'), [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState(''), [seconds, setSeconds] = useState(0), [incompatible, setIncompatible] = useState(false), [sending, setSending] = useState(false);
  const [dismissed,setDismissed]=useState<string[]>([]), confirmedText=useRef(textConfirmationVersion), explanationId=useId();
  const unavailable=policy?.remainingMessages===0?'LIMIT_REACHED':!policy?.enabled?policy?.unavailableReason ?? 'UNAVAILABLE':null;
  useEffect(()=>{if(textConfirmationVersion>confirmedText.current){confirmedText.current=textConfirmationVersion;if(unavailable==='LIMIT_REACHED')setDismissed(current=>current.includes(unavailable)?current:[...current,unavailable]);}},[textConfirmationVersion,unavailable]);
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
  useEffect(() => { onDirtyChange(!!draft || phase === 'recording' || phase === 'checking'); }, [draft, phase, onDirtyChange]);
  useEffect(()=>{
    if(phase!=='permission')return;
    const generation=owner.current.generation;
    const timeout=window.setTimeout(()=>{if(owner.current.alive && owner.current.generation===generation && owner.current.phase==='permission'){cancel();setError('El permiso de micrófono sigue sin respuesta. Podés escribir o volver a solicitarlo.');}},30000);
    return ()=>clearTimeout(timeout);
  },[phase]);
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
          const prepared = prepareRecording(bytes, current.maxDurationMillis, current.maxFileSizeBytes);
          const duration = prepared.duration;
          if (!owns()) return;
          // Normalize MIME only after binary admission; never transcode.
          const file = new Blob([prepared.bytes], { type: 'audio/mp4' });
          r.url = URL.createObjectURL(file); setDraft({ file, url: r.url, duration }); changePhase('idle');
          if (sendAfter) void send(file,sendAfter);
        } catch { if (owns()) { setIncompatible(true); setError('Este navegador no produjo MP4/AAC compatible con Reals. Podés usar texto o Android.'); } }
        finally { if (owns()) { r.recorder = null; changePhase('idle'); } }
      };
      // Keep one recording segment. Chrome's timesliced fragments can contain
      // decode-time gaps at each cut; do not rewrite that timing or transcode.
      // Duration still stops locally; binary size/duration are checked before upload.
      recorder.start(); setSeconds(0); changePhase('recording');
      r.timer = window.setInterval(() => {
        if (!owns()) return;
        const elapsed = performance.now() - started; setSeconds(Math.floor(elapsed / 1000));
        if (elapsed >= Math.max(1000, (settings.current.policy?.maxDurationMillis ?? 0) - 500)) stop(true);
      }, 100);
    } catch { if (r.alive && generation === r.generation) { cancel(); setError('No pudimos acceder al micrófono. Permití su uso en el navegador y volvé a intentar.'); } }
  };
  const compatible = !!recordingMime() && !!navigator.mediaDevices?.getUserMedia;
  const locked = payloadLocked || sending;
  const reasons: Record<string, string> = { GUIDANCE_REQUIRED: 'Avancen en las preguntas guiadas para habilitar audios.', LIMIT_REACHED: 'Alcanzaste el límite de audios.', GUIDANCE_NOT_AVAILABLE: 'Los audios se habilitarán al avanzar en las preguntas.', WAITING_FOR_BOTH: 'El audio se habilita cuando ambas personas hayan ingresado.', WAITING_DELAY: 'El audio todavía no está disponible.', CHAT_NOT_WRITABLE: 'Este chat no admite nuevos audios.' };
  const explanation=unavailable?reasons[unavailable] ?? 'El servidor no habilitó los audios en este momento.':!compatible || incompatible?'Este navegador no puede grabar MP4/AAC compatible. Podés usar texto o Android.':disabled || locked?'El chat no permite grabar en este momento.':'Grabar un mensaje de audio.';
  const microphone = policy && policy.unavailableReason!=='FEATURE_DISABLED' ? <button type="button" className="chat-icon-button" aria-label="Grabar audio" aria-describedby={explanationId} title={unavailable || !compatible || incompatible?explanation:'Grabar audio'} disabled={!compatible || !policy.enabled || disabled || incompatible || locked || phase==='permission' || policy.remainingMessages === 0} onClick={() => void start()}>{phase==='permission'?<span className="chat-spinner" aria-hidden="true"/>:<ChatIcon name="mic" />}</button> : null;
  return <section aria-label="Audio y mensaje" className="chat-audio-composer" onKeyDown={event=>{if(event.key==='Escape' && phase==='permission'){event.preventDefault();cancel();}}}>
    {phase === 'recording' ? <div className="chat-recording"><span role="timer">Grabando: {seconds} s / {Math.ceil((policy?.maxDurationMillis ?? 0) / 1000)} s</span><progress aria-label="Duración de la grabación" value={seconds} max={(policy?.maxDurationMillis ?? 1000) / 1000} /><div className="chat-composer-row"><button type="button" className="chat-icon-button" aria-label="Cancelar grabación" onClick={cancel}><ChatIcon name="close" /></button><button type="button" className="chat-icon-button" aria-label="Detener" title="Detener y revisar" onClick={() => stop()}><ChatIcon name="stop" /></button><button type="button" className="chat-icon-button chat-send" aria-label="Enviar audio" onClick={() => stop(true)}><ChatIcon name="send" /></button></div></div>
      : phase === 'checking' ? <div className="chat-composer-row"><p role="status">Comprobando formato…</p><button type="button" className="chat-icon-button" aria-label="Cancelar grabación" onClick={cancel}><ChatIcon name="close"/></button></div>
      : draft ? <div className="chat-audio-draft"><span>Audio listo para enviar · {Math.ceil(draft.duration / 1000)} s</span><div className="chat-composer-row"><audio ref={preview} controls preload="metadata" src={draft.url} aria-label="Vista previa del audio" onError={event => { if (event.currentTarget === preview.current && owner.current.url === draft.url) setError('No pudimos reproducir la vista previa. Podés eliminar la grabación y volver a intentar.'); }} onPlay={event => document.querySelectorAll('audio').forEach(audio => { if (audio !== event.currentTarget) audio.pause(); })}/><button type="button" className="chat-icon-button" aria-label="Eliminar grabación" disabled={payloadLocked || sending} onClick={discard}><ChatIcon name="close" /></button><button type="button" className="chat-icon-button chat-send" aria-label="Enviar audio" disabled={disabled || !policy?.enabled || policy.remainingMessages === 0 || locked} onClick={() => void send(draft.file)}><ChatIcon name="send" /></button></div>
        {(delivery === 'pending' || sending) && <div role="status">Enviando audio…<progress aria-label="Envío de audio" /></div>}
        {delivery && delivery !== 'pending' && <p role="status">{delivery === 'uncertain' ? 'Envío sin confirmar.' : 'No se pudo enviar el audio.'} {onRetry && <button type="button" disabled={sending} onClick={() => void performUpload(onRetry)}>Reconciliar y reintentar audio</button>}</p>}
      </div> : children ? children(microphone) : microphone}
    {phase==='permission' && <div className={`chat-permission-notice ${children?'chat-permission-inline':''}`}><span role="status">Esperando permiso de micrófono…</span><button type="button" className="chat-text-action" onClick={cancel}>Cancelar solicitud</button></div>}
    <span id={explanationId} className="chat-visually-hidden">{explanation}</span>
    {error && <p role="alert">{error}</p>}
    {policy && unavailable && policy.unavailableReason!=='FEATURE_DISABLED' && !dismissed.includes(unavailable) && <div className="chat-composer-support"><p>{explanation}</p><button type="button" className="chat-icon-button" aria-label="Ocultar aviso de audio" onClick={()=>setDismissed(current=>[...current,unavailable])}><ChatIcon name="close"/></button></div>}
  </section>;
}
