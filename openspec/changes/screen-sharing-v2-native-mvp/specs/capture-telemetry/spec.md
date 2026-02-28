## ADDED Requirements

### Requirement: Capture pipeline metrics collection
The Tauri capture pipeline SHALL collect operational metrics during active capture sessions. Metrics SHALL include: capture FPS (frames received from WGC), encode FPS (frames successfully encoded), queue depth (ring buffer occupancy), dropped frames (overwritten in ring buffer), and send errors (UDP send failures). Metrics SHALL be sampled at 1-second intervals.

#### Scenario: Metrics during steady-state capture
- **WHEN** the capture pipeline is Running
- **THEN** metrics are updated every second with current capture FPS, encode FPS, queue depth, dropped frame count, and send error count

#### Scenario: Metrics reset on new session
- **WHEN** a new capture session starts
- **THEN** all metric counters are reset to zero

### Requirement: Telemetry query via Tauri command
The client SHALL be able to query current capture telemetry via a Tauri command `get_capture_metrics`. The response SHALL include all collected metrics as a typed JSON object.

#### Scenario: Query metrics while sharing
- **WHEN** the client calls `get_capture_metrics` during an active session
- **THEN** it receives `{ capture_fps, encode_fps, queue_depth, dropped_frames, send_errors, uptime_seconds }`

#### Scenario: Query metrics when not sharing
- **WHEN** the client calls `get_capture_metrics` with no active session
- **THEN** it receives null or an empty metrics object indicating no active capture

### Requirement: Telemetry events to client
The Tauri capture pipeline SHALL emit telemetry events to the client at regular intervals (every 2 seconds) during active capture. Events SHALL use the Tauri event system so the client can subscribe without polling.

#### Scenario: Client receives periodic telemetry
- **WHEN** the capture pipeline is Running
- **THEN** the client receives a `capture-telemetry` Tauri event every 2 seconds with current metrics

#### Scenario: Telemetry events stop on session end
- **WHEN** the capture session transitions to Stopped or Failed
- **THEN** telemetry events stop being emitted
