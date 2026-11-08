import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { replyPreview, ReplyQuote } from './ReplyQuote';
import type { Message } from './contracts';

it.each([
  {senderId:'me',label:'Vos'}, {senderId:'them',label:'María'}, {senderId:null,label:'Respuesta'},
])('uses quoted sender metadata for $label without inferring missing authors',({senderId,label})=>{
  const quote:NonNullable<Message['replyTo']>={type:'MESSAGE',targetId:'x',senderId,previewText:'Texto original'};
  render(<ReplyQuote {...replyPreview(quote,'me','them','María')}/>);expect(screen.getByText(label)).toBeVisible();
});
it('labels question and audio explicitly and renders unsafe-looking text safely',()=>{
  expect(replyPreview({type:'GUIDANCE_QUESTION',targetId:'q',previewText:'¿Qué te inspira?'},'me','them','María').label).toBe('Pregunta');
  expect(replyPreview({type:'MESSAGE',targetId:'a',previewText:null,messageType:'AUDIO'},'me','them','María').text).toBe('Mensaje de audio');
  render(<ReplyQuote label="María" text="<img src=x onerror=bad>"/>);expect(screen.getByText('<img src=x onerror=bad>')).toBeVisible();expect(document.querySelector('img')).toBeNull();
});
