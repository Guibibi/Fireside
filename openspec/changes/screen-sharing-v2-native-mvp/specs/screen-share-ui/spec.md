## ADDED Requirements

### Requirement: Screen share button in voice dock
The voice dock SHALL display a screen share button when the user is in a voice channel. The button SHALL be disabled when not in a voice channel. The button SHALL visually indicate when screen sharing is active (toggled state).

#### Scenario: User clicks screen share button while not sharing
- **WHEN** the user clicks the screen share button and is not currently sharing
- **THEN** the source picker modal opens

#### Scenario: User clicks screen share button while sharing
- **WHEN** the user clicks the screen share button and is currently sharing
- **THEN** the active screen share stops immediately (no confirmation needed)

#### Scenario: Screen share button disabled outside voice
- **WHEN** the user is not in a voice channel
- **THEN** the screen share button is disabled and not clickable

### Requirement: Source picker modal
The system SHALL display a modal dialog for selecting a capture source. The modal SHALL show two tabs: Monitors and Windows. Each source SHALL be displayed with its name/title. The user SHALL select a source and click a "Start Sharing" button to begin capture.

#### Scenario: Open source picker
- **WHEN** the source picker modal opens
- **THEN** it enumerates available monitors and windows via the Tauri bridge and displays them in tabbed lists

#### Scenario: Select and start sharing a monitor
- **WHEN** the user selects a monitor from the list and clicks "Start Sharing"
- **THEN** the modal closes, the capture pipeline starts for the selected monitor, and the voice dock button reflects the active state

#### Scenario: Select and start sharing a window
- **WHEN** the user selects a window from the list and clicks "Start Sharing"
- **THEN** the modal closes, the capture pipeline starts for the selected window, and the voice dock button reflects the active state

#### Scenario: Cancel source picker
- **WHEN** the user clicks outside the modal or presses Escape
- **THEN** the modal closes without starting capture

#### Scenario: No sources available
- **WHEN** the modal opens but no monitors or windows are found
- **THEN** the modal displays a message indicating no sources are available

#### Scenario: Enumeration fails
- **WHEN** source enumeration fails (e.g., Tauri bridge error, not on Windows)
- **THEN** the modal displays an error message with guidance

### Requirement: Screen share error display
The system SHALL display errors that occur during screen sharing. Errors from the capture pipeline (source lost, encode failure, send failure) SHALL be shown as a toast or inline message. The screen share button SHALL return to inactive state on failure.

#### Scenario: Capture fails after start
- **WHEN** the capture pipeline transitions to Failed state
- **THEN** a toast notification shows the failure reason and the voice dock button returns to inactive

#### Scenario: Source lost during sharing
- **WHEN** the captured window is closed during active sharing
- **THEN** a toast notification informs the user the source was lost and sharing has stopped

### Requirement: Overlay/spotlight viewer for remote screen shares
The system SHALL render remote screen shares in an overlay/spotlight layout. The screen share tile SHALL take the primary large area of the video stage. Camera tiles SHALL shrink to a small strip alongside the screen tile. When multiple users share screens, the most recent share SHALL be spotlighted (with ability to switch).

#### Scenario: Remote user starts screen share
- **WHEN** a remote participant's screen producer is received
- **THEN** the video stage switches to overlay/spotlight layout with the screen share in the large area and camera tiles in a small sidebar

#### Scenario: Screen share ends
- **WHEN** the remote screen producer is closed
- **THEN** the video stage returns to the normal camera grid layout

#### Scenario: Local user views their own screen share
- **WHEN** the local user is sharing their screen
- **THEN** the local screen share is NOT shown in their own video stage (they can see it on their actual screen)

#### Scenario: Multiple simultaneous screen shares
- **WHEN** multiple users are sharing screens
- **THEN** the most recently started share is spotlighted, with a selector to switch between active shares

### Requirement: Screen share consumer creation
The client SHALL create consumers for screen producers using the existing recv transport. Screen consumers SHALL be treated as video consumers with `source: "screen"`. The consumed stream SHALL be rendered in the overlay/spotlight viewer.

#### Scenario: Consume screen producer
- **WHEN** the client receives a `new_producer` event with `source: "screen"`
- **THEN** it creates a consumer on the recv transport, receives the MediaStream, and adds a screen tile to the video stage

#### Scenario: Screen consumer cleanup
- **WHEN** the screen producer is closed
- **THEN** the consumer is closed, the MediaStream is stopped, and the screen tile is removed from the video stage
