# Halloween — графіка та джерела

Дата: **26.10.2026**. Графіка створена вбудованим інструментом **imagegen**, без CLI/API-скриптів. Стильовий референс обох генерацій: [початковий ескіз поля](concepts/obs-board.png). Це окремі ресурси, підключені до робочого HTML/CSS; скриншоти нижче отримані з браузера.

## Файли

| Ресурс | Призначення |
| --- | --- |
| [haunted-night.png](../../public/themes/halloween/assets/haunted-night.png) | Фон: замок, місяць, кажани, дерева, павутиння, свічки й туман |
| [pumpkin-candles.png](../../public/themes/halloween/assets/pumpkin-candles.png) | Гарбуз зі свічками, PNG з прозорістю; логотипна емблема та кути камер |
| [cobweb.svg](../../public/themes/halloween/assets/cobweb.svg) | Декоративне павутиння на рамках, створене кодом SVG |
| [Creepster-Regular.ttf](../../public/themes/halloween/fonts/Creepster-Regular.ttf) | Локальний шрифт англомовного заголовка; решта тексту — Georgia з кирилицею |
| [OFL.txt](../../public/themes/halloween/fonts/OFL.txt) | Ліцензія шрифту з офіційного репозиторію |

Джерело шрифту й ліцензії: [Google Fonts — Creepster](https://github.com/google/fonts/tree/main/ofl/creepster). Під час показу сторінки шрифт завантажується з власного сервера, звернення до Google Fonts не потрібне.

## Промпт фону

```text
Use case: stylized-concept. Asset type: production background texture for a real HTML/CSS Halloween quiz broadcast UI, NOT a screenshot, NOT a mockup. Use the attached image only as the artistic style reference. Generate a wide 16:9 illustration, ideally 1920x1080 or larger.

Create ONLY the atmospheric Halloween scene that belongs BEHIND the reference interface: a deep midnight violet night, a haunted Gothic castle silhouette with pointed towers along the TOP CENTER-RIGHT horizon, a large pale lavender full moon in the upper center-right, a few bats silhouetted near the moon, bare twisted trees at the outside edges, fine realistic spiderwebs in both upper corners, glowing slender candles and tiny jack-o-lanterns constrained to the far left and right edge, and low subtle rolling fog at the very bottom. Detailed painterly realistic spooky cinematic art with rich black shadows and warm orange candlelight, elegant premium television broadcast graphics. Gothic festive Halloween, no gore.

Very important functional composition: all central 90% of the screen below the top 12% must stay very dark near-black charcoal purple with only subtle smoky texture, because opaque live game panels will cover it. Most visible scenic detail and the castle/moon must sit in the top 12% header band, with tiny atmospheric detail in the outermost 2% edges. Keep the moon and castle in the x55%-75% range so a logo can occupy the top left. Small candles along the outermost edges, no big objects over central content. Fine cobwebs in corners only. Subtle ornamental environment around the entire perimeter, not repetitive wallpaper. Preserve the exact rich Halloween mood of the reference.

Do not include ANY text, logos, numbers, board tiles, camera frames, user interface, people, faces, player cards or cards of any kind. It must be a clean background asset ready to go behind editable web UI.
```

## Промпт прозорої емблеми

Параметр `transparent_background: true`.

```text
Use case: stylized-concept. Asset type: a single production transparent PNG decorative emblem for a real Halloween broadcast UI. The attached image is the artistic style reference only. Generate a square, isolated cutout with genuine transparent alpha background. A beautifully detailed realistic orange carved jack-o-lantern with mischievous triangular eyes and a jagged smile glowing from within, curved dark woody stem, and two small ivory dripping wax candles nestled at its lower left. One tiny dark autumn leaf at the base. Elegant semi-realistic painterly game UI decoration matching the pumpkin and candle lighting in the reference. Three-quarter view, realistic ridged pumpkin skin, warm amber candle glow, deep purple reflected shadows. Arrange as a compact readable emblem that can be used at 100px tall next to a title or at the corner of a player frame. Full pumpkin and flame tips visible, no crop. Restrained soft orange glow directly around the object, no rectangular backdrop, no floor plane, no scenery, no fog filling the image, no text, no border or UI frame, no people. Object fills about 85% of the square with clean transparent padding.
```

## Фактична реалізація

- [Поле OBS](previews/obs-board.png).
- [Фото-питання OBS](previews/obs-photo.png).

Люди з початкового згенерованого ескізу не використовуються як камери. Вікна залишаються місцями для реальних джерел OBS. Статичний фон та декор не впливають на ігрові правила.
