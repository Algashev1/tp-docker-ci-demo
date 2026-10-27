# Локальная проверка проекта

В Сфера.Коде нет CI, поэтому проверки можно запускать у себя. Все инструменты бесплатные.
Если у команды есть зеркало на GitHub (лекция 6), достаточно скопировать job `security`
из [ci.yml](../../.github/workflows/ci.yml).

## 1. Секреты - gitleaks

Ищет пароли, ключи и токены в файлах и во всей истории коммитов.

```bash
# через Docker, ничего не устанавливая
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo -v
```

Нашёл секрет? Удалите из кода **и смените** ключ/пароль: он уже остался в истории.

## 2. Зависимости

Python:

```bash
pip install pip-audit
pip-audit -r requirements.txt
```

JavaScript / TypeScript:

```bash
npm audit
npm audit fix        # обновит то, что можно обновить без ломающих изменений
```

## 3. Опасные места в коде

Python - bandit:

```bash
pip install bandit
bandit -r app/       # путь к вашему коду
```

JS/TS и другие языки - semgrep:

```bash
docker run --rm -v "$PWD:/src" semgrep/semgrep semgrep scan --config auto
```

## 4. Docker-образы и файлы проекта - trivy

```bash
docker run --rm -v "$PWD:/src" aquasec/trivy fs /src --severity HIGH,CRITICAL
docker run --rm aquasec/trivy image имя-вашего-образа:latest
```

## Как читать результаты

- **CRITICAL / HIGH** - заводите дефект с высоким приоритетом.
- **MEDIUM / LOW** - в бэклог, обновить при случае.
- Ложное срабатывание (например, тестовый пароль в `.env.example`) - разберитесь и
  отметьте в настройках инструмента, не отключайте проверку целиком.
