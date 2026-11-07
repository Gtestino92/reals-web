import { expect, it } from 'vitest';
import { mergeMessages, parseChat, parseMessage, plainText, policy, reactable, reactionCursor } from './contracts';
import { chatFixture, messageFixture } from './fixtures';
const message = (id: string, sender: string) => parseMessage(messageFixture(id,sender),'c',['me','them']);
it('orders by authoritative timestamp then id, never arrival order',()=>{expect(mergeMessages([message('2','me')],[message('1','them'),message('2','me')]).map(m=>m.id)).toEqual(['1','2']);});
it('preserves heart and shallow reply against stale omissions',()=>{const m={...message('1','them'),reactionType:'HEART' as const,replyTo:{type:'MESSAGE' as const,targetId:'x',previewText:'hola'}};expect(mergeMessages([m],[message('1','them')])[0]).toMatchObject({reactionType:'HEART',replyTo:m.replyTo});});
it('latest incoming block survives own subsequent messages',()=>{const ms=[message('1','them'),message('2','me'),message('3','them'),message('4','them'),message('5','me')];expect([...reactable(ms,'me')]).toEqual(['3','4']);expect(reactionCursor(ms)).toBe('2');});
it('new incoming block supersedes old unreacted block',()=>{const ms=[message('1','them'),message('2','me'),message('3','them')];expect([...reactable(ms,'me')]).toEqual(['3']);});
it('unsupported incoming and existing hearts have no action',()=>{expect(reactable([{...message('1','them'),messageType:'OTHER'},{...message('2','them'),reactionType:'HEART'}],'me').size).toBe(0);});
it.each(['¡Sí, pingüino!\n¿Qué tal?','ñ'.repeat(1000)])('preserves valid Spanish plain text',s=>expect(plainText(s)).toBe(true));
it.each(['\t','<img>','\u0000','\u0080',' '.repeat(3)])('rejects backend-invalid text',s=>expect(plainText(s)).toBe(false));
it('rejects malformed decisions and dates',()=>{expect(()=>parseChat({...chatFixture(),myDecision:null},'m','c','them')).toThrow();expect(()=>parseChat({...chatFixture(),timeoutAt:'invalid'},'m','c','them')).toThrow();});
it('legacy guidance is explicitly absent',()=>{expect(parseChat({...chatFixture(),guidance:null},'m','c','them').guidance).toBeNull();});
it('retains optional reply author and type metadata and accepts their absence',()=>{
  const base={...messageFixture(),replyTo:{type:'MESSAGE',targetId:'target',previewText:'Original'}};
  expect(parseMessage(base,'c',['me','them']).replyTo).toMatchObject({senderId:null,messageType:null,previewText:'Original'});
  expect(parseMessage({...base,replyTo:{...base.replyTo,senderId:'me',messageType:'AUDIO'}},'c',['me','them']).replyTo).toMatchObject({senderId:'me',messageType:'AUDIO'});
});
it.each([{senderId:'outsider'},{senderId:123},{messageType:{}},{messageType:''}])('rejects malformed quote metadata %j',metadata=>{
  expect(()=>parseMessage({...messageFixture(),replyTo:{type:'MESSAGE',targetId:'x',previewText:'Original',...metadata}},'c',['me','them'])).toThrow();
});
it('retains known immutable quote metadata through partial polls without copying it to a different target',()=>{
  const first={...message('1','them'),replyTo:{type:'MESSAGE' as const,targetId:'target',previewText:'Original',senderId:'me',messageType:'TEXT'}};
  const partial={...first,replyTo:{type:'MESSAGE' as const,targetId:'target',previewText:'Original'}};
  expect(mergeMessages([first],[partial])[0]?.replyTo).toMatchObject({senderId:'me',messageType:'TEXT'});
  expect(mergeMessages([first],[{...partial,replyTo:{...partial.replyTo,targetId:'different'}}])[0]?.replyTo?.senderId).toBeNull();
});
it('local expiry remains advisory without a terminal transition',()=>{const c=parseChat(chatFixture(),'m','c','them');expect(policy(c,[],Infinity)).toMatchObject({ordinary:false,decide:false,safety:true,expired:true});expect(c.status).toBe('ACTIVE');});
