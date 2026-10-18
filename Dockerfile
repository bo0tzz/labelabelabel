FROM node:24-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 BODY_SIZE_LIMIT=20M
# Each falls back to the request's own values when a proxy doesn't send the header.
ENV PROTOCOL_HEADER=x-forwarded-proto HOST_HEADER=x-forwarded-host
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY drizzle ./drizzle
COPY fonts ./fonts
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "build"]
