# Stage C mutation review

Before implementation: identity belongs to SessionController; domain work uses its bearer client and combined abort signal. No automatic domain mutation effects.

| Path | Invariant / installation | Failure / concurrency |
| --- | --- | --- |
| Picker / external file drop | Both paths require a ready, current session, verified email, reconciled state and no mutation or crop owner; exactly one JPEG/PNG passes the shared 15 MB/nonempty check before the existing crop pipeline | Synchronous crop ownership rejects a second selection before rendering; abort/phase/identity guards reject stale picker/drop callbacks; cleanup/cancel releases crop ownership; file drags never reorder photos; disabled reasons derive from current state |
| Authenticity presentation | Translate every supported backend status; photo validation is distinct from profile authenticity | No inferred activation eligibility, verification mutation or fabricated trust state |
| Profile form / country catalog refresh | New-profile country is automatic only until the user makes an explicit choice: derive AR only from a catalog containing AR; existing profile values and explicit choices (including empty) always win | No default-setting effect or new requests; one local fields update per edit; catalog refresh cannot overwrite choices; validate the effective country against the current catalog on submit; new birth date stays empty |
| Session-to-onboarding presentation | Shared Reals branding/loading message while the session is checking/loading or onboarding has no model and is busy; ready screens appear only after model installation | Presentation derives from existing phase/model/busy state; no extra readiness callback, timer or asynchronous installation path; initial errors retain refresh/sign-out and later operations retain progress announcements |
| Initial load, resume, retry | Legal status/catalog joined by type/version/action; profile and photos installed together; unsatisfied legal status with no documents is inconsistent, never satisfied | Single owner, abort on cleanup; invalid legal/profile/photo payload blocks mutations; explicit refresh can recover |
| Auxiliary DRAFT Home read / retry | Interaction state is true, false or unknown; a failed read cannot assert absence or presence | Transient/malformed Home failures allow completion with an unknown-state notice; retry reuses the serialized authoritative refresh; abort, authorization and terminal/account errors propagate instead of becoming auxiliary unavailability |
| Legal action | Exact current required action/version; refresh status/catalog | Reload even on stale-version conflict; never infer acceptance |
| Create | One explicit submit; validate DRAFT response | Shared synchronous lock; reconcile uncertain result before another submit |
| Details / filters | Separate contract bodies; backend status authoritative | No optimistic lifecycle update; refresh after write |
| Photo add / replace / delete / reorder | ID targets; full placement list; profile/photos atomic refresh | All writes serialized; no mutation retry; failed refresh blocks further writes |
| Email send / reload | Firebase owns verification; refresh token | 60s send / 10s check cooldown; identity guard |
| Activation | Disabled while Firebase email remains unverified; existing reload/token refresh and backend activation validation remain authoritative | Success only after confirmed activation; errors retained in Spanish; resend alone cannot enable activation |
| Sign-out / identity change | Session generation rejects old results | Abort all component work on cleanup; no business transitions in cleanup |

StrictMode may repeat reads, never writes. Crop URLs are owned by the crop component and revoked on cleanup. Decoded bitmap is closed. Resume refreshes only when no operation owns the lock. Transient errors retain the authenticated identity. Terminal/account errors return to existing session reconciliation. No credentials or private URLs are logged.
