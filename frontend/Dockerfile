# стадия 1: сборка
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# стадия 2: раздача
FROM nginx:1.27-alpine
LABEL org.opencontainers.image.source=https://github.com/Algashev1/tp-docker-ci-demo
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
