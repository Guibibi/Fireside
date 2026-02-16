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
- **Auth: Profile update**: Change display name in settings -> save succeeds and updated profile identity appears across active UI surfaces
- **WS Load: Fan-out burst**: Start 100+ authenticated WS clients in one channel -> publish sustained typing/message events for 60s -> verify no server crash and acceptable delivery lag
- **WS Load: Slow consumer pressure**: Keep one client intentionally slow (throttled read loop) while broadcasting in channel -> verify server logs queue-pressure drops and other clients keep receiving events
- **Profiles: Edit profile status text**: Open settings -> set short custom status text -> save -> refresh app -> status persists and displays in profile surfaces
- **Profiles: Edit profile description**: Open settings -> set profile description -> save -> view own profile -> description renders with expected line breaks and truncation behavior
- **Profiles: View other user profile**: Open member context menu -> click `View Profile` -> modal/panel shows avatar, username, profile status, and description for target user
- **DM: Create conversation from member list**: Open member context menu -> click `Send Message` -> DM thread opens and appears in sidebar
- **DM: Create conversation from profile view**: Open user profile -> click `Send Message` -> same DM thread opens (no duplicate threads)
- **DM: Re-open existing thread**: Start DM with same user twice from different surfaces -> app reuses one thread id/pair
- **DM: Send and receive realtime**: With two clients, send DM both directions -> messages appear instantly in active thread without refresh
- **DM: Typing indicator**: In DM thread, user A types -> user B sees typing indicator; indicator clears on stop/send/timeout
- **DM: Unread badges**: Receive DM while on different channel/thread -> sidebar unread count increments and clears when thread is opened/read
- **DM: Pagination**: In long DM thread, scroll up repeatedly -> older messages load without duplicates or ordering glitches
- **DM: Message edits/deletes**: Author edits and deletes own DM -> remote client receives updates in realtime
- **Profiles/DM: Display-name change resilience**: User with existing DMs changes display name -> member list, message headers, typing labels, and DM thread identity remain consistent

## Completed

- Track A codec QA matrix passed: validated Auto/AV1/VP9/VP8/H264 screen-share flows in Tauri and browser fallback paths.
- Native share UI capability gating verified: disabled codec options matched real runtime capability on target machines.
- AV1 readiness graduation gate passed: manual AV1 share sessions on target platforms met telemetry stability expectations and showed no repeat startup failure/crash pattern in a 30-minute session.
- Phase 5.7: Per-voice-channel codec configuration: create voice channel with custom bitrate, DTX, and FEC settings; join voice and verify codec parameters applied correctly.
