## ADDED Requirements

### Requirement: Screen media source type
The server SHALL accept `"screen"` as a valid `source` value in `MediaProduce` requests alongside existing `"microphone"` and `"camera"` sources. The client type `MediaSource` SHALL include `"screen"`. The server SHALL track screen producers with a `ProducerSource::Screen` variant.

#### Scenario: Produce with screen source
- **WHEN** a client sends a MediaProduce request with `source: "screen"` and `kind: "video"`
- **THEN** the server creates a producer tagged with `ProducerSource::Screen` and broadcasts `new_producer` with `source: "screen"` to the voice channel

#### Scenario: Reject screen source with audio kind
- **WHEN** a client sends a MediaProduce request with `source: "screen"` and `kind: "audio"`
- **THEN** the server rejects the request with a validation error (screen source is video-only in M1)

#### Scenario: One screen producer per connection
- **WHEN** a client already has an active screen producer and attempts to produce another
- **THEN** the server rejects the request with an error indicating a screen producer already exists

### Requirement: PlainTransport creation
The server SHALL support creating PlainTransport instances for native capture RTP delivery. A new signaling action `create_plain_transport` SHALL accept `source: "screen"` and return the transport's `id`, `ip`, `port`, and `rtcp_port`. The PlainTransport SHALL be created on the channel's mediasoup router.

#### Scenario: Create PlainTransport for screen share
- **WHEN** a client sends a `create_plain_transport` signal with `source: "screen"`
- **THEN** the server creates a PlainTransport on the channel router, stores it in the connection's media state, and returns `{ id, ip, port, rtcp_port }`

#### Scenario: PlainTransport cleanup on disconnect
- **WHEN** a client disconnects or leaves the voice channel
- **THEN** all PlainTransports associated with that connection are closed and their producers are removed

#### Scenario: PlainTransport cleanup on screen stop
- **WHEN** the client sends a close producer request for the screen producer
- **THEN** the associated PlainTransport is also closed

### Requirement: PlainTransport producer connection
The server SHALL support connecting a PlainTransport to receive RTP from a specific IP:port. A `connect_plain_transport` signaling action SHALL accept the transport ID and the client's RTP sending address. After connection, the server SHALL allow producing on that transport.

#### Scenario: Connect and produce on PlainTransport
- **WHEN** the client sends `connect_plain_transport` with the transport ID and its local RTP address, then sends `MediaProduce` referencing that transport
- **THEN** the server connects the transport, creates a producer, and broadcasts the screen producer to the channel

### Requirement: Screen producer broadcast
The server SHALL broadcast `new_producer` events for screen producers to all participants in the voice channel. The broadcast payload SHALL include `source: "screen"` so consumers can distinguish screen tiles from camera tiles.

#### Scenario: Remote participant receives screen producer notification
- **WHEN** a user starts screen sharing in a voice channel
- **THEN** all other participants in the channel receive a `new_producer` event with `source: "screen"`, `producer_id`, and the sharing user's identity

#### Scenario: Screen producer closed broadcast
- **WHEN** the screen share stops (producer closed)
- **THEN** all participants receive a `producer_closed` event for the screen producer

### Requirement: Client signaling types for screen
The client TypeScript types SHALL include `"screen"` in the `MediaSource` union. The `RemoteVideoTile` interface SHALL support `source: "screen" | "camera"`. New signaling request/response types SHALL be defined for `create_plain_transport` and `connect_plain_transport`.

#### Scenario: Client sends screen-related signaling
- **WHEN** the client initiates screen sharing
- **THEN** it sends `create_plain_transport`, `connect_plain_transport`, and `MediaProduce` signals with correctly typed payloads

#### Scenario: Client receives screen producer notification
- **WHEN** the client receives a `new_producer` event with `source: "screen"`
- **THEN** it creates a consumer and renders the screen in the overlay/spotlight viewer

### Requirement: Tauri command bridge for capture V2
The Tauri host SHALL expose typed commands under the `capture_v2` namespace callable from the client's JS layer. Commands SHALL include: `enumerate_sources`, `start_capture`, `stop_capture`, `get_capture_state`. Each command SHALL have typed request/response models with serde serialization.

#### Scenario: Client calls enumerate_sources
- **WHEN** the client invokes `enumerate_sources` via the Tauri command bridge
- **THEN** it receives a JSON response with `monitors: [{ name, index, is_primary }]` and `windows: [{ id, title }]`

#### Scenario: Client calls start_capture
- **WHEN** the client invokes `start_capture` with a source identifier and server PlainTransport address
- **THEN** the Tauri host starts the capture pipeline and returns the initial capture state

#### Scenario: Client calls stop_capture
- **WHEN** the client invokes `stop_capture`
- **THEN** the Tauri host stops the active capture session and returns the final state

#### Scenario: Client calls get_capture_state
- **WHEN** the client invokes `get_capture_state`
- **THEN** it receives the current lifecycle state (Starting, Running, Degraded, Stopping, Stopped, Failed) and any error details
