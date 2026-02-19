import type { Accessor, JSX, Setter } from "solid-js";
import type { Channel } from "../../stores/chat";
import Modal from "../Modal";

export interface EditChannelModalProps {
  channel: Accessor<Channel | null>;
  onClose: () => void;
  name: Accessor<string>;
  setName: Setter<string>;
  description: Accessor<string>;
  setDescription: Setter<string>;
  opusBitrate: Accessor<number | undefined>;
  setOpusBitrate: Setter<number | undefined>;
  isSaving: boolean;
  onSubmit: (channel: Channel, name: string, description: string, opusBitrate?: number) => void;
}

export default function EditChannelModal(props: EditChannelModalProps): JSX.Element {
  return (
    <Modal
      open={!!props.channel()}
      onClose={props.onClose}
      title="Edit Channel"
      ariaLabel="Edit channel"
      backdropClass="channel-edit-modal-backdrop"
      modalClass="channel-edit-modal"
    >
      <form
        class="settings-section channel-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          const channel = props.channel();
          if (!channel) {
            return;
          }

          props.onSubmit(
            channel,
            props.name(),
            props.description(),
            props.opusBitrate(),
          );
        }}
      >
        <label class="settings-label" for="channel-edit-kind">
          Channel type
        </label>
        <input
          id="channel-edit-kind"
          type="text"
          value={props.channel()?.kind === "voice" ? "Voice" : "Text"}
          disabled
        />

        <label class="settings-label" for="channel-edit-name">
          Channel name
        </label>
        <input
          id="channel-edit-name"
          type="text"
          value={props.name()}
          onInput={(event) => props.setName(event.currentTarget.value)}
          placeholder={
            props.channel()?.kind === "voice"
              ? "voice-channel"
              : "text-channel"
          }
          maxlength={100}
          disabled={props.isSaving}
        />

        <label class="settings-label" for="channel-edit-description">
          Description
        </label>
        <input
          id="channel-edit-description"
          type="text"
          value={props.description()}
          onInput={(event) => props.setDescription(event.currentTarget.value)}
          placeholder="Optional channel description"
          maxlength={280}
          disabled={props.isSaving}
        />
        <p class="settings-help">
          Optional description shown in channel metadata surfaces.
        </p>

        {props.channel()?.kind === "voice" && (
          <>
            <label class="settings-label" for="channel-edit-opus-bitrate">
              Voice codec bitrate
            </label>
            <select
              id="channel-edit-opus-bitrate"
              value={props.opusBitrate() ?? ""}
              onChange={(event) => {
                const value = event.currentTarget.value;
                props.setOpusBitrate(value ? parseInt(value, 10) : undefined);
              }}
              disabled={props.isSaving}
            >
              <option value="">Auto (variable)</option>
              <option value="64000">64 kbps</option>
              <option value="128000">128 kbps</option>
              <option value="192000">192 kbps</option>
              <option value="256000">256 kbps</option>
            </select>
          </>
        )}

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
            {props.isSaving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
