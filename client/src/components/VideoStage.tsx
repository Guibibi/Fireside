import { For, Show, createEffect, onCleanup } from "solid-js";
import { cameraEnabled, localVideoStream, videoTiles } from "../stores/voice";

interface StreamVideoProps {
  stream: MediaStream;
  muted: boolean;
  mirrored?: boolean;
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

  return <video ref={videoRef} class={`video-stage-stream${props.mirrored ? " is-mirrored" : ""}`} autoplay playsinline />;
}

export default function VideoStage() {
  const hasVideo = () => cameraEnabled() || videoTiles().length > 0;

  return (
    <section class="video-stage" aria-label="Video stage">
      <Show when={hasVideo()} fallback={<p class="video-stage-empty">No active video</p>}>
        <div class="video-stage-grid">
          <Show when={cameraEnabled() && localVideoStream()}>
            {(stream) => (
              <article class="video-stage-tile is-local">
                <StreamVideo stream={stream()} muted mirrored />
                <p class="video-stage-label">You</p>
              </article>
            )}
          </Show>

          <For each={videoTiles()}>
            {(tile) => (
              <article class="video-stage-tile">
                <StreamVideo stream={tile.stream} muted={false} />
                <p class="video-stage-label">{tile.username}</p>
              </article>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
