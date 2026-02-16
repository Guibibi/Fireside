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
  const cameraTiles = () => videoTiles().filter((tile) => tile.source === "camera");
  const hasVideo = () => cameraEnabled() || screenShareEnabled() || cameraTiles().length > 0;

  return (
    <Show when={hasVideo()}>
      <section class="video-stage" aria-label="Video stage">
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

          <For each={cameraTiles()}>
            {(tile) => (
              <article class="video-stage-tile">
                <StreamVideo stream={tile.stream} muted={false} />
                <p class="video-stage-label">{tile.username} - Camera</p>
              </article>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}
