# Changelog

All notable changes to this project will be documented in this file.

## [0.4.1] - 2026-11-02

### Fixed

- `mot daemon stop` on macOS now waits until the service process actually exits (polling `launchctl print`, ~10s timeout with a clear error) instead of returning right after SIGTERM, so `mot daemon stop && mot daemon start` reliably restarts the service

### Docs

- Rewrote the README as a GitHub landing page: quick start, `/mot` command table, voice transcription, configuration reference, and pi-tag migration

## [0.4.0] - 2026-11-02

### Changed

- **Breaking:** the Slack slash command is now `/mot` (was `/pi`); update the command in your Slack app (the bundled manifest already uses `/mot`)
- Default trigger name is `mot`; the manifest names the app and bot user Mot
- Removed the fallback to legacy `pitag` config/data directories and `PITAG_CONFIG`; use `mot/` and `MOT_CONFIG`

## [0.3.1] - 2026-11-02

### Changed

- Releases are published via npm trusted publishing (GitHub Actions OIDC); the long-lived `NPM_TOKEN` secret is no longer used

## [0.3.0] - 2026-11-02

First release as **Mot**, a fork of [pi-tag](https://github.com/Crokily/pi-tag) 0.2.1.

### Changed

- Renamed to Mot: npm package `@zephyrdeng/mot`, command `mot`, config variable `MOT_CONFIG`, service `mot` / `com.mot`, config/data directories `mot/`
- Legacy `pitag` config/data directories and `PITAG_CONFIG` are still honored when no `mot` equivalent exists
- Busy reaction replaced with Slack's native thread status indicator

### Added

- `/pi bind [dir]` registers a channel and its working directory from Slack (admins)
- Audio attachments are transcribed via ZenMux ASR when `ZENMUX_API_KEY` is set (process env or `config.env`)

### Fixed

- Model catalog works with the pi-coding-agent 1.x SDK surface

## [0.2.1] - 2026-07-12

### Changed

- README rewritten around what you can do from Slack — user features and experience first, architecture and ops reference in the back half
- Slack app manifest description updated to match

## [0.2.0] - 2026-07-12

### Added

- Interactive Block Kit control panel: a bare `/pi` now opens an ephemeral panel with session status at a glance, model and thinking-level dropdowns (picked straight from pi's catalog — no more typing model refs), and confirmed New session / Stop buttons. Works over Socket Mode with no manifest changes; existing apps get it on gateway upgrade.
- `/pi help` shows the text usage (previously shown by a bare `/pi`).

## [0.1.0] - 2026-07-12

Initial release. Forked from [piscord](https://github.com/Crokily/pi-discord-gateway) v1.6.1 and ported from Discord to Slack.

### Added

- Slack Socket Mode gateway built on `@slack/bolt` — outbound WebSocket only, no public URL or inbound ports required
- App manifest (`manifest.yaml`) for one-step Slack app creation with the minimal bot scope set
- Per-channel pi sessions (`sl:<channelId>`) backed by the SQLite message queue with crash recovery and abort support
- Channel access policies (`open` / `open-trigger` / `allowlist`, default `allowlist`) and DM policy (`DM_POLICY`: `open` / `allowlist` / `disabled`, default `open`)
- Thread-aware replies (`REPLY_IN_THREAD`, default `true`): responses to messages inside a thread post back to that thread while sharing the channel session
- Global `/pi` slash command with text subcommands: `status` | `model <ref>` | `models` | `reset-model` | `thinking <level>` | `new` | `stop`
- Markdown responses via `chat.postMessage` `markdown_text` with automatic 4,000-character splitting and per-channel outbound pacing
- Busy indicator via hourglass reaction on the triggering message (Slack has no bot typing indicator)
- Attachment relay: `url_private` downloads authenticated with the bot token, passed to pi by local path
- Outbound files via Slack's three-step external upload (`files.getUploadURLExternal` → upload → `files.completeUploadExternal`)
- `pitag send` — text and file relay to any Slack channel over the Web API, no running gateway required
- File delivery from pi: each prompt teaches pi to share files via `pitag send`, and any `file://` reference left in a response is detected, validated against size limits, and uploaded as a native Slack attachment
- Bare trigger-name summons: `Coly fix this` works the same as `@Coly fix this` (prefix-only match)
- Rate-limited registration hint when the bot is @mentioned in an unregistered channel or DMed under `DM_POLICY=allowlist`
- Scheduled tasks (cron or one-time) that trigger pi sessions on schedule
- Interactive setup wizard (`pitag setup`), status diagnostics, and cross-platform daemon management (systemd/launchd) under the `pitag` service name
- Config file at `~/.config/pitag/config.env` (platform-aware), overridable via `PITAG_CONFIG`; Slack token validation (`xoxb-` / `xapp-` prefixes) at startup
