import { Show, createEffect, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  ariaLabel?: string;
  backdropClass?: string;
  modalClass?: string;
  children: JSX.Element;
}

export default function Modal(props: ModalProps) {
  createEffect(() => {
    if (!props.open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class={`settings-modal-backdrop${props.backdropClass ? ` ${props.backdropClass}` : ""}`}
          role="presentation"
          onClick={props.onClose}
        >
          <section
            class={`settings-modal${props.modalClass ? ` ${props.modalClass}` : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={props.ariaLabel ?? props.title}
            onClick={(event) => event.stopPropagation()}
          >
            <header class="settings-modal-header">
              <h4>{props.title}</h4>
              <button
                type="button"
                class="settings-close"
                onClick={props.onClose}
                aria-label={`Close ${props.title.toLowerCase()}`}
              >
                x
              </button>
            </header>
            {props.children}
          </section>
        </div>
      </Portal>
    </Show>
  );
}
