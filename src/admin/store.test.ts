import { expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api';
import { AdminStore } from './store';
import { payload, plain } from './model';
import { diag, photo, summary, appeal } from './fixtures';
const tick = async () => { for(let i=0;i<10;i++) await Promise.resolve(); };
function setup() { const request = vi.fn(async (_path: string, _signal: AbortSignal, _method?: string, _body?: unknown): Promise<unknown> => []); const store = new AdminStore({ request }); return { request,store }; }
async function ready() { const r = setup(); r.request.mockResolvedValueOnce(diag).mockResolvedValueOnce([photo]); r.store.start(); await tick(); return r; }
it('foreground reconciliation retains rows and blocks duplicate reads without replacing healthy content', async () => {
  const { store, request } = await ready(); const rows = store.getSnapshot().rows;
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); request.mockClear();
  const read = store.load(true); void store.load(true);
  expect(store.getSnapshot()).toMatchObject({ rows, busy: false, refreshing: true, selected: null });
  expect(store.getSnapshot().rows).toBe(rows); expect(request).toHaveBeenCalledOnce();
  finish([photo]); await read; expect(store.getSnapshot()).toMatchObject({ refreshing: false, blocked: false, rows: [photo] });
});
it('selection supersedes a foreground read; its late result cannot replace the selected context', async () => {
  const { store, request } = await ready(); let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const read = store.load(true), signal = request.mock.calls.at(-1)![1];
  await store.select(photo); expect(signal.aborted).toBe(true);
  finish([]); await read; expect(store.getSnapshot()).toMatchObject({ selected: photo, rows: [photo], refreshing: false });
});
it.each([new ApiError('network'), new ApiError('authorization', 403)])('foreground failure preserves recovery or clears denied data: %s', async error => {
  const { store, request } = await ready(); request.mockRejectedValueOnce(error); await store.load(true);
  if (error.status === 403) expect(store.getSnapshot()).toMatchObject({ access: 'denied', rows: [], refreshing: false });
  else expect(store.getSnapshot()).toMatchObject({ access: 'allowed', rows: [photo], blocked: true, refreshing: false });
});
it('disposal aborts foreground reconciliation and rejects its late response', async () => {
  const { store, request } = await ready(); let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const read = store.load(true), signal = request.mock.calls.at(-1)![1]; store.dispose(); finish([photo]); await read;
  expect(signal.aborted).toBe(true); expect(store.getSnapshot()).toMatchObject({ access: 'checking', rows: [], refreshing: false });
});
const sourceDetail = { report: summary, details: 'Source report', messages: [] };
async function selectedAppeal() {
  const r = await ready();
  r.request.mockResolvedValueOnce([appeal]); r.store.navigate('appeals'); await tick();
  await r.store.select(appeal); r.request.mockClear();
  return r;
}
it('source report atomically clears appeal rows, fetches only detail and refreshes the same context', async () => {
  const {store,request} = await selectedAppeal();
  let finish: (value: unknown) => void = () => {};
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  store.sourceReport('report');
  expect(store.getSnapshot()).toMatchObject({section:'reports',sourceReportId:'report',rows:[],selected:null,busy:true});
  expect(request).toHaveBeenCalledExactlyOnceWith('/admin/safety-reports/report',expect.any(AbortSignal));
  finish(sourceDetail); await tick();
  expect(store.getSnapshot().selected).toEqual(sourceDetail);
  request.mockResolvedValueOnce(sourceDetail); await store.load();
  expect(request.mock.calls.map(c => c[0])).toEqual(['/admin/safety-reports/report','/admin/safety-reports/report']);
});
it('return to appeals aborts source detail and ignores its late response', async () => {
  const {store,request} = await selectedAppeal();
  let finish: (value: unknown) => void = () => {};
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([appeal]);
  store.sourceReport('report'); const signal=request.mock.calls[0]![1];
  store.navigate('appeals'); await tick(); finish(sourceDetail); await tick();
  expect(signal.aborted).toBe(true);
  expect(store.getSnapshot()).toMatchObject({section:'appeals',sourceReportId:null,rows:[appeal],selected:null,busy:false});
  expect(request.mock.calls.map(c => c[0])).toEqual(['/admin/safety-reports/report','/admin/penalty-appeals/pending']);
});
it.each([401,403])('source detail denial %s clears context and prevents further reads', async status => {
  const {store,request} = await selectedAppeal();
  request.mockRejectedValueOnce(new ApiError('authorization',status)); store.sourceReport('report'); await tick();
  expect(store.getSnapshot()).toMatchObject({access:'denied',sourceReportId:null,rows:[],selected:null});
  store.sourceReport('report'); store.navigate('appeals'); await store.load(); expect(request).toHaveBeenCalledTimes(1);
});
it.each([new ApiError('network'),new ApiError('backend',404),{...sourceDetail,report:{...summary,id:'other'}}])('source detail failure retains retry context without actionable stale data', async outcome => {
  const {store,request} = await selectedAppeal();
  if (outcome instanceof ApiError) request.mockRejectedValueOnce(outcome); else request.mockResolvedValueOnce(outcome);
  store.sourceReport('report'); await tick();
  expect(store.getSnapshot()).toMatchObject({section:'reports',sourceReportId:'report',rows:[],selected:null,busy:false});
  expect(store.getSnapshot().error).not.toBe('');
  request.mockResolvedValueOnce(sourceDetail); await store.load();
  expect(store.getSnapshot().selected).toEqual(sourceDetail);
});
it('source navigation requires authorized, idle selected appeal and its exact link', async () => {
  const {store,request} = await selectedAppeal();
  store.sourceReport('other'); expect(request).not.toHaveBeenCalled();
  request.mockImplementationOnce(() => new Promise(() => {}));
  void store.decide('REJECT',payload('REJECT','review','','',appeal));
  store.sourceReport('report'); store.navigate('reports'); expect(request).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().section).toBe('appeals'); store.dispose();
  store.sourceReport('report'); expect(store.getSnapshot()).toMatchObject({sourceReportId:null,rows:[],selected:null});
});
it.each(['confirmed','uncertain'] as const)('contextual %s decision reconciles by detail only and blocks on failed refresh', async outcome => {
  const {store,request} = await selectedAppeal();
  request.mockResolvedValueOnce(sourceDetail); store.sourceReport('report'); await tick();
  request.mockClear();
  if (outcome === 'confirmed') request.mockResolvedValueOnce({...summary,status:'DISMISSED'});
  else request.mockRejectedValueOnce(new ApiError('network'));
  request.mockRejectedValueOnce(new ApiError('network'));
  await store.decide('dismissal',{notes:null});
  expect(request.mock.calls.map(c=>c[0])).toEqual(['/admin/safety-reports/report/dismissal','/admin/safety-reports/report']);
  expect(store.getSnapshot()).toMatchObject({sourceReportId:'report',rows:[],selected:null,blocked:true});
  if (outcome === 'confirmed') expect(store.getSnapshot().notice).toContain('Decisión confirmada');
  await store.decide('dismissal',{notes:null}); expect(request).toHaveBeenCalledTimes(2);
  request.mockResolvedValueOnce({...sourceDetail,report:{...summary,status:'DISMISSED'}}); await store.load();
  expect(store.getSnapshot().blocked).toBe(false);
  await store.decide('dismissal',{notes:null}); expect(request).toHaveBeenCalledTimes(3);
});
it('only authorization GET runs before effective authorization', async () => { const {request,store} = setup(); request.mockImplementation(() => new Promise(() => {})); store.start(); expect(request).toHaveBeenCalledTimes(1); expect(store.getSnapshot().rows).toEqual([]); store.navigate('reports'); expect(request).toHaveBeenCalledTimes(1); store.dispose(); });
it.each([401,403])('denial %s clears data and stops queries',async status => { const {request,store} = setup(); request.mockRejectedValue(new ApiError('authorization',status)); store.start(); await tick(); expect(store.getSnapshot().access).toBe('denied'); store.navigate('reports'); await store.load(); expect(request).toHaveBeenCalledTimes(1); });
it('malformed diagnostics cannot grant access',async () => { const {request,store} = setup(); request.mockResolvedValue({}); store.start(); await tick(); expect(store.getSnapshot().access).toBe('error'); expect(request).toHaveBeenCalledTimes(1); });
it('disposal aborts pending read and rejects a fetch ignoring abort',async () => { const {request,store} = setup(); let finish: (v: unknown) => void = () => {}; request.mockImplementation(() => new Promise(resolve => { finish = resolve; })); store.start(); const signal = request.mock.calls[0]![1]; store.dispose(); finish(diag); await tick(); expect(signal.aborted).toBe(true); expect(store.getSnapshot().rows).toEqual([]); expect(request).toHaveBeenCalledTimes(1); });
it.each(['APPROVED','REJECTED'] as const)('photo %s uses exact version and never installs optimistically',async action => { const {store,request} = await ready(); await store.select(photo); let finish: (v: unknown) => void = () => {}; request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([]); const body = payload(action,'ñ','','',photo); const pending = store.decide(action,body); void store.decide(action,body); expect(request.mock.calls.filter(c => c[2] === 'POST')).toHaveLength(1); expect(request.mock.calls.at(-1)?.[3]).toEqual({ expectedPhotoVersion:42, decision:action, notes:'ñ' }); expect(store.getSnapshot().blocked).toBe(true); finish({...photo,moderationStatus:action}); await pending; expect(store.getSnapshot().rows).toEqual([]); expect(store.getSnapshot().notice).toContain('confirmada'); });
it('stale photo conflict reconciles by GET with no retry', async () => { const {store,request} = await ready(); await store.select(photo); request.mockRejectedValueOnce(new ApiError('backend',409)).mockResolvedValueOnce([]); await store.decide('APPROVED',payload('APPROVED','','','',photo)); expect(request.mock.calls.at(-1)?.[0]).toBe('/admin/profile-photos/review'); expect(request.mock.calls.filter(c => c[2] === 'POST')).toHaveLength(1); expect(store.getSnapshot().rows).toEqual([]); });
it('confirmed mutation survives refresh failure and stays blocked', async () => { const {store,request} = await ready(); await store.select(photo); request.mockResolvedValueOnce({...photo,moderationStatus:'APPROVED'}).mockRejectedValueOnce(new ApiError('network')); await store.decide('APPROVED',{}); expect(store.getSnapshot().notice).toContain('Decisión confirmada'); expect(store.getSnapshot().blocked).toBe(true); await store.decide('REJECTED',{}); expect(request.mock.calls.filter(c => c[2] === 'POST')).toHaveLength(1); });
it('uncertain write needs authoritative GET before another decision',async () => { const {store,request} = await ready(); await store.select(photo); request.mockRejectedValueOnce(new ApiError('network')).mockRejectedValueOnce(new ApiError('network')); await store.decide('APPROVED',{}); expect(store.getSnapshot().blocked).toBe(true); expect(store.getSnapshot().selected).toBeNull(); request.mockResolvedValueOnce([photo]); await store.load(); expect(store.getSnapshot().blocked).toBe(false); });
it.each(['dismissal','abusive-dismissal','TEMPORARY_BAN','PERMANENT_BAN'] as const)('report %s installs confirmed status and reconciles', async action => { const {store,request} = await ready(); request.mockResolvedValueOnce([summary]); store.navigate('reports','status=PENDING&source=SYSTEM'); await tick(); expect(request.mock.calls.at(-1)?.[0]).toContain('source=SYSTEM'); request.mockResolvedValueOnce({report:summary,details:'text',messages:[]}); await store.select(summary); request.mockResolvedValueOnce({...summary,status:action.includes('BAN')?'CONFIRMED':'DISMISSED'}).mockResolvedValueOnce([]); const body = payload(action,'notes','Motivo','12',summary); await store.decide(action,body); expect(request.mock.calls.find(c => c[2] === 'POST')?.[0]).toBe('/admin/safety-reports/report/'+(action.includes('BAN')?'penalty':action)); expect(store.getSnapshot().notice).toContain('confirmada'); });
it('nonpending report has no decision path', async () => { const {store,request} = await ready(); request.mockResolvedValueOnce([summary]); store.navigate('reports'); await tick(); request.mockResolvedValueOnce({report:{...summary,status:'CONFIRMED'},details:'',messages:[]}); await store.select(summary); await store.decide('dismissal',{}); expect(request.mock.calls.filter(c => c[2] === 'POST')).toHaveLength(0); });
it.each(['APPROVE','REJECT'] as const)('appeal %s accepts public DTO then refreshes queue',async action => { const {store,request} = await ready(); request.mockResolvedValueOnce([appeal]); store.navigate('appeals'); await tick(); await store.select(appeal); request.mockResolvedValueOnce({status:action==='APPROVE'?'APPROVED':'REJECTED',banActive:action!=='APPROVE'}).mockResolvedValueOnce([]); await store.decide(action,payload(action,'review','','',appeal)); expect(request.mock.calls.find(c=>c[2]==='POST')?.[0]).toBe('/admin/penalty-appeals/penalty/decision'); expect(store.getSnapshot().notice).toContain('confirmada'); });
it('401 after access clears every private field',async () => { const {store,request} = await ready(); request.mockRejectedValueOnce(new ApiError('invalid',401)); await store.load(); expect(store.getSnapshot().access).toBe('denied'); expect(store.getSnapshot().rows).toEqual([]); expect(store.getSnapshot().diagnostics).toBeNull(); });
it('PlainText and penalty validation match backend limits', () => { expect(plain('á ñ ü ¿¡\n\r',1000,true)).toBe(true); for(const value of ['<x>','\t','\u0080','x'.repeat(1001)]) expect(plain(value,1000)).toBe(false); for(const hours of ['0','-1','1.5','','9007199254740992']) expect(()=>payload('TEMPORARY_BAN','','reason',hours,summary)).toThrow(); expect(payload('PERMANENT_BAN','','reason','bad',summary)).toEqual({type:'PERMANENT_BAN',durationHours:null,reason:'reason',notes:null}); expect(()=>payload('APPROVE','','','',appeal)).toThrow(); expect(()=>payload('PERMANENT_BAN','','x'.repeat(256),'',summary)).toThrow(); });
