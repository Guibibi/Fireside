import { Show, createEffect, createMemo, onCleanup } from "solid-js";
import {
  clearStreamWatchNotice,
  focusWatchingStream,
  isStreamWatchFocused,
  minimizeWatchingStream,
  showStreamWatchNotice,
  stopWatchingStream,
  streamWatchMode,
  streamWatchNotice,
  videoTiles,
  watchedStreamProducerId,
} from "../stores/voice";

interface StreamPlaybackProps {
  stream: MediaStream;
  class: string;
}

function StreamPlayback(props: StreamPlaybackProps) {
  let videoRef: HTMLVideoElement | undefined;

  createEffect(() => {
    if (!videoRef) {
      return;
    }

    videoRef.srcObject = props.stream;
    videoRef.muted = false;
    videoRef.playsInline = true;
    void videoRef.play().catch(() => undefined);
  });

  onCleanup(() => {
    if (videoRef) {
      videoRef.srcObject = null;
    }
  });

  return <video ref={videoRef} class={props.class} autoplay playsinline />;
}

function requestFullscreenOnElement(element: HTMLElement) {
  const target = element as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };

  if (target.requestFullscreen) {
    void target.requestFullscreen().catch(() => undefined);
    return;
  }

  if (target.webkitRequestFullscreen) {
    void Promise.resolve(target.webkitRequestFullscreen()).catch(() => undefined);
    return;
  }

  if (target.msRequestFullscreen) {
    void Promise.resolve(target.msRequestFullscreen()).catch(() => undefined);
  }
}

export default function StreamWatchOverlay() {
  const screenTiles = createMemo(() => videoTiles().filter((tile) => tile.source === "screen"));
  const watchedTile = createMemo(() => {
    const producerId = watchedStreamProducerId();
    if (!producerId) {
      return null;
    }

    return screenTiles().find((tile) => tile.producerId === producerId) ?? null;
  });
  let focusedPlayerRef: HTMLDivElement | undefined;

  createEffect(() => {
    const mode = streamWatchMode();
    const producerId = watchedStreamProducerId();
    if (mode === "none" || !producerId) {
      return;
    }

    if (watchedTile()) {
      return;
    }

    stopWatchingStream();
    showStreamWatchNotice("Stream ended");
  });

  createEffect(() => {
    const notice = streamWatchNotice();
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => {
      clearStreamWatchNotice();
    }, 2800);

    onCleanup(() => {
      window.clearTimeout(timer);
    });
  });

  return (
    <>
      <Show when={isStreamWatchFocused() && watchedTile()}>
        {(tile) => (
          <section
            class="stream-watch-focused"
            role="region"
            aria-label={`${tile().username} stream`}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                minimizeWatchingStream();
              }
            }}
          >
            <header class="stream-watch-focused-header">
              <div class="stream-watch-focused-context">
                <span class="stream-watch-live-badge" aria-label="LIVE">LIVE</span>
                <span class="stream-watch-focused-title">{tile().username} is streaming</span>
              </div>
              <div class="stream-watch-focused-actions">
                <button
                  type="button"
                  class="stream-watch-icon-btn"
                  onClick={() => {
                    if (focusedPlayerRef) {
                      requestFullscreenOnElement(focusedPlayerRef);
                    }
                  }}
                  title="Fullscreen"
                  aria-label="Fullscreen"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M3 3h6v2H5v4H3zm12 0h6v6h-2V5h-4zm-12 12h2v4h4v2H3zm18 0v6h-6v-2h4v-4z" fill="currentColor" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="stream-watch-icon-btn stream-watch-icon-btn-danger"
                  onClick={stopWatchingStream}
                  title="Stop watching"
                  aria-label="Stop watching stream"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M7 9a5 5 0 0 1 10 0v4h2V9a7 7 0 1 0-14 0v4h2z" fill="currentColor" />
                    <path d="M12 22 8 18h3v-5h2v5h3z" fill="currentColor" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="stream-watch-icon-btn"
                  onClick={minimizeWatchingStream}
                  title="Minimize"
                  aria-label="Minimize stream"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M19 13H5v-2h14z" fill="currentColor" />
                  </svg>
                </button>
              </div>
            </header>
            <div class="stream-watch-focused-player" ref={focusedPlayerRef}>
              <StreamPlayback stream={tile().stream} class="stream-watch-focused-video" />
            </div>
          </section>
        )}
      </Show>

      <Show when={streamWatchMode() === "mini" && watchedTile()}>
        {(tile) => (
          <aside
            class="stream-watch-mini"
            role="region"
            aria-label={`${tile().username} mini player`}
            tabIndex={0}
            onClick={(e) => {
              if (!(e.target instanceof HTMLButtonElement)) {
                focusWatchingStream();
              }
            }}
            style={{ cursor: "pointer" }}
          >
            <StreamPlayback stream={tile().stream} class="stream-watch-mini-video" />
            <div class="stream-watch-mini-overlay">
              <span class="stream-watch-mini-title">{tile().username}</span>
              <button
                type="button"
                class="stream-watch-icon-btn stream-watch-icon-btn-danger"
                onClick={stopWatchingStream}
                title="Stop watching"
                aria-label="Stop watching stream"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M7 9a5 5 0 0 1 10 0v4h2V9a7 7 0 1 0-14 0v4h2z" fill="currentColor" />
                  <path d="M12 22 8 18h3v-5h2v5h3z" fill="currentColor" />
                </svg>
              </button>
            </div>
          </aside>
        )}
      </Show>

      <Show when={streamWatchNotice()}>
        <p class="stream-watch-notice" role="status" aria-live="polite">
          {streamWatchNotice()}
        </p>
      </Show>
    </>
  );
}
