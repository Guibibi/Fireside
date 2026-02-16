import { Show, type JSX } from "solid-js";

interface IconBaseProps {
  width?: number;
  height?: number;
  class?: string;
}

export function DisconnectIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 16}
      height={props.height ?? 16}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M7 9a5 5 0 0 1 10 0v4h2V9a7 7 0 1 0-14 0v4h2z"
        fill="currentColor"
      />
      <path d="M12 22 8 18h3v-5h2v5h3z" fill="currentColor" />
    </svg>
  );
}

export function MicrophoneIcon(props: IconBaseProps & { muted?: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 16}
      height={props.height ?? 16}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z"
        fill="currentColor"
      />
      <path
        d="M18 11v1a6 6 0 0 1-12 0v-1H4v1a8 8 0 0 0 7 7.94V23h2v-3.06A8 8 0 0 0 20 12v-1z"
        fill="currentColor"
      />
      <Show when={props.muted}>
        <path
          d="M4 4 20 20"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          fill="none"
        />
      </Show>
    </svg>
  );
}

export function SpeakerIcon(props: IconBaseProps & { muted?: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 16}
      height={props.height ?? 16}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M4 10a1 1 0 0 1 1-1h3.6l4.63-3.7A1 1 0 0 1 15 6.08v11.84a1 1 0 0 1-1.77.78L8.6 15H5a1 1 0 0 1-1-1v-4z"
        fill="currentColor"
      />
      <Show when={!props.muted}>
        <path
          d="M17 8.5a5 5 0 0 1 0 7"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          fill="none"
        />
        <path
          d="M19.8 6a8.5 8.5 0 0 1 0 12"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          fill="none"
        />
      </Show>
      <Show when={props.muted}>
        <path
          d="M17 8 21 16"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          fill="none"
        />
        <path
          d="M21 8 17 16"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          fill="none"
        />
      </Show>
    </svg>
  );
}

export function CameraIcon(props: IconBaseProps & { enabled?: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 16}
      height={props.height ?? 16}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M4 7.5A1.5 1.5 0 0 1 5.5 6h9A1.5 1.5 0 0 1 16 7.5v2.1l3.86-2.18A1 1 0 0 1 21.4 8.3v7.4a1 1 0 0 1-1.54.87L16 14.4v2.1a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16.5z"
        fill="currentColor"
      />
      <Show when={props.enabled}>
        <path
          d="M5 5 19 19"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          fill="none"
        />
      </Show>
    </svg>
  );
}

export function ScreenShareIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 16}
      height={props.height ?? 16}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M3.5 5A1.5 1.5 0 0 1 5 3.5h14A1.5 1.5 0 0 1 20.5 5v10A1.5 1.5 0 0 1 19 16.5H5A1.5 1.5 0 0 1 3.5 15z"
        fill="currentColor"
      />
      <path
        d="M8.5 20h7"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        fill="none"
      />
      <path
        d="M12 16.5V20"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        fill="none"
      />
    </svg>
  );
}

export function CloseIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 18}
      height={props.height ?? 18}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M6.7 5.3a1 1 0 0 1 1.4 0L12 9.17l3.9-3.88a1 1 0 0 1 1.4 1.42L13.42 10.6l3.88 3.9a1 1 0 1 1-1.42 1.4L12 12.01l-3.9 3.88a1 1 0 1 1-1.4-1.42l3.89-3.88-3.88-3.9a1 1 0 0 1 0-1.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SettingsIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 16}
      height={props.height ?? 16}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M19.14 12.94a7.43 7.43 0 0 0 .05-.94 7.43 7.43 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54a.49.49 0 0 0-.49-.42h-3.84a.49.49 0 0 0-.49.42l-.36 2.54c-.58.22-1.13.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.43 7.43 0 0 0-.05.94 7.43 7.43 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.73 1.63.94l.36 2.54a.49.49 0 0 0 .49.42h3.84a.49.49 0 0 0 .49-.42l.36-2.54c.58-.22 1.13-.53 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
        fill="currentColor"
      />
    </svg>
  );
}

export function PlusIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width={props.width ?? 16}
      height={props.height ?? 16}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

export function ImageIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      width={props.width ?? 18}
      height={props.height ?? 18}
      class={props.class}
      aria-hidden="true"
    >
      <path
        fill-rule="evenodd"
        d="M4 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
        clip-rule="evenodd"
        fill="currentColor"
      />
    </svg>
  );
}

export function FullscreenIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 16}
      height={props.height ?? 16}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M3 3h6v2H5v4H3zm12 0h6v6h-2V5h-4zm-12 12h2v4h4v2H3zm18 0v6h-6v-2h4v-4z"
        fill="currentColor"
      />
    </svg>
  );
}

export function MinimizeIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 16}
      height={props.height ?? 16}
      class={props.class}
      aria-hidden="true"
    >
      <path d="M19 13H5v-2h14z" fill="currentColor" />
    </svg>
  );
}

export function ZoomIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 18}
      height={props.height ?? 18}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6Zm9 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function DownloadIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 18}
      height={props.height ?? 18}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ExternalLinkIcon(props: IconBaseProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.width ?? 18}
      height={props.height ?? 18}
      class={props.class}
      aria-hidden="true"
    >
      <path
        d="M14 4a1 1 0 0 0 0 2h4.59l-7.3 7.29a1 1 0 0 0 1.42 1.42L20 7.41V12a1 1 0 1 0 2 0V4h-8Z"
        fill="currentColor"
      />
      <path
        d="M5 6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5a1 1 0 1 0-2 0v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h5a1 1 0 1 0 0-2H5Z"
        fill="currentColor"
      />
    </svg>
  );
}
