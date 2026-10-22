# Демо: Docker + CI для курса «Технологии программирования»

Учебный проект: бэкенд (FastAPI), фронтенд (nginx) и PostgreSQL в docker compose, проверка в GitHub Actions.

## Запуск

```bash
cp .env.example .env
docker compose up -d --build
```

- Сайт: http://localhost:3000
- API: http://localhost:8080/health

## Запуск готовой версии без сборки

После каждого зелёного прогона в `main` образы публикуются в GitHub Container Registry:

```bash
cp .env.example .env
docker compose pull backend frontend
docker compose up -d --no-build
```

## Тесты

```bash
docker compose exec backend pytest -v
```
