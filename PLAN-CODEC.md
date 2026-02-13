## Codec Implementation Plan (Windows Screen Share)

### Goal

- Add support for `H264`, `VP9`, and `AV1` (remove `H265`) in the media pipeline.
- Prioritize codec selection for Windows screen sharing while preserving fallback behavior.
- Keep protocol and signaling format stable.

### Phase 1: Server Codec Capability Expansion

- Update `server/src/media/router.rs` video codec list.
- Keep `VP8` as broad compatibility fallback.
- Add `H264`, `VP9`, and `AV1` entries.
- Use consistent RTCP feedback for all video codecs.
- For `H264`, include interop-safe parameters (`level-asymmetry-allowed`, `packetization-mode`, and profile-level setting).

### Phase 2: Client Screen Share Codec Preference

- Update `client/src/api/media.ts` screen-share producer path.
- Add helper that inspects `device.rtpCapabilities.codecs` and chooses a preferred screen codec.
- Windows preference order: `AV1 -> VP9 -> H264 -> VP8/default`.
- Pass the selected codec via `sendTransport.produce({ codec })` for `source: "screen"` only.
- Preserve existing behavior if no preferred codec is available.

### Phase 3: Windows-Focused Guardrails

- Gate preference ordering to Windows platform detection.
- Keep non-Windows behavior neutral and fallback-safe.
- Do not change WebSocket payload schema or media signaling actions.

### Phase 4: Observability / Verification Hooks

- Add debug logging for selected screen-share codec mime type.
- Optionally add sender stats inspection to log codec and `encoderImplementation` (when exposed by runtime).
- Use logs for practical NVENC verification on Windows + NVIDIA.

### Phase 5: Validation

Server validation:

- `cargo fmt --all --manifest-path server/Cargo.toml -- --check`
- `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path server/Cargo.toml`

Client validation:

- `npm --prefix client run typecheck`
- `npm --prefix client run build`

### Phase 6: Documentation

- Document supported screen-share codecs: `VP8`, `H264`, `VP9`, `AV1`.
- Explicitly note `H265/HEVC` is intentionally unsupported in current stack.
- Note that NVENC usage depends on runtime/driver/GPU support and is not guaranteed by codec configuration alone.

## Checklist

- [ ] Update `server/src/media/router.rs` to include `H264`, `VP9`, and `AV1` while keeping `VP8`.
- [ ] Add safe `H264` codec parameters for interoperability.
- [ ] Implement screen-share codec selection helper in `client/src/api/media.ts`.
- [ ] Apply Windows codec preference order: `AV1 -> VP9 -> H264 -> fallback`.
- [ ] Pass selected codec into `sendTransport.produce()` for screen sharing.
- [ ] Preserve fallback behavior when preferred codec is unavailable.
- [ ] Add debug logging for selected codec and optional sender stats probe.
- [ ] Run server format/lint/tests.
- [ ] Run client type-check/build.
- [ ] Document codec support and `H265` exclusion.
