---
summary: "CLI reference for `openpaw devices` (device pairing + token rotation/revocation)"
read_when:
  - You are approving device pairing requests
  - You need to rotate or revoke device tokens
title: "devices"
---

# `openpaw devices`

Manage device pairing requests and device-scoped tokens.

## Commands

### `openpaw devices list`

List pending pairing requests and paired devices.

```
openpaw devices list
openpaw devices list --json
```

### `openpaw devices approve <requestId>`

Approve a pending device pairing request.

```
openpaw devices approve <requestId>
```

### `openpaw devices reject <requestId>`

Reject a pending device pairing request.

```
openpaw devices reject <requestId>
```

### `openpaw devices rotate --device <id> --role <role> [--scope <scope...>]`

Rotate a device token for a specific role (optionally updating scopes).

```
openpaw devices rotate --device <deviceId> --role operator --scope operator.read --scope operator.write
```

### `openpaw devices revoke --device <id> --role <role>`

Revoke a device token for a specific role.

```
openpaw devices revoke --device <deviceId> --role node
```

## Common options

- `--url <url>`: Gateway WebSocket URL (defaults to `gateway.remote.url` when configured).
- `--token <token>`: Gateway token (if required).
- `--password <password>`: Gateway password (password auth).
- `--timeout <ms>`: RPC timeout.
- `--json`: JSON output (recommended for scripting).

## Notes

- Token rotation returns a new token (sensitive). Treat it like a secret.
- These commands require `operator.pairing` (or `operator.admin`) scope.
