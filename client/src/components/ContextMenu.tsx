import { For, Show, Switch, Match, createEffect, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";

export interface ContextMenuButtonItem {
  kind?: "button";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  dividerAfter?: boolean;
}

export interface ContextMenuCustomItem {
  kind: "custom";
  render: () => JSX.Element;
  dividerAfter?: boolean;
}

export type ContextMenuItem = ContextMenuButtonItem | ContextMenuCustomItem;

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

  function handleItemClick(item: ContextMenuButtonItem, e: MouseEvent) {
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
          {(item) => {
            const isCustom = () => item.kind === "custom";
            const buttonItem = () => item as ContextMenuButtonItem;
            const customItem = () => item as ContextMenuCustomItem;

            return (
              <>
                <Switch>
                  <Match when={isCustom()}>
                    {customItem().render()}
                  </Match>
                  <Match when={!isCustom()}>
                    <button
                      type="button"
                      class={`context-menu-item${buttonItem().disabled ? " is-disabled" : ""}${buttonItem().danger ? " is-danger" : ""}`}
                      onClick={(e) => handleItemClick(buttonItem(), e)}
                      disabled={buttonItem().disabled}
                      role="menuitem"
                    >
                      {buttonItem().label}
                    </button>
                  </Match>
                </Switch>
                <Show when={item.dividerAfter}>
                  <div class="context-menu-divider" />
                </Show>
              </>
            );
          }}
        </For>
      </div>
    </Portal>
  );
}
