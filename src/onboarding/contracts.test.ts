import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../auth/api';
import { countries, defaults, fullProfile, hasInteractions, legal, normalize, photos, validate } from './contracts';
import { cropRect, decodePhoto, exportCrop } from './CropDialog';
import { onboardingError } from './Onboarding';
export const profile = { ...defaults, birthDate: '1995-01-01', displayName: 'Ana', city: 'Córdoba', countryCode: 'AR', id: 'p', userId: 'u', status: 'DRAFT', authenticityVerificationStatus: 'STALE' };
export const photo = { id: 'photo', url: 'http://localhost:9000/photo?signature=test', position: 1, validationStatus: 'VALIDATED', moderationStatus: 'APPROVED', isPersonPhoto: true, isFullBody: true };
export const countryList = [{ code: 'AR', displayName: 'Argentina' }, { code: 'ES', displayName: 'España' }];
describe('onboarding contracts', () => {
  it('normalizes plain input and preserves backend country metadata', () => { expect(normalize({ ...defaults, displayName:' Ana ', countryCode:' ar ' }).countryCode).toBe('AR'); expect(countries(countryList)).toEqual(countryList); });
  it('accepts valid creation and distinguishes filters from details', () => { expect(validate(profile,countryList,'create')).toEqual([]); expect(validate(defaults,[],'filters')).toEqual([]); expect(validate({ ...profile, lookingForGenders:[] },countryList,'details')).toEqual([]); });
  it.each([{ birthDate:'' },{ birthDate:'2000-02-30' },{ birthDate:'2020-01-01' },{ birthDate:'1900-01-01' },{ birthDate:'invalid' },{ displayName:'x' },{ displayName:'<script>' },{ city:'' },{ countryCode:'ZZ' },{ gender:'unknown' },{ intention:'unknown' },{ lookingForGenders:[] },{ bio:'x'.repeat(1001) },{ preferredMinAge:50, preferredMaxAge:40 },{ maxDistanceKm:101 }])('rejects invalid form %j', patch => { expect(validate({ ...profile,...patch },countryList,'create').length).toBeGreaterThan(0); });
  it.each(['DRAFT','INACTIVE','ACTIVE'])('accepts backend lifecycle %s', status => expect(fullProfile({ ...profile,status },'u').status).toBe(status));
  it.each([null,{}, { ...profile,userId:'other' },{ ...profile,preferredMinAge:NaN },{ ...profile,lookingForGenders:['invalid'] }])('rejects malformed profiles', raw => expect(() => fullProfile(raw,'u')).toThrow(ApiError));
  it('legal satisfied catalogs pass; unsatisfied requires exact joined metadata', () => {
    expect(legal({ requirementsSatisfied:true,documents:[] },{ documents:[] }).satisfied).toBe(true);
    const d = { type:'PRIVACY_NOTICE',version:'v2',requiredAction:'ACKNOWLEDGED',satisfied:false };
    expect(legal({ requirementsSatisfied:false,documents:[d] },{ documents:[{ ...d,url:'https://example.com/privacy' }] }).documents[0]?.version).toBe('v2');
    expect(() => legal({ requirementsSatisfied:false,documents:[d] },{ documents:[{ ...d,version:'v1' }] })).toThrow();
  });
  it.each([{ documents:[] },{ documents:[{ type:'PRIVACY_NOTICE',version:'v2',requiredAction:'ACKNOWLEDGED',url:'https://example.com/privacy' }] }])('rejects unsatisfied legal status with no documents regardless of catalog %j', ({ documents }) => {
    expect(() => legal({ requirementsSatisfied:false,documents:[] },{ documents })).toThrow(ApiError);
  });
  it('validates photos, placements and safe URLs', () => { expect(photos([photo])).toEqual([photo]); for (const raw of [[photo,photo],[{ ...photo,position:0 }],[{ ...photo,url:'javascript:alert(1)' }],[{ ...photo,moderationStatus:'???' }]]) expect(() => photos(raw)).toThrow(); });
  it('recognizes DRAFT interaction routing without deriving transitions', () => { const home = { pendingActions:[],nextSteps:[],passiveNotices:[],activeInteractionsSummary:{ hasPendingSchedulingConnection:false,activeInitialCount:0,activeConnectionCount:0,actionableConnectionCount:0 } }; expect(hasInteractions(home)).toBe(false); expect(hasInteractions({ ...home,nextSteps:[{}] })).toBe(true); expect(() => hasInteractions({})).toThrow(); });
  it('multipart preserves bearer, signal and native boundary', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(photo)));
    const api = new ApiClient(fetcher), data = new FormData(), signal = new AbortController().signal;
    data.append('file',new Blob(['jpeg'],{ type:'image/jpeg' }),'profile.jpg'); data.append('position','1');
    await api.request('/me/profile/photos',signal,{ uid:'f',emailVerified:true,reload:async () => {},getIdToken:async () => 'token' },'POST',data);
    const options = fetcher.mock.calls[0]?.[1]; expect(options?.body).toBe(data); expect(options?.headers).toEqual({ Authorization:'Bearer token' }); expect(options?.credentials).toBe('omit'); expect(options?.signal).toBe(signal);
  });
  it.each(['EMAIL_NOT_VERIFIED','PROFILE_PHOTOS_REQUIRED','PROFILE_PERSON_PHOTO_REQUIRED','PROFILE_FULL_BODY_PHOTO_REQUIRED','PROFILE_PHOTO_MODERATION_NOT_APPROVED','PROFILE_AUTHENTICITY_VERIFICATION_REQUIRED','LEGAL_ACTION_REQUIRED','PROFILE_NOT_ACTIVATABLE'])('presents activation error %s safely', code => { const message = onboardingError(new ApiError('backend',409,code,{ message:'secret' })); expect(message).not.toContain('secret'); expect(message).not.toContain(code); expect(message.length).toBeGreaterThan(20); });
  it('network and unknown errors remain actionable', () => { expect(onboardingError(new ApiError('network'))).toContain('conexión'); expect(onboardingError(new ApiError('backend',400,'NEW_CODE'))).toContain('NEW_CODE'); });
});
describe('crop', () => {
  it.each([[4000,3000],[1000,2000],[800,1000]])('bounds 4:5 crop in %sx%s source', (w,h) => { for (const zoom of [1,2,4]) { const r = cropRect(w,h,zoom,2,-1); expect(r.w/r.h).toBeCloseTo(.8); expect(r.x+r.w).toBeLessThanOrEqual(w); expect(r.y).toBe(0); expect(r.y+r.h).toBeLessThanOrEqual(h); } });
  it('rejects unsupported, excessive and undecodable input', async () => { await expect(decodePhoto(new File(['x'],'x.heic',{ type:'image/heic' }))).rejects.toThrow(); await expect(decodePhoto(new File(['x'],'x.jpg',{ type:'image/jpeg' }))).rejects.toThrow(); });
  it('exports JPEG 1080x1350 at .9 and releases canvas memory', async () => {
    const draw = vi.fn(); const context = vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({ fillStyle:'',fillRect:vi.fn(),drawImage:draw } as unknown as CanvasRenderingContext2D);
    let canvas: HTMLCanvasElement | undefined;
    const blob = vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(function(this: HTMLCanvasElement,callback,type,quality) { canvas = this; expect(this.width).toBe(1080); expect(this.height).toBe(1350); expect(type).toBe('image/jpeg'); expect(quality).toBe(.9); callback(new Blob(['jpeg'],{ type:'image/jpeg' })); });
    const bitmap = { width:800,height:1000 } as ImageBitmap;
    expect((await exportCrop(bitmap,1,.5,.5)).type).toBe('image/jpeg'); expect(draw).toHaveBeenCalledOnce(); expect(canvas?.width).toBe(0); context.mockRestore(); blob.mockRestore();
  });
});
