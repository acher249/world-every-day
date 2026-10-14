# Contributing

Thank you for helping build A World Every Day. Contributions can improve the
daily artwork, the public experience, or the open framework underneath it.

## Before you begin

1. Read the project overview in [`README.md`](README.md).
2. Read [`AGENTS.md`](AGENTS.md), whether you are working manually or with a
   coding agent.
3. Check the phased plan in [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md).
4. Open an issue before beginning a large architectural change, new provider, or
   substantial shift in editorial direction.

Small fixes, documentation improvements, accessibility work, and focused tests
do not need advance discussion.

## Development

The immersive explorer lives in `frontend/` and uses npm:

```bash
cd frontend
npm i
npm start
```

Before submitting a frontend change, run:

```bash
npm run license:check
npm run typecheck
npm test
npm run build
```

Add tests appropriate to new behavior. Pull requests should explain what
changed, why it changed, and what was verified.

From the repository root, scan tracked and untracked source files for common
credential signatures:

```bash
node scripts/check-secrets.mjs
```
Include screenshots or recordings for visible interface changes.

The public project site lives in `marketing/` and follows the same checks:

```bash
cd marketing
npm i
npm run license:check
npm run typecheck
npm test
npm run build
```

Server-side generation work lives in `pipeline/`:

```bash
cd pipeline
npm i
npm run license:check
npm run typecheck
npm test
npm run build
```

Pipeline tests must use synthetic fixtures or mock providers. Paid generation is
always opt-in and must never run in CI.

AWS infrastructure lives in `infra/aws/`:

```bash
cd pipeline
npm i
cd ../infra/aws
npm i
npm run license:check
npm run typecheck
npm test
npm run synth
npm run build
```

Synthesis is local. Never bootstrap, deploy, enable the schedule, or populate
cloud secrets without explicit approval for the target AWS account.

## Project expectations

- Keep changes focused, typed, and understandable to a new contributor.
- Keep provider-specific code behind replaceable interfaces.
- Preserve citations and provenance. Do not republish source articles.
- Never commit credentials, private source material, or populated `.env` files.
- Do not trigger paid providers or deploy infrastructure as part of ordinary
  tests.
- Use fictional or properly licensed fixtures.
- Follow [`docs/ART_DIRECTION.md`](docs/ART_DIRECTION.md) when changing generated
  visual behavior.

## Dependencies, services, and assets

Read [`docs/LICENSING.md`](docs/LICENSING.md) before adding a package, hosted
service, source, dataset, or generated asset. New direct dependencies should use
an approved permissive open-source license. Update
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) when required and ensure the
license check passes.

Committed media must include provenance that identifies its source or generating
tool, applicable terms, redistribution status, attribution requirements, and any
known third-party material.

## License

By contributing, you agree that your contribution will be licensed under the
repository's [MIT License](LICENSE) and that you have the right to submit it on
those terms.
