import React from 'react';
import { createRoot } from 'react-dom/client';
import { SecondChat } from '../src/chat/SecondChat';
import { SessionController } from '../src/auth/session';
import { ApiClient, ApiError } from '../src/auth/api';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
const params=new URLSearchParams(location.search), me=params.get('user') ?? 'a', backend=params.get('backend') ?? '';
const controller=new SessionController({observe:()=>()=>{},signIn:async()=>{throw Error();},signUp:async()=>{throw Error();},google:async()=>{throw Error();},verify:async()=>{},signOut:async()=>{}},new ApiClient(),false);
controller.snapshot={...controller.snapshot,phase:'ready',account:{id:me,status:'ACTIVE'}};
controller.request=async(path,signal,method='GET',body)=>{
  const response=await fetch(`${backend}/${me}${path}`,{signal,method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw new ApiError('backend',response.status);return response.json();
};
createRoot(document.getElementById('root')!).render(<React.StrictMode><SecondChat controller={controller} connectionId="connection" matchId="m" onHome={()=>{document.body.textContent='Inicio';}}/></React.StrictMode>);
