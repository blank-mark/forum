# Школьный форум

## Файлы
- `index.html` — вход
- `register.html` — регистрация и добавление ника
- `feed.html` — лента
- `profile.html` — профиль
- `messenger.html` — сообщения
- `hashtags.html` — хештеги
- `app.js` — вся логика Firebase
- `styles.css` — общий стиль
- `firestore.rules` — правила Firestore
- `images/` — иконки

## Иконки и названия
Все иконки лежат в `images/`. У них одинаковый размер: `24x24` внутри SVG и они отображаются в интерфейсе как `22x22`.

Используемые файлы:
- `home.svg`
- `hashtags.svg`
- `messages.svg`
- `profile.svg`
- `logout.svg`
- `like.svg`
- `like-filled.svg`
- `repost.svg`
- `view.svg`
- `send.svg`
- `plus.svg`
- `search.svg`
- `edit.svg`
- `save.svg`
- `close.svg`
- `menu.svg`
- `pin.svg`

## Что делает сайт
- посты с лайками, комментариями, просмотрами и репостами
- репосты не создают новый пост в ленте, они остаются только в профиле
- комментарии свернуты по умолчанию и показывают 5 самых популярных
- хештеги ищутся через `#`
- есть уведомление о новых сообщениях
- аватар можно рисовать на профиле в мини-пейнте

## Что нужно включить в Firebase
- Authentication: Email/Password и Google
- Firestore Database
- Rules из `firestore.rules`
