# Render — v1.5.0

Для справді постійної статистики рекомендовано PostgreSQL.

1. Створіть PostgreSQL database.
2. У Render Web Service → Environment додайте `DATABASE_URL`.
3. Deploy latest commit.
4. Перевірте `/health` (version 1.5.0) та `/seasons`.

Таблиці створюються автоматично.

Альтернатива: Persistent Disk + `DATA_DIR=/var/data`.
Без PostgreSQL або Persistent Disk локальний JSON може зникнути після redeploy/restart.
