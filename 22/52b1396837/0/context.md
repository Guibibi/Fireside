# Session Context

## User Prompts

### Prompt 1

Implement the following plan:

# Capture Module Refactoring Plan

## Context

The `capture/` module has accumulated significant code duplication — particularly ~750 lines of near-identical code across the VP8/VP9/AV1 ffmpeg encoders, and 4 boilerplate-heavy packetizer structs. There's also dead code (`dxgi_capture_new.rs`) and a utility function (`unix_timestamp_ms`) copy-pasted in 3 files. This refactoring consolidates duplicates and removes dead code, reducing ~700 net lines while preserving...

### Prompt 2

/clear

