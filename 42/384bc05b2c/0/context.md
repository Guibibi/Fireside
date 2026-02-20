# Session Context

## User Prompts

### Prompt 1

Implement the following plan:

# Voice Connection Health Indicator

## Context
The VoiceDock currently shows plain text ("Connection: Connected") for the WebSocket state only. The WebRTC/ICE transport state (the actual audio path) is not surfaced to the user at all — if ICE disconnects or fails, there's no visible indication. Replace the plain text with a colored dot + compact label that reflects combined WS + audio transport health.

- **Green** dot = WS connected + audio transport connected ...

