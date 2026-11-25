# Reals Web documentation

- [Architecture](architecture.md): current structure, ownership and deliberate limits.
- [Local development](local-development.md): Vite, proxy and existing Docker services.
- [Deployment configuration](deployment.md): Reals environments, Cloudflare Pages and remote backend integration.
- [Testing](testing.md): automated checks and manual smoke verification.
- [Browser identity](browser-identity.md): favicon/app icons, source artwork, reproduction and manifest verification limits.
- [Home D1](home-review.md): overview, queue lifecycle, refresh invariants and integration limitations.
- [First Chat D2](first-chat-review.md): navigation, chat mutations, audio compatibility, validation and two-user integration protocol.
- [Stale First Chat fix](stale-first-chat-review.md): terminal suppression, backend commit consistency and separate validation evidence.
- [Android reference](android-reference.md): source files, visual tokens and future parity.
- [Android parity matrix](android-parity-matrix.md): audited behavior, migration methodology, validation evidence and remaining differences.
- [POC effort log](poc-log.md): task measurement template.

Product and API references remain in [`reals-backend/docs/commons`](../../reals-backend/docs/commons/). Android architecture and deferred work remain in [`reals-app/docs`](../../reals-app/docs/README.md); they are references, not React implementation instructions.

Scheduling reads use `GET /api/connections/{connectionId}/scheduling-snapshot`. Confirm the merged endpoint is deployed in the target environment before releasing this Web client. See the [backend API contract](../../reals-backend/docs/commons/api.md#connections-and-scheduling) and [Web scheduling validation](android-parity-matrix.md#consolidated-scheduling-snapshot).
