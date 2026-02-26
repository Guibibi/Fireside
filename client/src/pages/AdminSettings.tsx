import { Show, createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { get } from "../api/http";
import { CloseIcon } from "../components/icons";
import { InviteSettings } from "../components/settings-sections";
import { role } from "../stores/auth";
import { errorMessage } from "../utils/error";
import { isOperatorOrAdminRole } from "../utils/roles";

interface AdminSettingsAccessResponse {
  can_manage_invites: boolean;
}

export default function AdminSettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = createSignal(true);
  const [accessError, setAccessError] = createSignal("");

  const allowed = () => isOperatorOrAdminRole(role());

  onMount(() => {
    if (!allowed()) {
      setLoading(false);
      return;
    }

    void loadAccess();
  });

  async function loadAccess() {
    setLoading(true);
    setAccessError("");

    try {
      await get<AdminSettingsAccessResponse>("/settings/admin");
    } catch (err) {
      setAccessError(errorMessage(err, "Failed to load admin settings"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="admin-settings-page">
      <section class="settings-section admin-settings-panel">
        <div class="settings-section-head admin-settings-head">
          <div class="admin-settings-head-row">
            <h5>Admin settings</h5>
            <button
              type="button"
              class="settings-close-btn"
              onClick={() => navigate("/chat")}
              aria-label="Close admin settings"
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>
          <p class="settings-help">Operator and admin controls for privileged server settings.</p>
        </div>

        <Show when={allowed()} fallback={(
          <div class="admin-settings-denied" role="alert">
            <p class="error">You do not have permission to access admin settings.</p>
            <div class="settings-actions">
              <button type="button" onClick={() => navigate("/chat")}>Back to chat</button>
            </div>
          </div>
        )}>
          <Show when={!loading()} fallback={<p class="settings-help">Loading admin settings...</p>}>
            <Show when={!accessError()} fallback={(
              <div class="admin-settings-error" role="alert">
                <p class="error">{accessError()}</p>
                <div class="settings-actions">
                  <button type="button" onClick={() => void loadAccess()}>Retry</button>
                  <button type="button" class="settings-secondary" onClick={() => navigate("/chat")}>Back to chat</button>
                </div>
              </div>
            )}>
              <InviteSettings isOperatorOrAdmin={true} />
            </Show>
          </Show>
        </Show>
      </section>
    </div>
  );
}
