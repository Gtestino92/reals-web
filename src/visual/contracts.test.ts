import { expect, it } from 'vitest';
import { parseVisualProfile } from './contracts';
import { photo, visualProfile } from './fixtures';
it('orders only approved photos and preserves signed URLs exactly', () => {
  const p = parseVisualProfile(visualProfile({photos:[photo('b',2),photo('a',1),photo('pending',0,{moderationStatus:'NEEDS_REVIEW'}),photo('rejected',0,{moderationStatus:'REJECTED'}),photo('unknown',0,{moderationStatus:null})]}));
  expect(p.photos.map(p=>p.id)).toEqual(['a','b']); expect(p.photos[0]!.url).toBe('https://media.example/a?sig=a%2Fb&x=1');
});
it.each(['javascript:alert(1)','data:image/png;base64,abc','//evil.example/a','https://good.example@evil.example/a','https://example.com/\\evil','https://example.com/a%GG','https://example.com/a b','http://evil.example/a'])('excludes unsafe media %s', url => expect(parseVisualProfile(visualProfile({photos:[photo('a',0,{url})]})).photos).toEqual([]));
it('filters blank sections, deduplicates positive indicators and caps at three; orders selected questions',()=>{
 const p = parseVisualProfile(visualProfile({bio:'  ',affinityIndicators:[{categoryId:'a',title:'A'},{categoryId:'a',title:'dup'},{categoryId:'b',title:'B'},{categoryId:'c',title:'C'},{categoryId:'d',title:'D'}],profileQuestions:[{questionId:'b',prompt:'B',answer:'B',position:2},{questionId:'a',prompt:'A',answer:'A',position:0},{questionId:'x',prompt:' ',answer:'A',position:1}]}));
 expect(p.bio).toBeNull();expect(p.affinityIndicators.map(a=>a.title)).toEqual(['A','B','C']);expect(p.profileQuestions.map(q=>q.questionId)).toEqual(['a','b']);
});
it.each([null,{},visualProfile({age:'29'}),visualProfile({photos:null}),visualProfile({visualExpiresAt:'invalid'}),visualProfile({profileQuestions:{}})])('rejects malformed profiles',v=>expect(()=>parseVisualProfile(v)).toThrow());

it.each(['myPersonalMessageSubmitted','partnerPersonalMessageSubmitted','partnerPersonalMessageRead','decisionRequiresPartnerPersonalMessageRead'])('fails closed for missing or malformed %s',key=>{expect(()=>parseVisualProfile(visualProfile({[key]:undefined}))).toThrow();expect(()=>parseVisualProfile(visualProfile({[key]:'true'}))).toThrow();});
