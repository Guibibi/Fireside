import { For, Show, createEffect, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  dividerAfter?: boolean;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

export default function ContextMenu(props: ContextMenuProps) {
  let menuRef: HTMLDivElement | undefined;

  function handleClickOutside(e: MouseEvent) {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      props.onClose();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      props.onClose();
    }
  }

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
    document.removeEventListener("keydown", handleKeyDown);
  });

  createEffect(() => {
    if (menuRef) {
      const rect = menuRef.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = props.x;
      let adjustedY = props.y;

      if (props.x + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 8;
      }

      if (props.y + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 8;
      }

      menuRef.style.left = `${Math.max(8, adjustedX)}px`;
      menuRef.style.top = `${Math.max(8, adjustedY)}px`;
    }
  });

  function handleItemClick(item: ContextMenuItem, e: MouseEvent) {
    e.stopPropagation();
    if (item.disabled) {
      return;
    }
    props.onClose();
    item.onClick();
  }

  return (
    <Portal>
      <div class="context-menu-overlay" />
      <div
        ref={menuRef}
        class="context-menu"
        role="menu"
        style={{
          left: `${props.x}px`,
          top: `${props.y}px`,
        }}
      >
        <For each={props.items}>
          {(item) => (
            <>
              <button
                type="button"
                class={`context-menu-item${item.disabled ? " is-disabled" : ""}${item.danger ? " is-danger" : ""}`}
                onClick={(e) => handleItemClick(item, e)}
                disabled={item.disabled}
                role="menuitem"
              >
                {item.label}
              </button>
              <Show when={item.dividerAfter}>
                <div class="context-menu-divider" />
              </Show>
            </>
          )}
        </For>
      </div>
    </Portal>
  );
}
