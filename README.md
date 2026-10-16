# A World Every Day

A living, evolving digital installation. Every day, a new world is generated
from developments in science, technology, culture, health, climate and
communities around the world.

**Status:** Early prototype. The repository includes a fictional interactive
demonstration and one live local factual vertical slice spanning bounded story
discovery, editorial selection, image and world generation, landmark detection,
3D hotspot baking, and local publication assembly. AWS now runs manual live
feed collection, an opt-in editorial shortlist, and a separately gated
article-analysis stage. It can finalize a ten-story edition and, with a separate
approval flag, create art direction for review. Additional gated AWS stages can
request one raw Nano Banana image only after a checksum-bound review artifact
is present, then process it into a private 8K panorama. Gated cloud world
generation, landmark detection, interaction baking, and publication are now
deployed behind explicit review gates and pass fixture tests, but are not yet
validated end to end with a live AWS edition. The daily schedule remains
disabled.

## Thesis

Information increasingly arrives as an endless feed: fragments competing for
attention and quickly displaced by whatever comes next. The news is perhaps the
clearest example: an unending stream of headlines, clickbait, conflict, and
crisis.

A World Every Day is an artistic exploration: what if information arrived as a
place?

The first experiment begins with the news. Each morning, credible stories of
discovery, progress, repair, and cooperation become a single explorable world: a
slower, more curious way of encountering what is happening around us and across
the world.

But news is only the beginning. The same pattern could turn research, archives,
community knowledge, cultural collections, or entirely different kinds of
information into worlds of their own.

## The daily world

Each edition is a playful, diagrammatic world composed from a curated set of
stories from the previous day. Ideas, discoveries, places, and events are brought
together as one limited, navigable environment: something to wander, look
around, and slowly explore.

Visitors move through it as an interactive 3D world. Its landmarks are more than
scenery: select one to learn what it represents, read the story behind it, and
follow the original sources when you want to go deeper.

As the project continues, the worlds become a living archive. You can return to
today, move backward through earlier editions, and see time not as a list of
headlines, but as a collection of places.

## How it works

The reference implementation is a daily state-machine pipeline:

```text
reviewed official RSS feeds
      ↓
ten stories + summaries + links
      ↓
a generated image
      ↓
a world foundation model
      ↓
an interactive world + historical archive
```

The reference implementation uses official RSS feeds for story
discovery. It does not depend on social feeds or unbounded website collection.
After shortlisting, it may read a linked source ephemerally only when that use
has been reviewed and permitted. Sources can remain discovery-only when their
terms, robots directives, or delivery behavior do not permit automated analysis.

RSS is the starting point, not a limitation of the underlying pattern. Source
adapters can be added for archives, datasets, APIs, private knowledge bases, or
other kinds of information when the operator has permission to access and use
them.

A world foundation model is a generative model that creates a spatial,
explorable environment from inputs such as images or text. In this project, an
image becomes the starting point for a 3D world rather than the final artifact.

A World Every Day is also an ongoing exploration of world foundation models.
As those models become more capable, the project will evolve with them, using
newer models to create worlds with greater fidelity, coherence, and possibility
over time.

The pipeline is designed to gather the day's information, preserve each story
and its sources in structured data, generate a single image from the selected
stories, and pass that image to World Labs Marble to create the spatial world.
The finished assets and story data are then brought together in an interactive
web experience rendered with Spark.js.

Source articles are processed **ephemerally in memory** and then discarded.
Their bodies and verbatim passages are never copied into project storage or
republished. Persistent artifacts contain source links and provenance, content
hashes, and original project-written summaries, claims, and visual details.
In the current repository code, feed-metadata evaluation, permitted article
analysis, and art direction use Amazon Nova through AWS-managed Bedrock.
AWS processes these prompts; this is not self-hosted inference or a guarantee
of zero AWS retention. Google still receives the original visual prompt, which
may include story-derived physical details, and World Labs receives the image.
The deployed development workers still use the earlier Google text path and
must not be used under the new policy until updated and verified. See the
[source-data boundary](docs/DATA_BOUNDARY.md) and
[deployment preflight](infra/aws/README.md#source-text-privacy-preflight).

## Technical architecture

The first deployment is designed to run entirely in AWS. Hosting, compute,
storage, databases, asset delivery, secrets, monitoring, and deployment all live
in the project's AWS account. AWS Step Functions is the core pipeline: a state
machine that coordinates each stage of the daily world from collection through
publication.

The main building blocks are:

- [AWS](https://aws.amazon.com/) for the complete reference cloud deployment,
  with [AWS Step Functions](https://aws.amazon.com/step-functions/) at the center
  of the pipeline.
- [Amazon Bedrock](https://aws.amazon.com/bedrock/) with Amazon Nova for
  source-metadata evaluation, permitted article analysis, and art direction.
- [Nano Banana](https://ai.google.dev/gemini-api/docs/image-generation) for
  creating a 360-degree equirectangular source image from the selected stories.
- [World Labs Marble](https://www.worldlabs.ai/blog/marble-world-model) for
  turning that image into an explorable 3D world.
- [Spark.js](https://sparkjs.dev/) and [Three.js](https://threejs.org/) for
  rendering the generated Gaussian-splat world in the browser.
- [Next.js](https://nextjs.org/) and [Motion](https://motion.dev/) for the public
  web experience, interactions, and interface animation.

These pieces remain separable so contributors can introduce other sources,
generators, world models, interfaces, or cloud providers without rebuilding the
entire system.

### Backend and infrastructure

Server-side stages live in `pipeline/`; the AWS CDK application lives in
`infra/aws/`. For local infrastructure settings, copy
`infra/aws/.env.example` to the ignored `infra/aws/.env.local`. That file is for
non-secret settings only. Use a named AWS CLI profile backed by IAM Identity
Center or an assumed role for AWS access, and keep provider credentials in AWS
Secrets Manager. See the [AWS infrastructure guide](infra/aws/README.md).

## Make it your own

This is an open building block, not a fixed news product. Follow the subjects
that matter to you, generate linked worlds for science, politics, technology, or
sports, layer data and analytics into the landscape, or turn yesterday's work—
including what your agents accomplished—into a daily spatial record.

The sources, editorial lens, generators, world models, and cloud can all change.
You do not need to be a 3D graphics or AI expert to begin; the local demonstration
works without paid services.

## Building the project

Development is organized around a manual end-to-end world first, followed by the
editorial engine, story discovery, public experience, and AWS automation. See the
[phased build plan](docs/BUILD_PLAN.md) for milestones, acceptance criteria, and
the path to an open-source release. The evolving visual system and generation
constraints live in the separate [art-direction guide](docs/ART_DIRECTION.md).

### Build with an agent

Point Claude Code, Codex, or another coding agent at this repository and away
you go. Ask it to read the [instructions for agents](AGENTS.md) first; they cover
the project structure, validation commands, licensing rules, and boundaries
around credentials, paid services, and deployment.

### Run the frontend

The current frontend is a full-viewport world explorer built with Next.js,
TypeScript, Motion, Three.js, and [Spark.js](https://sparkjs.dev/). Its fictional
sample edition pairs selectable landmarks with slide-out story panels and
requires no API keys. Without a splat asset, it displays the generated source
image as a poster; set the optional public
`NEXT_PUBLIC_WORLD_SPLAT_URL` described in `frontend/.env.example` to activate
the interactive Gaussian-splat viewer.

The explorer's project-site link defaults to `https://aworldeveryday.com`.
Forks can change it with the public `NEXT_PUBLIC_PROJECT_SITE_URL` build setting.

You will need Node.js 20.9 or newer and npm.

```bash
cd frontend
npm i
npm start
```

Then open [http://localhost:3000](http://localhost:3000). Environment variables
needed by future integrations will be documented in `frontend/.env.example`;
never commit a populated `.env` file.

### Run the project site

The separate `marketing/` application introduces the art project, links to the
open-source repository, and embeds the current explorer as a lazy-loaded preview.
It is a static Next.js application with no credentials or server runtime.

```bash
cd marketing
npm i
npm start
```

Public links are configured at build time through `marketing/.env.example`.
They are intentionally browser-visible and must never contain secrets. The
reference deployment serves this site at the root domain and the immersive
`frontend/` application from the configurable `explore` subdomain.
For a production build, set `NEXT_PUBLIC_SITE_URL` and
`NEXT_PUBLIC_EXPLORER_URL` to their public HTTPS URLs; local `.env.local`
values are for development only. The build rejects a production root domain
that links visitors to a local explorer.

To preview a locally generated SPZ without committing it, copy it into the
ignored public-asset directory and set the public URL in `frontend/.env.local`:

```bash
cd frontend
npm run world:local -- --source ../pipeline/artifacts/world/<run>/<edition>/assets/world.spz --name local-world.spz
```

Then set `NEXT_PUBLIC_WORLD_SPLAT_URL=/generated/local-world.spz` and
`NEXT_PUBLIC_WORLD_SPLAT_SHA256` to the asset's SHA-256 checksum before
restarting the frontend. The checksum prevents baked hotspots from being reused
with the wrong world. These variables are public by design; provider credentials
remain in the server-side pipeline environment only.

The local vertical-slice utilities can bake detected panorama landmarks into a
matching SPZ and assemble an ignored local publication manifest. They require a
development browser with remote debugging enabled; see the local utility
commands in `frontend/package.json` and the environment placeholders in
`frontend/.env.example` before using them. Production baking will move into the
automated publication pipeline.

### Run the panorama pipeline

The first pipeline utility generates a 360-degree equirectangular image, repairs
its longitude seam, and prepares an 8192 × 4096 delivery asset. See the
[pipeline guide](pipeline/README.md) for setup, dry-run, and validation commands.
The guide also includes a no-cost `npm run edition` command that exercises the
complete resumable artifact chain locally with fictional providers.
For opt-in live provider runs, copy `pipeline/.env.example` to `pipeline/.env`
and populate the server-only keys documented there. The populated file is
ignored by Git and must never be committed.

### Validate the AWS foundation

The AWS CDK foundation in `infra/aws/` defines private artifact storage,
static-site hosting for both web applications, optional Route 53 custom-domain
records, public-asset delivery, edition state, secret references, monitoring,
and a schedule-disabled fixture workflow. It does not deploy resources, upload
site builds, call paid providers, or run the live daily pipeline by itself.

```bash
cd pipeline
npm i
cd ../infra/aws
npm i
npm run synth
```

Synthesis is local and credential-free. See the
[AWS infrastructure guide](infra/aws/README.md) for configuration, cost guards,
and the explicit boundary around account-mutating commands.

## Contributing

Contributions are welcome across the frontend, editorial system, source and
generation adapters, cloud infrastructure, accessibility, documentation, and
entirely new ways of using the pattern. Read [CONTRIBUTING.md](CONTRIBUTING.md)
before opening an issue or pull request.

## License and providers

Original code in this repository is released under the [MIT License](LICENSE).
Direct runtime dependencies must use approved permissive open-source licenses;
the dependency graphs are enforced by `npm run license:check` in `frontend/`,
`pipeline/`, and `infra/aws/`. See
[Third-Party Notices](THIRD_PARTY_NOTICES.md) and the full
[licensing and service-boundary policy](docs/LICENSING.md).

The reference deployment is being designed for AWS, but cloud-specific code will
remain behind replaceable interfaces so contributors can add other providers.
AWS, Google Gemini/Nano Banana, and World Labs Marble are proprietary hosted
services and are not covered by the repository's MIT license. Users enable those
adapters with their own accounts, credentials, billing, and acceptance of the
providers' current terms. The local fixture-driven frontend requires none of
those credentials.

Paid services are optional and all live calls require deliberate operator
action. See [Costs and usage](docs/COSTS.md) for the expected requests per daily
edition, where spend can occur, and the usage data the project intends to make
visible.
