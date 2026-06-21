# Matrix compatibility backend

This is a first compatibility spike for running tweb against a Matrix homeserver instead of Telegram MTProto.

Enable it only for local experiments:

```bash
cp .env.matrix.example .env.local
pnpm start
```

Do not deploy a build made with `VITE_MATRIX_ACCESS_TOKEN`. Vite embeds that value into the frontend bundle. It exists only to bring up the adapter before a native Matrix login flow is wired into tweb.

Implemented API surface:

- `help.getConfig`
- `help.getAppConfig`
- `updates.getState`
- `users.getUsers`
- `messages.getDialogs`
- `messages.getHistory`
- `messages.sendMessage`

The adapter maps Matrix room ids and event ids to stable Telegram-like numeric ids in memory. That is enough for an initial UI bring-up, but it is not yet a durable storage model.

Known missing pieces:

- native Matrix login UI
- media upload/download integration with tweb document/photo managers
- encrypted rooms
- typing/read receipts/reactions
- membership changes and live `/sync` update loop
- durable id mapping across sessions
