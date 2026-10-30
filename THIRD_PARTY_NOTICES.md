# Third-Party Notices

The repository is MIT-licensed, but third-party components retain their own
licenses. This file summarizes the current direct frontend, marketing, pipeline, and AWS
infrastructure dependencies, plus reviewed transitive exceptions. Exact
installed graphs are recorded in each package's `package-lock.json` and checked
by its `npm run license:check` command.

## Direct runtime dependencies

| Component | Purpose | License | Project |
| --- | --- | --- | --- |
| Next.js | Web framework | MIT | <https://github.com/vercel/next.js> |
| React / React DOM | UI runtime | MIT | <https://github.com/facebook/react> |
| Motion | Interface animation | MIT | <https://github.com/motiondivision/motion> |
| Three.js | 3D engine | MIT | <https://github.com/mrdoob/three.js> |
| Spark.js | Gaussian-splat renderer | MIT | <https://github.com/sparkjsdev/spark> |
| Radix | Optional WebGPU Gaussian-splat renderer | MIT | <https://github.com/sparkjsdev/radix> |
| Zod | Artifact validation | MIT | <https://github.com/colinhacks/zod> |
| fast-xml-parser | RSS and Atom parsing | MIT | <https://github.com/NaturalIntelligence/fast-xml-parser> |
| node-html-parser | Shortlisted article text extraction | MIT | <https://github.com/taoqf/node-fast-html-parser> |
| Google Gen AI SDK | Gemini editorial, Nano Banana, and generated-image landmark API client | Apache-2.0 | <https://github.com/googleapis/js-genai> |
| Sharp | Deterministic image processing | Apache-2.0 | <https://github.com/lovell/sharp> |
| Puppeteer Core | Headless browser control for private interaction baking | Apache-2.0 | <https://github.com/puppeteer/puppeteer> |
| @sparticuz/chromium | Lambda-compatible Chromium packaging | MIT | <https://github.com/Sparticuz/chromium> |
| dotenv | Local server-side environment loading | BSD-2-Clause | <https://github.com/motdotla/dotenv> |
| AWS SDK for JavaScript v3 | Optional S3, DynamoDB, Secrets Manager, and Bedrock adapters | Apache-2.0 | <https://github.com/aws/aws-sdk-js-v3> |
| AWS CDK | AWS infrastructure definitions | Apache-2.0 | <https://github.com/aws/aws-cdk> |
| Constructs | Construct programming model used by AWS CDK | Apache-2.0 | <https://github.com/aws/constructs> |

Next.js includes compiled third-party modules within its distribution and ships
license files for those modules. Those notices remain applicable. Before a
binary, container, or bundled distribution is released, its exact contents must
receive a release-level notice audit in addition to the package-lock check.

## Development dependencies

- TypeScript is licensed under Apache-2.0.
- The installed DefinitelyTyped packages are licensed under MIT.
- tsx is licensed under MIT.
- esbuild is licensed under MIT.
- The AWS CDK CLI is licensed under Apache-2.0.

## GitHub link icon

The marketing site's GitHub link uses the [Primer Octicons GitHub mark](https://github.com/primer/octicons/blob/main/icons/mark-github-16.svg), copyright GitHub, Inc. It links only to this project's GitHub repository. The mark remains a [GitHub trademark](https://brand.github.com/foundations/logo) and is not the project's logo.

## Reviewed transitive exceptions

The optional Radix renderer's published dependency metadata includes these
reviewed packages. The installed license metadata is checked by the frontend
license script, with narrowly scoped exceptions for the exact versions below:

- `argparse@2.0.1` uses Python-2.0, a permissive license. Retain its upstream
  license and notices when redistributing the package.
- `opener@1.5.2` offers WTFPL or MIT. This project elects the included MIT
  license option.
- `union@0.5.0` omits license metadata, but its included `LICENSE` file is MIT.

The serverless Chromium package's MIT license covers its packaging code.
The browser and its bundled components retain their respective licenses.
Preserve applicable notices when distributing Lambda artifacts. Chromium is
used for private interaction baking and video capture.

### Video container operating system

The encoder uses AWS's Node.js 24 Lambda base image. Its Amazon Linux packages
include GPL utilities (such as Bash and coreutils), LGPL system libraries, and
MPL-2.0 data, alongside permissively licensed components. These are separate
system components, not MIT-licensed project code. The image retains system
notices under `/usr/share/licenses` and runtime notices under
`/var/runtime/THIRD-PARTY-LICENSES.txt`.

The npm checks do not scan the base image. Before distributing a container,
inventory its exact OS packages and preserve their notices and any required
corresponding source. Updating the base-image tag can change that inventory.

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

### AWS CDK transitive license metadata

AWS CDK currently depends on `case`, whose package metadata offers a choice of
MIT or GPL-3.0-or-later. This project uses it under the included MIT license.
AWS CDK also depends on `minimatch`, licensed under the permissive Blue Oak Model
License 1.0.0. The infrastructure license checker restricts these exceptions to
those named transitive packages and exact reported licenses.

- case: <https://github.com/nbubna/Case>
- minimatch: <https://github.com/isaacs/minimatch>
- Blue Oak Model License: <https://blueoakcouncil.org/license/1.0.0>

## External services

### Optional video encoder

The optional assembly Lambda runs FFmpeg 8.0.1 as a separate executable under
LGPL-2.1-or-later. This reviewed native exception is necessary to assemble,
validate, and encode archived WebM and X-compatible MP4 video. It is dynamically
linked; the project does not link FFmpeg into its JavaScript code. GPL/nonfree
features and libx264 are disabled. The native build policy is checked by
`pipeline/scripts/check-licenses.mjs` and the container verifies its license.

The encoder also uses OpenH264 2.6.0 (BSD-2-Clause), libvpx 1.15.2 (BSD-3-Clause),
Opus 1.5.2 (BSD-3-Clause), and the platform's zlib. Source URLs, exact checksums,
and build commands are in `pipeline/src/video/encoder/build-codecs.sh`.
The container retains source archives/build instructions in `/opt/video/sources`
and license notices in `/opt/video/licenses`. Keep these when redistributing
the container, preserve replacement/relinking rights, and comply with the
included licenses. Codec patent obligations are separate; a source-built
OpenH264 library does not inherit Cisco's binary-distribution patent coverage.

- FFmpeg: <https://ffmpeg.org/legal.html>
- OpenH264: <https://github.com/cisco/openh264>
- libvpx: <https://github.com/webmproject/libvpx>
- Opus: <https://opus-codec.org/license/>

Google Gemini/Nano Banana, World Labs Marble, X, and AWS are external proprietary
services rather than bundled open-source libraries. Their respective terms apply
when their adapters are enabled. See [Licensing and service boundaries](docs/LICENSING.md).

The marketing page optionally loads X's hosted post widget. This is not bundled
MIT-licensed code; X's [embed terms](https://help.x.com/en/using-x/how-to-embed-a-post)
and [privacy policy](https://x.com/en/privacy) apply.


## Video capture fonts

The optional capture build bundles unmodified Noto Serif, Noto Sans Symbols, and Noto Sans Symbols 2
from [Google Fonts](https://github.com/google/fonts), copyright 2022 The Noto
Project Authors, under SIL Open Font License 1.1. These provide serif text and
arrow symbols on Lambda. Their license texts and source/checksum provenance live
in `frontend/public/capture/fonts/`. They are not fetched at runtime.
