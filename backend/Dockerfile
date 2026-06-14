# Ops Monitor — backend API (Bun + Hono + Drizzle)
# Build context: ./backend
FROM oven/bun:1-alpine
WORKDIR /app

# Install deps first for better layer caching. bun.lock pins versions;
# devDeps (incl. drizzle-kit) are included so `db:push` works in-container.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source
COPY . .

# Uploaded floor-plan images land here (mounted to a named volume in compose)
RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "src/index.ts"]
