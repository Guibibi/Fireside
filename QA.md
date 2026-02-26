# QA Backlog

Manual verification backlog for active implementation tracks.

## Windows Native Screen Share Rewrite (`zed-scap` + `playa-ffmpeg`, H264-first)

- [ ] `list_native_capture_sources` returns stable, non-empty Windows sources after app launch
- [ ] Source ids for `screen:*` and `window:*` can start capture successfully
- [ ] `application:*` compatibility ids (if exposed) resolve to a concrete target and start capture successfully
- [ ] `start_native_capture` for valid source starts a sender worker and reports `worker_active=true`
- [ ] `native_codec_capabilities` reports `video/H264` available when encoder initialization succeeds
- [ ] Invalid codec request is rejected deterministically with a clear user-facing error
- [ ] Remote viewer receives a watchable H264 stream within expected startup time
- [ ] LIVE badge behavior remains correct for viewers during start/stop cycles
- [ ] `stop_native_capture` always cleans up worker/capture resources without crash
- [ ] Rapid start/stop loop (10 cycles) does not panic or deadlock
- [ ] RTCP keyframe request path triggers IDR/keyframe generation (observe logs/metrics)
- [ ] Hardware encoder path is used when available and reflected in diagnostics metrics
- [ ] Software fallback path (`libx264`) activates cleanly when hardware encoder is unavailable
- [ ] Fallback reason and selected backend are surfaced in `native_capture_status.native_sender`
- [ ] Frame size changes (window resize) do not crash sender and stream recovers with new dimensions
- [ ] Window minimize/restore does not crash sender; behavior is logged and bounded
- [ ] Alt-tab and rapid focus changes do not crash capture/encode pipeline
- [ ] Queue-pressure and dropped-frame metrics update realistically under stress (high-motion content)
- [ ] No legacy ffmpeg subprocess-only assumptions remain in runtime logs or build packaging behavior
- [ ] No process aborts, stack buffer overruns, or thread panics during normal operation and stress pass
