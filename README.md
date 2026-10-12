# tv-bridge

A [TizenBrew](https://github.com/reisxd/TizenBrew) **service module**: a small
JavaScript file that TizenBrew's service downloads from jsDelivr and runs
inside the service process (Node ~4.x sandbox with native `require`).

## What it does

- Polls a LAN orchestrator (`GET /job`) every 5 s.
- Executes returned job code (asynchronously reported back via `POST /result`).
- Sends a heartbeat every 30 s (`POST /heartbeat`).
- Self-heals: watchdog restarts the poll loop if it stalls; generation
  counter prevents duplicate loops when the module is reloaded.

## Install (TizenBrew)

Add to `tizenbrewConfig.json` (or via TizenBrew UI / WS event 10):

```json
{
  "modules": ["gh/kaczordodgers/tv-bridge@<commit-sha>"],
  "autoLaunchServiceList": ["kaczordodgers/tv-bridge@<commit-sha>"]
}
```

Or start it ad hoc over the service WebSocket (`ws://127.0.0.1:8081`):

```json
{ "type": 6, "payload": { "fullName": "gh/kaczordodgers/tv-bridge@<sha>",
  "name": "kaczordodgers/tv-bridge@<sha>", "packageType": "app",
  "serviceFile": "service.js" } }
```

## Orchestrator protocol

| Endpoint | Method | Body / Response |
|---|---|---|
| `/job?ts=` | GET | `{"id":"...","code":"..."}` or `{"idle":true}` |
| `/result` | POST | `{"id","ok","result"\|"err"}` |
| `/heartbeat` | POST | `{"pid","upS","jobs","errs","tizen","gen"}` |
| `/report` | POST | free-form JSON log line |

The orchestrator URL is at the top of `service.js` — point it at your own
listener and run one with ~40 lines of `http.server` (see protocol above).
