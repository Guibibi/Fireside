# QA Backlog

Manual verification backlog for active implementation tracks.

## Native DXGI Window/Application Capture Migration

- [ ] Screen source (`screen:*`) still streams over DXGI with no regressions in startup latency or stability
- [ ] Window source (`window:*`) starts without crash and sends video to a second client successfully
- [ ] Application source (`application:*`) starts without crash and sends video to a second client successfully
- [ ] LIVE badge behavior remains correct for viewers when native stream starts/stops
- [ ] Moving captured window between monitors recovers within one session restart/rebind and keeps streaming
- [ ] Resizing captured window updates transmitted frame dimensions without sender crash
- [ ] Minimizing captured window does not crash sender; stream pauses/black/freeze behavior is logged and expected
- [ ] Occluding captured window reflects visible-pixels model (occluding content appears in stream)
- [ ] Alt-tab and rapid focus changes do not panic sender worker
- [ ] Stop/start stream repeatedly (10 cycles) with window and application sources without process abort
- [ ] Verify no `InvalidEncoderDevice` panic or stack-buffer-overrun process termination during window/app streaming
