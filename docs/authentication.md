# Authentication and roles

## Roles

- `admin`: user management, invitation codes, password resets, shared document
  library management.
- `user`: evidence chat, shared documents, citation graph and private history.

## Registration

Registration requires an active invitation code. Passwords use Argon2id and are
stored only as PHC hashes.

## Password recovery

There is no SMTP integration. An administrator generates a one-time temporary
password. The affected user is forced to change it before entering the
workspace.

## Session

Auth.js stores the session in a signed JWT cookie. The session is valid for 12
hours. The Kotaemon BFF token remains server-side and is never sent to the
browser.

## Demo accounts

The initializer writes three random accounts to the ignored local file:

```text
data/demo-accounts.json
```

Do not commit that file or reuse the passwords outside the demonstration.
