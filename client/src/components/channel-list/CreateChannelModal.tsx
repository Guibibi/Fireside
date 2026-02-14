import type { JSX, Accessor, Setter } from "solid-js";
import type { Channel } from "../../stores/chat";
import Modal from "../Modal";

export interface CreateChannelModalProps {
  openKind: Channel["kind"] | null;
  onClose: () => void;
  name: Accessor<string>;
  setName: Setter<string>;
  description: Accessor<string>;
  setDescription: Setter<string>;
  nameInputRef: Accessor<HTMLInputElement | undefined>;
  isSaving: boolean;
  onSubmit: (kind: Channel["kind"], name: string, description: string) => void;
}

export default function CreateChannelModal(props: CreateChannelModalProps): JSX.Element {
  return (
    <Modal
      open={!!props.openKind}
      onClose={props.onClose}
      title="Create Channel"
      ariaLabel="Create channel"
      backdropClass="channel-create-modal-backdrop"
      modalClass="channel-create-modal"
    >
      <form
        class="settings-section channel-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          const kind = props.openKind;
          if (!kind) {
            return;
          }
          props.onSubmit(kind, props.name(), props.description());
        }}
      >
        <label class="settings-label" for="channel-create-kind">Channel type</label>
        <input
          id="channel-create-kind"
          type="text"
          value={props.openKind === "voice" ? "Voice" : "Text"}
          disabled
        />

        <label class="settings-label" for="channel-create-name">Channel name</label>
        <input
          id="channel-create-name"
          ref={props.nameInputRef()}
          type="text"
          value={props.name()}
          onInput={(event) => props.setName(event.currentTarget.value)}
          placeholder={props.openKind === "voice" ? "new-voice-channel" : "new-text-channel"}
          maxlength={100}
          disabled={props.isSaving}
        />

        <label class="settings-label" for="channel-create-description">Description</label>
        <input
          id="channel-create-description"
          type="text"
          value={props.description()}
          onInput={(event) => props.setDescription(event.currentTarget.value)}
          placeholder="Optional channel description"
          maxlength={280}
          disabled={props.isSaving}
        />
        <p class="settings-help">Optional description shown in channel metadata surfaces.</p>

        <div class="settings-actions">
          <button
            type="button"
            class="settings-secondary"
            onClick={props.onClose}
            disabled={props.isSaving}
          >
            Cancel
          </button>
          <button type="submit" disabled={props.isSaving}>
            {props.isSaving ? "Creating..." : "Create channel"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
