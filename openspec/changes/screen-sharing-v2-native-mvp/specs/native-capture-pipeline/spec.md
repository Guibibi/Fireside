## ADDED Requirements

### Requirement: Capture session lifecycle
The system SHALL manage capture sessions through explicit states: Starting, Running, Degraded, Stopping, Stopped, Failed. Each state transition SHALL be communicated to the client via Tauri events. Only valid transitions SHALL be permitted (e.g., cannot start a Running session, cannot stop a Stopped session).

#### Scenario: Start capture session
- **WHEN** the user selects a source and initiates capture
- **THEN** the session transitions Starting → Running, the capture thread begins delivering frames, and the client receives a state event

#### Scenario: Stop capture session
- **WHEN** the user stops the active screen share
- **THEN** the session transitions Running → Stopping → Stopped, all pipeline threads are joined, UDP socket is closed, and the client receives a state event

#### Scenario: Capture source becomes unavailable
- **WHEN** the captured window is closed or the monitor is disconnected during an active session
- **THEN** the session transitions to Failed with an error reason, pipeline resources are cleaned up, and the client receives a failure event

#### Scenario: Restart after stop
- **WHEN** the user starts a new capture after a previous session was Stopped or Failed
- **THEN** a fresh session is created with new pipeline resources (no stale state from prior session)

### Requirement: Source enumeration
The system SHALL enumerate available capture sources on Windows via Tauri commands. Sources include monitors (with device name, index, primary status) and windows (with title, visibility). The enumeration SHALL be callable from the client at any time.

#### Scenario: Enumerate monitors
- **WHEN** the client invokes the enumerate sources command
- **THEN** the system returns a list of available monitors with device name, display index, and whether each is the primary monitor

#### Scenario: Enumerate windows
- **WHEN** the client invokes the enumerate sources command
- **THEN** the system returns a list of visible windows with title and a stable identifier suitable for starting capture

#### Scenario: No sources available
- **WHEN** no monitors or windows are found (e.g., headless environment)
- **THEN** the system returns an empty list without error

### Requirement: Frame capture via Windows Graphics Capture
The system SHALL capture frames from the selected source using the Windows Graphics Capture API (via `windows-capture` crate). Frames SHALL be delivered as BGRA8 pixel buffers at up to 60fps. The capture callback SHALL NOT block — frame handoff to the encode stage SHALL use a lock-free ring buffer.

#### Scenario: Steady-state capture at 60fps
- **WHEN** capture is Running and the source is producing content
- **THEN** the capture thread delivers BGRA frames to the ring buffer at the source's refresh rate (up to 60fps)

#### Scenario: Capture thread does not block on slow encoder
- **WHEN** the encoder is processing slower than the capture rate
- **THEN** the capture callback overwrites the ring buffer with the latest frame and returns immediately (no dropped-frame stall)

### Requirement: Color conversion BGRA to I420
The system SHALL convert captured BGRA8 frames to I420 color space before encoding. Conversion SHALL use SIMD-accelerated routines (via `dcv-color-primitives`). Pre-allocated buffers SHALL be reused across frames to avoid per-frame allocation.

#### Scenario: Convert 1080p frame
- **WHEN** a 1080p BGRA frame arrives for encoding
- **THEN** the system produces I420 Y/U/V planes suitable for OpenH264 input within the frame time budget

### Requirement: Software H264 encoding
The system SHALL encode I420 frames to H264 bitstream using OpenH264 with NASM acceleration. The encoder SHALL be configured for low-latency operation (no B-frames, constrained baseline or baseline profile). Target bitrate SHALL be configurable with a default of 4 Mbps for 1080p60.

#### Scenario: Encode 1080p60 within frame budget
- **WHEN** a 1080p I420 frame is submitted for encoding
- **THEN** the encoder produces an H264 access unit (one or more NAL units) within approximately 8-10ms

#### Scenario: Keyframe on demand
- **WHEN** the server requests a keyframe (e.g., new consumer joins or PLI received)
- **THEN** the encoder produces an IDR frame on the next encode cycle

### Requirement: RTP packetization
The system SHALL packetize H264 access units into RTP packets per RFC 6184 (packetization-mode=1). NAL units smaller than MTU (1200 bytes) SHALL be sent as Single NAL Unit packets. NAL units larger than MTU SHALL be fragmented into FU-A packets. The RTP marker bit SHALL be set on the last packet of each access unit. Sequence numbers SHALL increment monotonically. Timestamps SHALL use the 90kHz RTP clock.

#### Scenario: Small NAL unit
- **WHEN** an encoded NAL unit is <= 1200 bytes
- **THEN** it is sent as a single RTP packet with the NAL header as the payload

#### Scenario: Large NAL unit requiring fragmentation
- **WHEN** an encoded NAL unit exceeds 1200 bytes
- **THEN** it is split into FU-A fragments, each <= 1200 bytes, with Start/End bits set appropriately

#### Scenario: Frame boundary marker
- **WHEN** the last RTP packet of an access unit is sent
- **THEN** the RTP marker bit is set to 1

### Requirement: UDP RTP sender
The system SHALL send packetized RTP over UDP to the server's PlainTransport endpoint. The sender SHALL use the IP and port provided by the server during PlainTransport setup. The sender thread SHALL drain the encode output channel and transmit packets without buffering beyond the bounded channel.

#### Scenario: Send encoded frame
- **WHEN** the encode thread produces a packetized frame
- **THEN** the send thread transmits all RTP packets for that frame over UDP to the server's PlainTransport address

#### Scenario: Network send failure
- **WHEN** a UDP send call fails
- **THEN** the error is logged and the frame is skipped (UDP is fire-and-forget; no retry)
