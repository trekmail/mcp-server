# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Stage 2: Runtime
FROM node:22-alpine
WORKDIR /app
RUN addgroup -S mcp && adduser -S mcp -G mcp

COPY --from=builder /app/build/ build/
COPY --from=builder /app/node_modules/ node_modules/
COPY package.json ./

USER mcp
ENTRYPOINT ["node", "build/index.js"]
