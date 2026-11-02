FROM node:22-bookworm-slim AS deps

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN npm ci
# Prisma 7 loads prisma.config.ts during generation and requires the variable
# to exist, although generation itself does not connect to PostgreSQL.
RUN DATABASE_URL=postgresql://devsage:build-only@localhost:5432/devsage npx prisma generate

FROM deps AS build

COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 4000
CMD ["npm", "start"]
