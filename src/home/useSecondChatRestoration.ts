import { useEffect, useRef, useState } from 'react';
import type { SessionController } from '../auth/session';
import { SecondChatSession } from '../chat/SecondChatSession';
import type { Activity, HomeData } from './contracts';

/** One passive decision per authenticated Home mount; never persisted or replayed on return. */
export function useSecondChatRestoration(controller: SessionController, home: HomeData | null, available: boolean, active: boolean, restore: (item: Activity, session: SecondChatSession) => void) {
  const [state,setState] = useState({ready:false,error:''}), [attempt,retry] = useState(0);
  const completed = useRef(false), callback = useRef(restore); callback.current = restore;
  const candidates = home?.nextSteps.filter(item => item.connectionId && ['SECOND_CHAT_AVAILABLE','SECOND_CHAT_SCHEDULED'].includes(item.type) && item.secondChat?.chatId && item.secondChat.chatStatus === 'ACTIVE' && ['ON_TIME','LATE'].includes(item.secondChat.myAttendanceStatus)) ?? [];
  useEffect(() => {
    if (completed.current || !active || !available || !home) return;
    let cancelled = false, transferred = false, session: SecondChatSession | null = null;
    const account = controller.getSnapshot().account?.id;
    const current = () => !cancelled && controller.getSnapshot().phase === 'ready' && controller.getSnapshot().account?.id === account;
    setState({ready:false,error:''});
    queueMicrotask(() => { void (async () => {
      if (!current() || !account) return;
      for (const item of candidates) {
        if (!item.connectionId) continue;
        session = new SecondChatSession(controller,item.connectionId,item.matchId,account,item.partnerName);
        await session.refresh();
        if (!current()) return;
        const status = session.getSnapshot().status;
        const incompleteActive = status?.chatStatus === 'ACTIVE' && ['ON_TIME','LATE'].includes(status.myAttendanceStatus) && !status.chatId;
        if ((!status && !session.canReturnHome) || incompleteActive) {
          session.dispose(); session = null;
          setState({ready:false,error:'No pudimos verificar tu segundo chat activo. Revisá tu conexión y reintentá.'}); return;
        }
        if (!session.rules.canReturn) {
          completed.current = true; transferred = true;
          callback.current(item,session); setState({ready:true,error:''}); return;
        }
        session.dispose(); session = null;
      }
      completed.current = true; setState({ready:true,error:''});
    })(); });
    return () => { cancelled = true; if (!transferred) session?.dispose(); };
  },[controller,home,available,active,attempt]);
  // A verified Home with no candidate needs no asynchronous gate/remount. Keep
  // its header/control identity stable while eligibility and Home settle.
  return {...state,ready:state.ready || (!!home && available && candidates.length === 0),retry:() => retry(value => value+1)};
}
