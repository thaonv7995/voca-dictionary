FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig*.json vite.config.ts ./
COPY src ./src
COPY packages ./packages
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY --from=build /app/dist/ ./dist/
COPY scripts/server.mjs ./
RUN mkdir -p ./data/cards ./data/audio

ENV PORT=80
ENV APP_DIST=/app/dist
ENV VOCA_DATA=/voca-data
EXPOSE 80

CMD ["node", "server.mjs"]
