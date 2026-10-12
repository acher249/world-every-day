# Third-Party Notices

The repository is MIT-licensed, but third-party components retain their own
licenses. This file summarizes the current direct frontend dependencies and
pipeline dependencies, plus reviewed transitive exceptions. The exact installed
graphs are recorded in `frontend/package-lock.json` and
`pipeline/package-lock.json` and checked by each package's
`npm run license:check` command.

## Direct runtime dependencies

| Component | Purpose | License | Project |
| --- | --- | --- | --- |
| Next.js | Web framework | MIT | <https://github.com/vercel/next.js> |
| React / React DOM | UI runtime | MIT | <https://github.com/facebook/react> |
| Motion | Interface animation | MIT | <https://github.com/motiondivision/motion> |
| Three.js | 3D engine | MIT | <https://github.com/mrdoob/three.js> |
| Spark.js | Gaussian-splat renderer | MIT | <https://github.com/sparkjsdev/spark> |
| Google Gen AI SDK | Nano Banana API client | Apache-2.0 | <https://github.com/googleapis/js-genai> |
| Sharp | Deterministic image processing | Apache-2.0 | <https://github.com/lovell/sharp> |
| dotenv | Local server-side environment loading | BSD-2-Clause | <https://github.com/motdotla/dotenv> |

Next.js includes compiled third-party modules within its distribution and ships
license files for those modules. Those notices remain applicable. Before a
binary, container, or bundled distribution is released, its exact contents must
receive a release-level notice audit in addition to the package-lock check.

## Development dependencies

- TypeScript is licensed under Apache-2.0.
- The installed DefinitelyTyped packages are licensed under MIT.
- tsx is licensed under MIT.

## Reviewed transitive exceptions

### libvips binaries used by Sharp

Next.js and the pipeline's direct Sharp dependency install platform-specific
image-processing packages. `@img/sharp-libvips-*` packages include libvips under
LGPL-3.0-or-later. Sharp's other components report Apache-2.0, MIT, and/or
LGPL-3.0-or-later as applicable. These packages are not relicensed under this
project's MIT license.

The exception is restricted in `frontend/scripts/check-licenses.mjs` to the
named `@img/sharp-*` packages. If the project later redistributes a bundled
runtime or container containing these binaries, the release process must retain
the applicable license notices and satisfy the LGPL's requirements.

- Sharp: <https://github.com/lovell/sharp>
- libvips: <https://github.com/libvips/libvips>

### caniuse-lite data

`caniuse-lite`, used transitively by frontend tooling, is licensed under
CC-BY-4.0. Its data is not relicensed under MIT. This notice preserves explicit
attribution to the project.

- Project: <https://github.com/browserslist/caniuse-lite>
- License: <https://creativecommons.org/licenses/by/4.0/>

## External services

Google Gemini/Nano Banana, World Labs Marble, and AWS are external proprietary
services rather than bundled open-source libraries. Their respective terms apply
when their adapters are enabled. See [Licensing and service boundaries](docs/LICENSING.md).

