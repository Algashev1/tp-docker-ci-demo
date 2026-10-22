#!/bin/sh
# Pull-деплой: сервер сам забирает новую версию.
# Запускается по cron раз в 2 минуты (см. deploy/cloud-init.yaml).
set -e
cd /opt/app
REPO=https://raw.githubusercontent.com/Algashev1/tp-docker-ci-demo/main
curl -fsSL "$REPO/docker-compose.yml" -o docker-compose.yml
docker compose pull -q
docker compose up -d --no-build --remove-orphans
docker image prune -f > /dev/null
