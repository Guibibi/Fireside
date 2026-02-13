import { For, Show, createEffect, onCleanup } from "solid-js";
import {
  cameraEnabled,
  localScreenShareStream,
  localVideoStream,
  screenShareEnabled,
  videoTiles,
} from "../stores/voice";

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
  const hasVideo = () => cameraEnabled() || screenShareEnabled() || videoTiles().length > 0;

  return (
    <section class="video-stage" aria-label="Video stage">
      <Show when={hasVideo()} fallback={<p class="video-stage-empty">No active video</p>}>
        <div class="video-stage-grid">
          <Show when={cameraEnabled() && localVideoStream()}>
            {(stream) => (
              <article class="video-stage-tile is-local">
                <StreamVideo stream={stream()} muted />
                <p class="video-stage-label">You - Camera</p>
              </article>
            )}
          </Show>

          <Show when={screenShareEnabled() && localScreenShareStream()}>
            {(stream) => (
              <article class="video-stage-tile is-local is-screen-share">
                <StreamVideo stream={stream()} muted />
                <p class="video-stage-label">You - Screen</p>
              </article>
            )}
          </Show>

          <For each={videoTiles()}>
            {(tile) => (
              <article class={`video-stage-tile${tile.source === "screen" ? " is-screen-share" : ""}`}>
                <StreamVideo stream={tile.stream} muted={false} />
                <p class="video-stage-label">
                  {tile.username} - {tile.source === "screen" ? "Screen" : "Camera"}
                </p>
              </article>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
