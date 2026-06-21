# Matrix-first fork of tweb

## Summary

Rewrite the current Matrix compatibility layer as a Matrix-first client. Keep the Telegram frontend as the visual shell, but stop pretending that Matrix data is MTProto. The first working v1 covers auth, dialogs, DM/group/saved history, sending, message statuses, avatars, names, and online/presence. Everything outside that scope is temporarily disabled through centralized capabilities.

## Key Changes

- Introduce a Matrix core layer instead of the current `MatrixApiManager` method switch:
  - `MatrixSession`: homeserver, access token, device id, user id, login/logout/restore.
  - `MatrixSyncStore`: `/sync`, room timelines, members, receipts, presence, account data.
  - `MatrixRoomStore`: DM, group, saved messages classification.
  - `MatrixSendQueue`: optimistic send, retry/failure, reconciliation by `txnId` and Matrix `event_id`.
  - `MatrixProfileStore`: profile/member display name, avatar, presence.

- Auth flow:
  - v1 uses password login against a Matrix homeserver, defaulting to `https://rix.takasaki.moe`.
  - Persist session in existing local app storage/IndexedDB.
  - Remove env-only Matrix login as the primary flow; keep token import only as a hidden dev fallback if useful.

- Native IDs:
  - Use Matrix IDs directly: `@user:server`, `!room:server`, `$event:server`, and local `txnId`.
  - Remove hash-based numeric identity as a data source.
  - Allow numeric shims only at legacy UI boundaries that still hard-require numbers, with explicit conversion helpers and no persistent identity decisions.

- Chat model:
  - DM: use `m.direct` and member count/direct account data.
  - Groups: joined Matrix rooms are displayed as normal group chats, with no Telegram channel semantics.
  - Saved Messages: explicit saved-room mapping. Bootstrap by detecting/sending a marker message like `exp:saved-pair`, then store that `roomId` as the saved room for the current account.
  - Temporarily hide channel, broadcast, and public-channel behavior.

- Sending and statuses:
  - Sending uses Matrix `/rooms/{roomId}/send/m.room.message/{txnId}` directly.
  - UI immediately renders a local pending message.
  - On sync echo, match by `unsigned.transaction_id`/`txnId` or content fallback, then replace pending with the server `event_id`.
  - Statuses are `pending`, `sent`, `failed`, and `read`.
  - Read state uses Matrix read receipts/read markers, following FluffyChat's pattern: only mark read when chat is active, foregrounded, and not scrolled up.

- Profiles, avatars, online:
  - Follow FluffyChat behavior: room member `displayname/avatar_url` wins inside a room, global `/profile/{userId}` is fallback.
  - Avatars use `mxc://` media thumbnail/download URLs.
  - Presence uses `/presence/{userId}/status` plus sync presence events; map online/unavailable/offline to Telegram-looking UI labels without showing `Deleted Account`.

- Disable non-v1 features through one capabilities object:
  - Disable/hide reactions, custom emoji, stickers, gifts, stars, premium, sponsored messages, contacts, Telegram stories, Telegram channels, and paid features.
  - UI gates must prevent both visible controls and background API calls, so the console stops showing `MATRIX_METHOD_UNIMPLEMENTED` for disabled features.

## Test Plan

- Run `pnpm test` and targeted new Vitest tests for:
  - Matrix ID parsing/storage with native string IDs.
  - saved-room marker detection and persistence.
  - send queue pending/sent/failed reconciliation.
  - profile/member avatar/name precedence.
  - read receipt/status mapping.

- Run `pnpm run build` after each major slice.

- Manual smoke on `http://localhost:8081`:
  - login with Matrix password flow.
  - current user settings show real Matrix display name/username, not `Deleted Account`.
  - DM opens by Matrix user ID and sends without long delay.
  - Saved Messages maps to the explicit saved room and sends there.
  - group room opens and shows history.
  - no visible reactions/stickers/premium/stars/gifts/contacts/channel controls.
  - console has no unimplemented Matrix method errors during core chat usage.

## Assumptions

- This is a full frontend fork toward Matrix-first internals, not another Telegram API adapter cleanup.
- v1 supports DM, groups, and saved messages only.
- Channels are temporarily removed from product behavior.
- Capabilities gates are preferred over hard deletion so disabled features can be restored later.
- `exp:saved-pair` marker is acceptable as the explicit saved-room bootstrap mechanism.
