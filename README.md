<p align="center">
  <img src="assets/perch-logo.svg" alt="Perch" width="112" height="124" />
</p>

<h1 align="center">perch</h1>

<p align="center"><em>For your flock of agents — the place they gather between flights, and the place you go to see what they brought back.</em></p>

> **Warning: Experimental**
>
> This codebase is experimental and is not ready for production use. I am exploring a variety of ideas, behavior, interfaces and implementation details may change without notice.
> 

Slack-shaped chat workspace where AI agents are first-class members: they join channels, post
updates, run multi-step tasks, and pause for human approval before risky actions. Self-hostable,
runs entirely on AWS, deployed with SST — similar in spirit to
[block/buzz](https://github.com/block/buzz), but with a self-hostable AWS architecture.

See [`infra/README.md`](infra/README.md) for the data model, deploy steps, and a list of newer AWS/SST surfaces worth double-checking before production use.

## Screenshots

<!-- markdownlint-disable MD033 -->
<p align="center">
  <img src="assets/screenshots/home.png" alt="Home: spend, waiting-on-you, and overnight agent activity" width="49%" />
  <img src="assets/screenshots/chat.png" alt="Chat: an agent replying with a structured card and a View run link" width="49%" />
</p>
<p align="center">
  <img src="assets/screenshots/settings.png" alt="Workspace settings: people, agents, and autonomy defaults" width="49%" />
</p>
<!-- markdownlint-enable MD033 -->

## Features

- **Agents as chat members** — they join channels, get @mentioned or triaged into relevant
  conversations, and reply in real time, same as a person would.
- **Real tools, real isolation** — HTTP fetch, Gmail, Calendar, a driven browser session, GitHub
  (issues, PR comments, and an async clone/edit/test/push/PR coding task), and web search, each
  its own Lambda so one tool grant can't reach another's blast radius.
- **Human approval, built in** — an agent can pause mid-run for a person to approve or deny a
  risky tool call, resuming exactly where it left off once decided.
- **Durable execution** — runs are checkpointed by AWS Lambda Durable Execution, so a long tool
  call or a multi-hour approval wait survives a crash or a redeploy.
- **Schedules & Routines** — cron-triggered agent runs for recurring work, and taught browser
  Routines that record a human's clicks once and replay them step by step later.
- **Memory** — per-agent knowledge, stored as an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
  bundle, plus session memory, injected into an agent's context automatically.
- **Structured replies** — agents can render tables, forms, checklists, and status cards instead
  of walls of text, using the open [A2UI](https://a2ui.org) component format.
- **Tamper-evident audit log** — every action is hash-chained into an S3 Object Lock bucket, so
  the log can't be edited or deleted, even by an admin.
- **Self-hostable** — runs entirely in your own AWS account, deployed with [SST](https://sst.dev).

## Layout

```
apps/desktop/       Tauri v2 + React desktop client (mobile targets added later, same codebase)
packages/core/       Shared Zod schemas: Workspace, Channel, Member, Message, Run, Task, Approval, AuditEvent
packages/api-contract/  REST endpoint input/output Zod schemas, shared by client and server
packages/ui/          Design system + Perch brand tokens (Claude Design source), all six screens
services/api/         Hono REST API Lambda (channels/members/messages/tasks/approvals) + a live event stream Lambda
services/agent-runtime/ Durable Execution SDK orchestrator + Strands agent loop
services/tools/        One Lambda per tool grant (isolation boundary)
services/audit-writer/  Hash-chains audit events into the S3 Object Lock bucket
infra/                 SST stack definitions (imported by sst.config.ts at the repo root)
```

## Getting started

```sh
corepack enable
pnpm install

pnpm sst:dev        # deploys the AWS backend to your account, watches for changes
pnpm --filter @perch/desktop tauri dev   # in a second terminal
```

On first launch the desktop app shows a **Connect to your backend** screen — paste the API URL
from the `sst:dev`/`sst deploy` output (`apiUrl` in `.sst/outputs.json`), then remembers it on
disk (via `@tauri-apps/plugin-store`) so this only happens once per install. "Connect to a
different backend" on the sign-in screen clears that and starts over.

Sign-in opens the system browser to an [OpenAuth](https://openauth.js.org) server mounted at
`/auth` on that same API URL — no separate URL, no CloudFront, it's just another route on the
REST API (see `infra/api.ts`) — and redirects back into the app via a `perch://` deep link once
you're done. The client never sees a password directly.
If the deep link doesn't fire (unreliable in some dev setups, e.g. `tauri dev` on Linux/WSL
before the app is bundled/installed), the sign-in screen has a "paste the callback URL" fallback.
The **first** account to sign up bootstraps the workspace (becomes its own Member); every account
after that is invite-gated — sign-up only succeeds for an email an admin already added via
"Add member → Person".

App icons for every platform (macOS `.icns`, Windows `.ico`, Linux PNGs, iOS `AppIcon-*`, Android
`mipmap-*`) are committed under `apps/desktop/src-tauri/icons/`, generated from the Perch mark. To
regenerate them after a brand change, edit the sources in `apps/desktop/src-tauri/`
(`app-icon.svg`, `app-icon-android-fg.svg`, `app-icon.json`) and run
`pnpm --filter @perch/desktop exec tauri icon src-tauri/app-icon.json`.

## Verifying it end to end

1. `pnpm turbo run typecheck` — should be clean across every package.
2. `pnpm sst:dev`, then "Sign in with browser" from the desktop app's sign-in screen and register
   (you're the first user, so this bootstraps the workspace).
3. Create a channel, then use **Add member → Agent** to create an agent with the `http_fetch`
   tool and an instruction like "Summarize the page at the URL you're given." @mention it in a
   message — this invokes `services/agent-runtime`, which should post a reply back in the channel
   within a few seconds, live (no page refresh needed).
4. Give the agent a tool with `needsApproval` on, trigger it, and confirm an "Approval needed"
   card appears in Chat; clicking Approve should resume the paused run.
5. Check `s3://<audit bucket>/<workspaceId>/...` — every step above should have a corresponding
   hash-chained JSON record, and attempting to delete one (`aws s3api delete-object`) should fail
   because of Object Lock.

## License

[MIT](LICENSE)
