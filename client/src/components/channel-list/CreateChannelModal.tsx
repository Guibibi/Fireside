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
    opusBitrate: Accessor<number | undefined>;
    setOpusBitrate: Setter<number | undefined>;
    opusDtx: Accessor<boolean>;
    setOpusDtx: Setter<boolean>;
    opusFec: Accessor<boolean>;
    setOpusFec: Setter<boolean>;
    onSubmit: (
        kind: Channel["kind"],
        name: string,
        description: string,
        opusBitrate?: number,
        opusDtx?: boolean,
        opusFec?: boolean,
    ) => void;
}

export default function CreateChannelModal(
    props: CreateChannelModalProps,
): JSX.Element {
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
                    props.onSubmit(
                        kind,
                        props.name(),
                        props.description(),
                        props.opusBitrate(),
                        props.opusDtx(),
                        props.opusFec(),
                    );
                }}
            >
                <label class="settings-label" for="channel-create-kind">
                    Channel type
                </label>
                <input
                    id="channel-create-kind"
                    type="text"
                    value={props.openKind === "voice" ? "Voice" : "Text"}
                    disabled
                />

                <label class="settings-label" for="channel-create-name">
                    Channel name
                </label>
                <input
                    id="channel-create-name"
                    ref={props.nameInputRef()}
                    type="text"
                    value={props.name()}
                    onInput={(event) =>
                        props.setName(event.currentTarget.value)
                    }
                    placeholder={
                        props.openKind === "voice"
                            ? "new-voice-channel"
                            : "new-text-channel"
                    }
                    maxlength={100}
                    disabled={props.isSaving}
                />

                {props.openKind === "text" && (
                    <>
                        <label
                            class="settings-label"
                            for="channel-create-description"
                        >
                            Description
                        </label>
                        <input
                            id="channel-create-description"
                            type="text"
                            value={props.description()}
                            onInput={(event) =>
                                props.setDescription(event.currentTarget.value)
                            }
                            placeholder="Optional channel description"
                            maxlength={280}
                            disabled={props.isSaving}
                        />
                        <p class="settings-help">
                            Optional description shown in channel metadata
                            surfaces.
                        </p>
                    </>
                )}

                {props.openKind === "voice" && (
                    <>
                        <label
                            class="settings-label"
                            for="channel-opus-bitrate"
                        >
                            Voice codec bitrate
                        </label>
                        <select
                            id="channel-opus-bitrate"
                            value={props.opusBitrate() ?? ""}
                            onChange={(event) => {
                                const value = event.currentTarget.value;
                                props.setOpusBitrate(
                                    value ? parseInt(value, 10) : undefined,
                                );
                            }}
                            disabled={props.isSaving}
                        >
                            <option value="">Auto (variable)</option>
                            <option value="64000">64 kbps</option>
                            <option value="128000">128 kbps</option>
                            <option value="192000">192 kbps</option>
                            <option value="256000">256 kbps</option>
                        </select>

                        <label class="settings-label settings-checkbox-label">
                            <input
                                type="checkbox"
                                checked={props.opusDtx()}
                                onChange={(event) =>
                                    props.setOpusDtx(
                                        event.currentTarget.checked,
                                    )
                                }
                                disabled={props.isSaving}
                            />
                            <span style={{ "margin-left": "8px" }}>
                                Enable DTX (discontinuous transmission)
                            </span>
                        </label>
                        <p class="settings-help">
                            Reduces bandwidth when you're not speaking.
                        </p>

                        <label class="settings-label settings-checkbox-label">
                            <input
                                type="checkbox"
                                checked={props.opusFec()}
                                onChange={(event) =>
                                    props.setOpusFec(
                                        event.currentTarget.checked,
                                    )
                                }
                                disabled={props.isSaving}
                            />
                            <span style={{ "margin-left": "8px" }}>
                                Enable FEC (forward error correction)
                            </span>
                        </label>
                        <p class="settings-help">
                            Improves audio quality at the cost of slightly
                            higher bandwidth.
                        </p>
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
                        {props.isSaving ? "Creating..." : "Create channel"}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
