# Native encoder is a separate process, never linked into project code.
FROM public.ecr.aws/lambda/nodejs:24 AS codecs
RUN dnf install -y gcc gcc-c++ make perl tar gzip xz curl-minimal pkgconf-pkg-config zlib-devel && dnf clean all
WORKDIR /build
COPY src/video/encoder/build-codecs.sh .
RUN bash build-codecs.sh

FROM public.ecr.aws/lambda/nodejs:24 AS application
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
RUN ./node_modules/.bin/esbuild src/video/assemble-handler.ts --bundle --platform=node --target=node24 --format=cjs --outfile=index.js

FROM public.ecr.aws/lambda/nodejs:24
COPY --from=codecs /opt/video /opt/video
COPY --from=application /build/index.js ${LAMBDA_TASK_ROOT}/index.js
ENV LD_LIBRARY_PATH=/opt/video/lib:/var/lang/lib:/lib64:/usr/lib64:/var/runtime:/var/task:/var/task/lib
ENV VIDEO_FFMPEG=/opt/video/bin/ffmpeg VIDEO_FFPROBE=/opt/video/bin/ffprobe
CMD ["index.main"]
