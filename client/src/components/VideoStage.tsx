import { For, Show, createEffect, onCleanup } from "solid-js";
import {
  cameraEnabled,
  localVideoStream,
  setWatchedScreenProducerId,
  videoTiles,
  watchedScreenProducerId,
} from "../stores/voice";
import { username as currentUsername } from "../stores/auth";

interface StreamVideoProps {
  stream: MediaStream;
  muted: boolean;
}

function StreamVideo(props: StreamVideoProps) {
  let videoRef: HTMLVideoElement | undefined;

  createEffect(() => {
    const stream = props.stream;
    if (!videoRef) {
      return;
    }

    videoRef.srcObject = stream;
    videoRef.muted = props.muted;
    videoRef.playsInline = true;
    void videoRef.play().catch(() => undefined);
  });

  onCleanup(() => {
    if (videoRef) {
      videoRef.srcObject = null;
    }
  });

  return <video ref={videoRef} class="video-stage-stream" autoplay playsinline />;
}

export default function VideoStage() {
  const me = () => currentUsername();

  const cameraTiles = () => videoTiles().filter((tile) => tile.source === "camera");
  // Exclude the local user's own screen share from the viewer.
  const availableScreenTiles = () =>
    videoTiles().filter((tile) => tile.source === "screen" && tile.username !== me());

  const hasCamera = () => cameraEnabled() || cameraTiles().length > 0;
  const watchedScreenTile = () => {
    const watchedProducerId = watchedScreenProducerId();
    if (!watchedProducerId) {
      return null;
    }

    return (
      availableScreenTiles().find((tile) => tile.producerId === watchedProducerId)
      ?? null
    );
  };

  const hasScreenShare = () => watchedScreenTile() !== null;
  const hasVideo = () => hasCamera() || hasScreenShare();

  createEffect(() => {
    const watchedProducerId = watchedScreenProducerId();
    if (!watchedProducerId) {
      return;
    }

    if (!availableScreenTiles().some((tile) => tile.producerId === watchedProducerId)) {
      setWatchedScreenProducerId(null);
    }
  });

  return (
    <Show when={hasVideo()}>
      <section class="video-stage" aria-label="Video stage">
        {/* Spotlight layout when screen shares are present */}
        <Show when={hasScreenShare()}>
          <div class="video-stage-spotlight-layout">
            {/* Main spotlight area */}
            <div class="video-stage-spotlight">
              <Show when={watchedScreenTile()}>
                {(tile) => (
                  <article class="video-stage-tile is-screen">
                    <StreamVideo stream={tile().stream} muted={false} />
                    <p class="video-stage-label">{tile().username} — Screen</p>
                  </article>
                )}
              </Show>
            </div>

            {/* Sidebar: screen selector + camera tiles */}
            <div class="video-stage-sidebar">
              {/* Screen selector (when multiple screen shares) */}
              <Show when={availableScreenTiles().length > 1}>
                <For each={availableScreenTiles()}>
                  {(tile) => (
                    <button
                      type="button"
                      class={`video-stage-sidebar-thumb${watchedScreenProducerId() === tile.producerId ? " is-selected" : ""}`}
                      onClick={() => setWatchedScreenProducerId(tile.producerId)}
                      aria-label={`Switch to ${tile.username}'s screen`}
                    >
                      <StreamVideo stream={tile.stream} muted={false} />
                      <span class="video-stage-label">{tile.username}</span>
                    </button>
                  )}
                </For>
              </Show>

              {/* Local camera */}
              <Show when={cameraEnabled() && localVideoStream()}>
                {(stream) => (
                  <article class="video-stage-tile is-local is-small">
                    <StreamVideo stream={stream()} muted />
                    <p class="video-stage-label">You</p>
                  </article>
                )}
              </Show>

              {/* Remote cameras */}
              <For each={cameraTiles()}>
                {(tile) => (
                  <article class="video-stage-tile is-small">
                    <StreamVideo stream={tile.stream} muted={false} />
                    <p class="video-stage-label">{tile.username}</p>
                  </article>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Camera grid when no screen shares */}
        <Show when={!hasScreenShare() && hasCamera()}>
          <div class="video-stage-grid">
            <Show when={cameraEnabled() && localVideoStream()}>
              {(stream) => (
                <article class="video-stage-tile is-local">
                  <StreamVideo stream={stream()} muted />
                  <p class="video-stage-label">You - Camera</p>
                </article>
              )}
            </Show>

            <For each={cameraTiles()}>
              {(tile) => (
                <article class="video-stage-tile">
                  <StreamVideo stream={tile.stream} muted={false} />
                  <p class="video-stage-label">{tile.username} - Camera</p>
                </article>
              )}
            </For>
          </div>
        </Show>
      </section>
    </Show>
  );
}
