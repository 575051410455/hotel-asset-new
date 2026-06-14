# Ops Monitor — frontend SPA (React + Vite), served by a small nginx.
# Build context: ./frontend
#
# Stage 1 builds the static bundle. We run `vite build` directly: the type-check
# (`tsc -b`) is a CI gate, and the app's `@backend/*` imports are type-only, so
# the backend isn't needed at build time. The SPA calls the API at a relative
# `/api`, so there is NO build-time API URL / env to inject.

# ---------- stage 1: build ----------
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx vite build          # outputs /app/dist

# ---------- stage 2: serve ----------
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
