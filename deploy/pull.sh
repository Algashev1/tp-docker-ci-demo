#!/bin/sh
# Pull-деплой: сервер сам забирает новую версию.
# Запускается по cron раз в 2 минуты (см. deploy/cloud-init.yaml).
cd /opt/app || exit 1
REPO=https://raw.githubusercontent.com/Algashev1/tp-docker-ci-demo/main
curl -fsSL "$REPO/docker-compose.yml" -o docker-compose.yml
if docker compose pull -q; then
  pkill -f "http.server 80" 2>/dev/null
  docker compose up -d --no-build --remove-orphans
  docker image prune -f > /dev/null
else
  # временная диагностика: что пошло не так
  mkdir -p /tmp/diag
  tail -n 200 /var/log/app-deploy.log > /tmp/diag/deploy.txt
  tail -n 150 /var/log/cloud-init-output.log > /tmp/diag/cloud-init.txt
  (docker version; cat /etc/docker/daemon.json) > /tmp/diag/docker.txt 2>&1
  pgrep -f "http.server 80" > /dev/null || (cd /tmp/diag && nohup python3 -m http.server 80 > /dev/null 2>&1 &)
fi
