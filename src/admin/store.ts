import { ApiError } from '../auth/api';
import type { SessionController } from '../auth/session';
import { decisionResult, detail, diagnostics, list, record, report, str } from './model';
import type { Action, Row, Section } from './model';
export interface AdminState { access: 'checking' | 'allowed' | 'denied' | 'error'; section: Section; sourceReportId: string | null; rows: Row[]; selected: Row | null; diagnostics: Row | null; busy: boolean; refreshing: boolean; blocked: boolean; error: string; notice: string }
const initial: AdminState = { access: 'checking', section: 'photos', sourceReportId: null, rows: [], selected: null, diagnostics: null, busy: false, refreshing: false, blocked: false, error: '', notice: '' };
export class AdminStore {
  private state = initial;
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private generation = 0;
  private alive = false;
  private mutation = false;
  private filters = '';
  constructor(private session: Pick<SessionController, 'request'>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private install(patch: Partial<AdminState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private current(g: number) { return this.alive && this.generation === g && !this.abort.signal.aborted; }
  private begin() { this.abort.abort(); this.abort = new AbortController(); return ++this.generation; }
  start = () => { this.alive = true; void this.authorize(); };
  dispose = () => { this.alive = false; this.abort.abort(); this.generation++; this.install(initial); this.mutation = false; };
  private failure(error: unknown, block = false) {
    if (error instanceof ApiError && [401,403].includes(error.status)) {
      this.abort.abort(); this.generation++;
      this.install({ ...initial, access: 'denied' });
    } else this.install({ busy: false, refreshing: false, blocked: this.state.blocked || block, error: 'No se pudo obtener el estado. Usá Consultar estado para volver a intentar.' });
  }
  authorize = async () => {
    const g = this.begin(); this.install({ ...initial, busy: true });
    try {
      const data = diagnostics(await this.session.request('/admin/diagnostics/matchmaking', this.abort.signal));
      if (!this.current(g)) return;
      this.install({ access: 'allowed', diagnostics: data, busy: false }); await this.load();
    } catch (error) { if (this.current(g)) { this.failure(error); if (this.state.access !== 'denied') this.install({ access: 'error' }); } }
  };
  private path() { return this.state.sourceReportId !== null ? `/admin/safety-reports/${encodeURIComponent(this.state.sourceReportId)}` : this.state.section === 'photos' ? '/admin/profile-photos/review' : this.state.section === 'appeals' ? '/admin/penalty-appeals/pending' : this.state.section === 'diagnostics' ? '/admin/diagnostics/matchmaking' : this.filters ? `/admin/safety-reports?${this.filters}` : '/admin/safety-reports/pending'; }
  load = async (background = false) => {
    if (this.state.access !== 'allowed' || this.mutation) return;
    if (background && (this.state.busy || this.state.refreshing || this.state.blocked || this.state.selected)) return;
    const g = this.begin(), { section, sourceReportId } = this.state;
    this.install(background ? { refreshing: true } : { busy: true, refreshing: false, rows: [], selected: null, error: '' });
    try {
      const raw = await this.session.request(this.path(), this.abort.signal);
      if (!this.current(g)) return;
      if (sourceReportId !== null) {
        const selected = detail(raw);
        if (str(record(selected.report),'id') !== sourceReportId) throw new ApiError('invalid');
        this.install({ selected, busy: false, refreshing: false, blocked: false, error: '' });
      } else this.install({ ...(section === 'diagnostics' ? { diagnostics: diagnostics(raw) } : { rows: list(raw, section) }), busy: false, refreshing: false, blocked: false, error: '' });
    } catch (error) { if (this.current(g)) this.failure(error, background); }
  };
  navigate = (section: Section, filters = '') => { if (this.mutation || this.state.access !== 'allowed') return; this.filters = filters; this.install({ section, sourceReportId: null, rows: [], selected: null, notice: '' }); void this.load(); };
  select = async (row: Row) => {
    if (this.state.busy || this.mutation || this.state.blocked || this.state.access !== 'allowed') return;
    // A selection supersedes its background list read, including synchronous photo selection.
    if (this.state.section !== 'reports') { if (this.state.refreshing) this.begin(); this.install({ selected: row, refreshing: false, error: '', notice: '' }); return; }
    const g = this.begin(); this.install({ selected: null, busy: true, refreshing: false, error: '', notice: '' });
    try { const value = detail(await this.session.request(`/admin/safety-reports/${encodeURIComponent(str(row,'id'))}`, this.abort.signal)); if (this.current(g)) this.install({ selected: value, busy: false }); }
    catch (error) { if (this.current(g)) this.failure(error); }
  };
  sourceReport = (id: string) => {
    const s = this.state;
    if (this.mutation || s.busy || s.blocked || s.access !== 'allowed' || s.section !== 'appeals' || !id || s.selected?.sourceReportId !== id) return;
    this.install({ section: 'reports', sourceReportId: id, rows: [], selected: null, notice: '', error: '' });
    void this.load();
  };
  decide = async (action: Action, body: unknown) => {
    const s = this.state;
    if (this.mutation || s.busy || s.blocked || s.access !== 'allowed' || !s.selected) return;
    if (s.section === 'reports' && report(s.selected.report).status !== 'PENDING') return;
    const selected = s.selected;
    const path = s.section === 'photos' ? `/admin/profile-photos/${encodeURIComponent(str(selected,'photoId'))}/moderation` : s.section === 'appeals' ? `/admin/penalty-appeals/${encodeURIComponent(str(selected,'penaltyId'))}/decision` : `/admin/safety-reports/${encodeURIComponent(str(record(selected.report),'id'))}/${action === 'TEMPORARY_BAN' || action === 'PERMANENT_BAN' ? 'penalty' : action}`;
    this.mutation = true;
    const g = this.begin(); this.install({ busy: true, blocked: true, error: '', notice: '' });
    let confirmed = false;
    try {
      const raw = await this.session.request(path, this.abort.signal, 'POST', body);
      if (!this.current(g)) return;
      // Only a validated DTO confirms the write; malformed success is reconciled as uncertain.
      const result = decisionResult(raw, s.section);
      confirmed = true;
      this.install({ selected: s.section === 'reports' ? { ...selected, report: result } : null, notice: 'Decisión confirmada por el servidor.' });
    } catch (error) {
      if (!this.current(g)) return;
      if (error instanceof ApiError && [401,403].includes(error.status)) { this.failure(error); return; }
      this.install({ selected: null, notice: 'Resultado incierto o conflicto. Consultá el estado antes de otra decisión.' });
    } finally { if (this.generation === g) this.mutation = false; }
    if (!this.current(g)) return;
    // Reconcile only by GET. A failed refresh never turns a confirmed write into a failed write.
    await this.load();
    if (this.current(this.generation) && this.state.error && confirmed) this.install({ notice: 'Decisión confirmada. Falló la actualización; consultá el estado antes de continuar.' });
  };
}
