# Licensing and service boundaries

This document explains what the project's MIT license covers, what it does not
cover, and how contributors should evaluate new dependencies and integrations.
It is project guidance, not legal advice.

## Repository code

Original source code and documentation in this repository are released under
the [MIT License](../LICENSE), unless a file or directory says otherwise.

MIT applies to the repository's code. It does not relicense:

- third-party libraries;
- hosted APIs or cloud services;
- news articles, feeds, research papers, or other source material;
- trademarks;
- generated images or 3D assets whose use is governed by provider terms; or
- contributor material that was submitted without the necessary rights.

Third-party software retains its own license. See
[Third-Party Notices](../THIRD_PARTY_NOTICES.md).

## Project rule for dependencies

Direct runtime dependencies should use a well-understood permissive open-source
license such as MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, or 0BSD.

A dependency with a copyleft, source-available, non-commercial, field-of-use, or
custom license must not be added casually. It requires:

1. a documented reason it is necessary;
2. an analysis of distribution and deployment obligations;
3. an explicit exception in the automated license policy; and
4. an update to `THIRD_PARTY_NOTICES.md`.

Dependencies with missing or ambiguous license metadata fail the automated
check. GPL, AGPL, SSPL, BUSL, Commons Clause, and unlicensed packages are denied
by default. This is a conservative project policy, not a statement that every
use of those licenses is legally incompatible with MIT.

Run the audit in each package that has a dependency graph:

```bash
cd frontend && npm run license:check
cd ../marketing && npm run license:check
cd ../pipeline && npm run license:check
cd ../infra/aws && npm run license:check
```

Each check reads the package's exact dependency graph from `package-lock.json`.
It permits the project's approved permissive licenses and a small, named list of
reviewed transitive exceptions. CI must pass before dependency changes are
merged. Some frameworks, including Next.js, also ship compiled third-party
modules inside their own package. Their included license files remain
authoritative; the package-lock check does not replace a release-time
bundled-code notice audit.

## Hosted services are not open-source dependencies

The reference pipeline integrates with commercial services through replaceable
adapters. The adapter code can be MIT-licensed even when the remote service is
proprietary. The service itself, its models, API, and terms are not covered by
this repository's MIT license.

### Google Gemini image generation (Nano Banana)

Nano Banana is a proprietary Google service, not an open-source model. A user
enabling the adapter must provide their own Gemini API credentials, billing when
applicable, and agreement to Google's current
[Gemini API terms](https://ai.google.dev/gemini-api/terms). Prompts and
outputs may be handled differently between unpaid and paid services; users must
review the current data-use terms before sending source material.

The project should remain usable with a mock image provider and should allow
alternative image-generation adapters.

### World Labs Marble

Marble is a proprietary World Labs service. Automated image-to-world generation
requires a project-scoped World Labs API key and may require paid service
credits. The [World Labs terms](https://www.worldlabs.ai/terms-of-service)
distinguish free-account output from paid-account and API output, including
commercial-use rights. Anyone publishing or redistributing a generated world
must verify the terms that applied when that output was created. The current
[authentication documentation](https://atlas-beta.worldlabs.ai/docs/authentication)
describes the project-scoped key used by the Developer API.

A user who supplies an already generated, properly licensed splat can run the
frontend without a World Labs API key. Spark.js rendering does not itself require a
World Labs service credential.

### AWS

The reference deployment is designed for AWS. Infrastructure definitions and
deployment scripts in this repository are MIT-licensed, but AWS services are
commercial services governed by the user's AWS agreement. Users deploy into and
pay for their own account. AWS credentials must come from the user's local AWS
profile, identity provider, or deployment environment and must never be committed
to this repository. Users are responsible for the current
[AWS Customer Agreement](https://aws.amazon.com/agreement/).

AWS is the initial reference platform, not a requirement of the artistic or data
model. Contributors may add other cloud implementations as long as provider-
specific code stays behind documented interfaces and does not weaken the
project's license or secret-handling rules.

### News and social sources

Source adapters must respect each source's license, terms, robots directives,
rate limits, and permitted retention. A public URL is not permission to copy or
redistribute an article.

The reference implementation should prefer no-key RSS/Atom feeds and primary
institutional sources. Optional commercial news or social APIs may require the
user's own credentials and terms acceptance. Article text and verbatim evidence
are processed ephemerally in memory and discarded. The project stores citations,
content hashes, and original summaries; it does not relicense, retain, or
republish source articles.

## Credentials required by the reference workflow

| Capability | Credential | Required when |
| --- | --- | --- |
| Local frontend with fixture data | None | Always available |
| Spark.js rendering of a public splat | None | Asset URL permits browser access |
| Gemini/Nano Banana generation | User-supplied Gemini API key | Image generation is enabled |
| World Labs Marble generation | User-supplied World Labs API key | Automated world generation is enabled |
| AWS deployment | User-controlled AWS credentials | Deploying or operating the AWS reference stack |
| Optional commercial sources | Provider-specific key | That source adapter is enabled |

All adapters must fail with an actionable configuration message when credentials
are missing. No credential may be sent to the browser or written into a generated
edition artifact.

## Generated and contributed assets

Every committed image, splat, audio file, font, dataset, or other non-code asset
must include provenance sufficient to answer:

- who created it;
- which tool or source produced it;
- which terms applied at creation time;
- whether commercial use and redistribution are permitted;
- whether attribution is required; and
- whether it contains third-party trademarks or copyrighted material.

The current fictional demo image keeps its generation prompt and a small,
machine-readable provenance record beside the asset.

## Contributor checklist

Before adding a package, service, source, or asset:

1. Identify its exact license or service terms.
2. Confirm that the intended use, redistribution, and deployment are allowed.
3. Prefer a permissive open-source alternative when practical.
4. Add the item to the appropriate notices or provider documentation.
5. Add credentials only through documented environment variables or secret
   stores.
6. Run `npm run license:check` and the normal test suite.
7. Request explicit review for anything outside the approved license set.

