# A World Every Day

A living, evolving digital installation. Every day, a new world is generated
from developments in science, technology, culture, health, climate and
communities around the world.

**Status:** Early prototype. The repository currently includes a fictional,
interactive frontend demonstration and the first server-side panorama-generation
stage. The automated daily pipeline is the next major milestone.

## Thesis

Information increasingly arrives as an endless feed: fragments competing for
attention and quickly displaced by whatever comes next. The news is perhaps the
clearest example: an unending stream of headlines, clickbait, conflict, and
crisis.

**A World Every Day is an artistic counterproposal: what if information arrived
as a place?**

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
together as one limited, navigable environment: something to wander through,
look around, and slowly uncover.

Visitors move through it as an interactive 3D world. Its landmarks are more than
scenery: select one to learn what it represents, read the story behind it, and
follow the original sources when you want to go deeper.

As the project continues, the worlds become a living archive. You can return to
today, move backward through earlier editions, and see time not as a list of
headlines, but as a collection of places.

## How it works

The reference implementation is a daily state-machine pipeline:

```text
credible sources
      ↓
ten stories + summaries + links
      ↓
a generated image
      ↓
a world foundation model
      ↓
an interactive world + historical archive
```

A world foundation model is a generative model that creates a spatial,
explorable environment from inputs such as images or text. In this project, an
image becomes the starting point for a 3D world rather than the final artifact.

The pipeline is designed to gather the day's information, preserve each story
and its sources in structured data, generate a single image from the selected
stories, and pass that image to World Labs Marble to create the spatial world.
The finished assets and story data are then brought together in an interactive
web experience rendered with Spark.js.

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
editorial engine, source ingestion, public experience, and AWS automation. See the
[phased build plan](docs/BUILD_PLAN.md) for milestones, acceptance criteria, and
the path to an open-source release. The evolving visual system and generation
constraints live in the separate [art-direction guide](docs/ART_DIRECTION.md).

### Build with an agent

Point Claude Code, Codex, or another coding agent at this repository and away
you go. Ask it to read the [instructions for agents](AGENTS.md) first; they cover
the project structure, validation commands, licensing rules, and boundaries
around credentials, paid services, and deployment.

### Run the frontend

The current frontend is a polished demonstration experience built with Next.js,
TypeScript, Motion, Three.js, and [Spark.js](https://sparkjs.dev/). Its sample
edition is explicitly fictional and requires no API keys. Without a splat asset,
it displays the generated source image as a poster; set the optional public
`NEXT_PUBLIC_WORLD_SPLAT_URL` described in `frontend/.env.example` to activate
the interactive Gaussian-splat viewer.

You will need Node.js 20.9 or newer and npm.

```bash
cd frontend
npm i
npm start
```

Then open [http://localhost:3000](http://localhost:3000). Environment variables
needed by future integrations will be documented in `frontend/.env.example`;
never commit a populated `.env` file.

### Run the panorama pipeline

The first pipeline utility generates a 360-degree equirectangular image, repairs
its longitude seam, and prepares an 8192 × 4096 delivery asset. See the
[pipeline guide](pipeline/README.md) for setup, dry-run, and validation commands.

## Contributing

Contributions are welcome across the frontend, editorial system, source and
generation adapters, cloud infrastructure, accessibility, documentation, and
entirely new ways of using the pattern. Read [CONTRIBUTING.md](CONTRIBUTING.md)
before opening an issue or pull request.

## License and providers

Original code in this repository is released under the [MIT License](LICENSE).
Direct runtime dependencies must use approved permissive open-source licenses;
the dependency graphs are enforced by `npm run license:check` in `frontend/` and
`pipeline/`. See [Third-Party Notices](THIRD_PARTY_NOTICES.md) and the full
[licensing and service-boundary policy](docs/LICENSING.md).

The reference deployment is being designed for AWS, but cloud-specific code will
remain behind replaceable interfaces so contributors can add other providers.
AWS, Google Gemini/Nano Banana, and World Labs Marble are proprietary hosted
services and are not covered by the repository's MIT license. Users enable those
adapters with their own accounts, credentials, billing, and acceptance of the
providers' current terms. The local fixture-driven frontend requires none of
those credentials.
