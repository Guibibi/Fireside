import { For, Show, createSignal, onMount } from "solid-js";
import { del, get, post } from "../../api/http";
import { errorMessage } from "../../utils/error";

export interface InviteResponse {
  id: string;
  code: string;
  created_by: string;
  creator_username: string;
  single_use: boolean;
  used_count: number;
  max_uses: number | null;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
}

interface CreateInviteRequest {
  single_use: boolean;
  max_uses?: number;
  expires_at?: string;
}

type InviteExpirationPreset = "none" | "24h" | "7d" | "30d" | "custom";

export interface InviteSettingsProps {
  isOperatorOrAdmin: boolean;
}

function formatInviteTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }
  return date.toLocaleString();
}

function formatInviteExpiry(expiresAt: string | null): string {
  if (!expiresAt) {
    return "No expiration";
  }
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return "Expiration unavailable";
  }
  return `Expires ${date.toLocaleString()}`;
}

function presetExpirationToIso(preset: InviteExpirationPreset): string | null {
  const now = Date.now();
  if (preset === "24h") {
    return new Date(now + 24 * 60 * 60 * 1000).toISOString();
  }
  if (preset === "7d") {
    return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (preset === "30d") {
    return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

export default function InviteSettings(props: InviteSettingsProps) {
  const [invites, setInvites] = createSignal<InviteResponse[]>([]);
  const [inviteError, setInviteError] = createSignal("");
  const [isCreatingInvite, setIsCreatingInvite] = createSignal(false);
  const [copiedInviteId, setCopiedInviteId] = createSignal<string | null>(null);
  const [inviteSingleUse, setInviteSingleUse] = createSignal(true);
  const [inviteMaxUses, setInviteMaxUses] = createSignal("10");
  const [inviteExpirationPreset, setInviteExpirationPreset] = createSignal<InviteExpirationPreset>("none");
  const [inviteExpiresAtLocal, setInviteExpiresAtLocal] = createSignal("");

  onMount(() => {
    if (!props.isOperatorOrAdmin) {
      return;
    }

    void refreshInvites();
  });

  async function refreshInvites() {
    try {
      const data = await get<InviteResponse[]>("/invites");
      setInvites(data);
    } catch {
      // non-blocking
    }
  }

  async function handleCreateInvite() {
    setInviteError("");

    const payload: CreateInviteRequest = {
      single_use: inviteSingleUse(),
    };

    if (!inviteSingleUse()) {
      const parsedMaxUses = Number.parseInt(inviteMaxUses().trim(), 10);
      if (!Number.isFinite(parsedMaxUses) || parsedMaxUses < 1) {
        setInviteError("Max uses must be a whole number of at least 1");
        return;
      }
      payload.max_uses = parsedMaxUses;
    }

    if (inviteExpirationPreset() === "custom") {
      const localValue = inviteExpiresAtLocal().trim();
      if (!localValue) {
        setInviteError("Choose an expiration date and time");
        return;
      }
      const expiresAtDate = new Date(localValue);
      if (Number.isNaN(expiresAtDate.getTime())) {
        setInviteError("Expiration date is invalid");
        return;
      }
      if (expiresAtDate.getTime() <= Date.now()) {
        setInviteError("Expiration date must be in the future");
        return;
      }
      payload.expires_at = expiresAtDate.toISOString();
    } else {
      const presetExpiresAt = presetExpirationToIso(inviteExpirationPreset());
      if (presetExpiresAt) {
        payload.expires_at = presetExpiresAt;
      }
    }

    setIsCreatingInvite(true);
    try {
      const invite = await post<InviteResponse>("/invites", payload);
      setInvites((prev) => [invite, ...prev]);
    } catch (err) {
      setInviteError(errorMessage(err, "Failed to create invite"));
    } finally {
      setIsCreatingInvite(false);
    }
  }

  async function handleRevokeInvite(id: string) {
    setInviteError("");
    try {
      await del<unknown>(`/invites/${id}`);
      setInvites((prev) => prev.map((inv) => (inv.id === id ? { ...inv, revoked: true } : inv)));
    } catch (err) {
      setInviteError(errorMessage(err, "Failed to revoke invite"));
    }
  }

  function handleCopyInviteLink(code: string, id: string) {
    const link = `${window.location.origin}/invite/${code}`;
    void navigator.clipboard.writeText(link).then(() => {
      setCopiedInviteId(id);
      setTimeout(() => setCopiedInviteId(null), 2000);
    });
  }

  if (!props.isOperatorOrAdmin) {
    return null;
  }

  return (
    <section class="settings-section">
      <h5>Invites</h5>

      <div class="invite-create-options">
        <label class="settings-checkbox" for="settings-invite-single-use">
          <input
            id="settings-invite-single-use"
            type="checkbox"
            checked={inviteSingleUse()}
            onInput={(event) => setInviteSingleUse(event.currentTarget.checked)}
          />
          Single-use invite
        </label>

        <Show when={!inviteSingleUse()}>
          <div class="settings-audio-row invite-option-row">
            <label class="settings-label" for="settings-invite-max-uses">Max uses</label>
            <input
              id="settings-invite-max-uses"
              type="number"
              min="1"
              step="1"
              value={inviteMaxUses()}
              onInput={(event) => setInviteMaxUses(event.currentTarget.value)}
            />
          </div>
        </Show>

        <div class="settings-audio-row invite-option-row">
          <label class="settings-label" for="settings-invite-expiration-preset">Expiration</label>
          <select
            id="settings-invite-expiration-preset"
            value={inviteExpirationPreset()}
            onInput={(event) => setInviteExpirationPreset(event.currentTarget.value as InviteExpirationPreset)}
          >
            <option value="none">No expiration</option>
            <option value="24h">24 hours</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="custom">Custom date/time</option>
          </select>
        </div>

        <Show when={inviteExpirationPreset() === "custom"}>
          <div class="settings-audio-row invite-option-row">
            <label class="settings-label" for="settings-invite-expires-at">Expiration date</label>
            <input
              id="settings-invite-expires-at"
              type="datetime-local"
              value={inviteExpiresAtLocal()}
              onInput={(event) => setInviteExpiresAtLocal(event.currentTarget.value)}
            />
          </div>
        </Show>
      </div>

      <div class="settings-actions">
        <button type="button" onClick={() => void handleCreateInvite()} disabled={isCreatingInvite()}>
          {isCreatingInvite() ? "Creating..." : "Create invite"}
        </button>
      </div>
      <Show when={inviteError()}>
        <p class="error">{inviteError()}</p>
      </Show>
      <div class="invite-list">
        <For each={invites()}>
          {(invite) => (
            <div class={`invite-card ${invite.revoked ? "invite-revoked" : ""}`}>
              <div class="invite-card-header">
                <code class="invite-code">{invite.code}</code>
                <Show when={!invite.revoked}>
                  <button type="button" class="invite-copy-btn" onClick={() => handleCopyInviteLink(invite.code, invite.id)}>
                    {copiedInviteId() === invite.id ? "Copied" : "Copy link"}
                  </button>
                </Show>
              </div>
              <div class="invite-card-meta">
                <span>
                  {invite.single_use ? "Single-use" : "Multi-use"}
                  {invite.max_uses != null ? ` (${invite.used_count}/${invite.max_uses})` : ` (${invite.used_count} used)`}
                </span>
                <span>{formatInviteExpiry(invite.expires_at)}</span>
                <span>Created {formatInviteTimestamp(invite.created_at)}</span>
                {invite.revoked && <span class="invite-badge-revoked">Revoked</span>}
              </div>
              <Show when={!invite.revoked}>
                <button type="button" class="invite-revoke-btn" onClick={() => void handleRevokeInvite(invite.id)}>
                  Revoke
                </button>
              </Show>
            </div>
          )}
        </For>
        <Show when={invites().length === 0}>
          <p class="settings-help">No invites yet.</p>
        </Show>
      </div>
    </section>
  );
}
