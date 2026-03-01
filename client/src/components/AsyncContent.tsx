import { Show, type JSX } from "solid-js";
import { errorMessage } from "../utils/error";

interface AsyncContentProps {
  loading: boolean;
  loadingText?: string;
  error: unknown;
  errorText?: string;
  empty: boolean;
  emptyText?: string;
  emptyContent?: JSX.Element;
  children: JSX.Element;
}

export default function AsyncContent(props: AsyncContentProps) {
  const emptyFallback = () =>
    props.emptyContent ?? <p class="placeholder">{props.emptyText ?? "Nothing here yet"}</p>;

  return (
    <Show when={!props.loading} fallback={<p class="placeholder">{props.loadingText ?? "Loading..."}</p>}>
      <Show
        when={!props.error}
        fallback={<p class="error">{errorMessage(props.error, props.errorText ?? "Failed to load")}</p>}
      >
        <Show when={!props.empty} fallback={emptyFallback()}>
          {props.children}
        </Show>
      </Show>
    </Show>
  );
}
