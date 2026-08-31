# Needs a real `git` binary, which no zip-packaged Lambda runtime ships and the AgentCore Code
# Interpreter sandbox this replaced didn't have either (confirmed live — see
# services/tools/github/src/handler.ts's header comment). The Lambda Node.js base image is Amazon
# Linux 2023, so `dnf` is available even though the function itself is plain Node.
#
# Build context must be the monorepo ROOT (not this directory) — this Dockerfile reaches up to
# tsconfig.base.json the same way every other package's tsconfig.json does. See infra/api.ts's
# `ToolGithubCodingAgent` for the `context`/`dockerfile` wiring.

FROM public.ecr.aws/lambda/nodejs:20 AS build
WORKDIR /build
COPY tsconfig.base.json ./
COPY services/tools/github-coding-agent/package.json services/tools/github-coding-agent/tsconfig.json services/tools/github-coding-agent/
COPY services/tools/github-coding-agent/src services/tools/github-coding-agent/src
WORKDIR /build/services/tools/github-coding-agent
# No lockfile in this build (the pnpm workspace lockfile lives at the repo root and isn't
# meaningful to a single-package `npm install`) — resolves fresh against the ranges in
# package.json. Pin exact versions there if this ever needs to be reproducible.
RUN npm install && npx tsc

FROM public.ecr.aws/lambda/nodejs:20
RUN dnf install -y git && dnf clean all
COPY --from=build /build/services/tools/github-coding-agent/node_modules ${LAMBDA_TASK_ROOT}/node_modules
COPY --from=build /build/services/tools/github-coding-agent/dist/ ${LAMBDA_TASK_ROOT}/
COPY services/tools/github-coding-agent/package.json ${LAMBDA_TASK_ROOT}/

CMD ["handler.handler"]
