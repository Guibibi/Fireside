# QA Backlog

Manual, human-run verification tasks go here.

## Pending

- **Auth: First-run setup**: Fresh DB -> visit `/` -> redirected to `/setup` -> create operator account -> lands on `/chat`
- **Auth: Invite creation**: Operator opens settings -> creates single-use invite -> copies link
- **Auth: Registration via invite**: Open invite link in incognito -> `/invite/CODE` -> fill username + password -> account created -> lands on `/chat`
- **Auth: Login**: Log out -> `/login` -> username + password -> lands on `/chat`
- **Auth: Invite exhaustion**: Use single-use invite -> try again -> "Invite code has been revoked"
- **Auth: Invalid invite**: Visit `/invite/INVALID` -> try to register -> "Invalid invite code"
- **Auth: WebSocket auth**: Verify WS connects and shows presence after login
- **Auth: Profile update**: Change username in settings -> verify new token works

## Completed

- Track A codec QA matrix passed: validated Auto/AV1/VP9/VP8/H264 screen-share flows in Tauri and browser fallback paths.
- Native share UI capability gating verified: disabled codec options matched real runtime capability on target machines.
- AV1 readiness graduation gate passed: manual AV1 share sessions on target platforms met telemetry stability expectations and showed no repeat startup failure/crash pattern in a 30-minute session.
- Phase 5.7: Per-voice-channel codec configuration: create voice channel with custom bitrate, DTX, and FEC settings; join voice and verify codec parameters applied correctly.
