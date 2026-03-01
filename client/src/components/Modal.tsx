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

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal(props: ModalProps) {
  let dialogRef: HTMLElement | undefined;
  let previousFocus: HTMLElement | null = null;

  createEffect(() => {
    if (!props.open) {
      return;
    }

    previousFocus = document.activeElement as HTMLElement | null;

    // Focus the dialog after the portal renders
    requestAnimationFrame(() => {
      const first = dialogRef?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? dialogRef)?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
        return;
      }

      if (event.key === "Tab" && dialogRef) {
        const focusable = Array.from(
          dialogRef.querySelectorAll<HTMLElement>(FOCUSABLE),
        ).filter((el) => !el.closest('[inert]'));

        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
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
            ref={dialogRef}
            class={`settings-modal${props.modalClass ? ` ${props.modalClass}` : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={props.ariaLabel ?? props.title}
            tabindex="-1"
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
