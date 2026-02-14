import { Show, type JSX } from "solid-js";
import { errorMessage } from "../utils/error";

interface AsyncContentProps {
  loading: boolean;
  loadingText?: string;
  error: unknown;
  errorText?: string;
  empty: boolean;
  emptyText?: string;
  children: JSX.Element;
}

export default function AsyncContent(props: AsyncContentProps) {
  return (
    <Show when={!props.loading} fallback={<p class="placeholder">{props.loadingText ?? "Loading..."}</p>}>
      <Show
        when={!props.error}
        fallback={<p class="error">{errorMessage(props.error, props.errorText ?? "Failed to load")}</p>}
      >
        <Show when={!props.empty} fallback={<p class="placeholder">{props.emptyText ?? "Nothing here yet"}</p>}>
          {props.children}
        </Show>
      </Show>
    </Show>
  );
}
