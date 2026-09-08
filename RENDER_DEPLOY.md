# Деплой на Render — покроково

## Варіант A: через GitHub + Render Blueprint
1. Створіть новий репозиторій на GitHub.
2. Завантажте **весь вміст цієї папки** в корінь репозиторію. Важливо: `server.js`, `package.json` і `render.yaml` мають бути в корені.
3. У Render відкрийте **New → Blueprint**.
4. Підключіть GitHub і виберіть цей репозиторій.
5. Render прочитає `render.yaml` і запропонує створити Web Service `svoja-gra-kinohardkor`.
6. Натисніть **Deploy Blueprint**.
7. Після успішного деплою Render дасть адресу на кшталт `https://svoja-gra-kinohardkor.onrender.com`.

## Готові адреси
Якщо ваш базовий URL — `https://svoja-gra-kinohardkor.onrender.com`, тоді:
- ведучий: `https://svoja-gra-kinohardkor.onrender.com/host`
- гравці: `https://svoja-gra-kinohardkor.onrender.com/play`
- OBS: `https://svoja-gra-kinohardkor.onrender.com/screen/ABCD`
- перевірка сервера: `https://svoja-gra-kinohardkor.onrender.com/health`

`ABCD` замініть на код кімнати, який покаже `/host`.

## OBS
1. Sources → `+` → Browser Source.
2. URL: `https://ВАШ-САЙТ.onrender.com/screen/КОД`.
3. Width: `1920`.
4. Height: `1080`.
5. За потреби увімкніть `Refresh browser when scene becomes active`.

## Важливо для free instance
Безкоштовний Render Web Service може засинати після періоду бездіяльності. Перед грою відкрийте `/host` і дочекайтеся завантаження, а вже потім запрошуйте гравців.

## Стан кімнати
У v1.2.5 кімната зберігається в оперативній пам'яті одного server instance. Якщо Render перезапустить instance або ви зробите новий deploy під час гри, активна кімната буде втрачена. Не запускайте deploy під час ефіру.
