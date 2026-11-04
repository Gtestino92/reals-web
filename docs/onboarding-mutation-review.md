# Stage C mutation review

Before implementation: identity belongs to SessionController; domain work uses its bearer client and combined abort signal. No automatic domain mutation effects.

| Path | Invariant / installation | Failure / concurrency |
| --- | --- | --- |
| Initial load, resume, retry | Legal status/catalog joined by type/version/action; profile and photos installed together | Single owner, abort on cleanup; invalid payload blocks mutations |
| Legal action | Exact current required action/version; refresh status/catalog | Reload even on stale-version conflict; never infer acceptance |
| Create | One explicit submit; validate DRAFT response | Shared synchronous lock; reconcile uncertain result before another submit |
| Details / filters | Separate contract bodies; backend status authoritative | No optimistic lifecycle update; refresh after write |
| Photo add / replace / delete / reorder | ID targets; full placement list; profile/photos atomic refresh | All writes serialized; no mutation retry; failed refresh blocks further writes |
| Email send / reload | Firebase owns verification; refresh token | 60s send / 10s check cooldown; identity guard |
| Activation | Validate ACTIVE response, then reload | Success only after confirmed activation; errors retained in Spanish |
| Sign-out / identity change | Session generation rejects old results | Abort all component work on cleanup; no business transitions in cleanup |

StrictMode may repeat reads, never writes. Crop URLs are owned by the crop component and revoked on cleanup. Decoded bitmap is closed. Resume refreshes only when no operation owns the lock. Transient errors retain the authenticated identity. Terminal/account errors return to existing session reconciliation. No credentials or private URLs are logged.
