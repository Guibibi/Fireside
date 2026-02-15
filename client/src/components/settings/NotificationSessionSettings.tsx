interface NotificationSessionSettingsProps {
  voiceJoinSoundEnabled: boolean;
  voiceLeaveSoundEnabled: boolean;
  onVoiceJoinSoundToggle: (event: Event) => void;
  onVoiceLeaveSoundToggle: (event: Event) => void;
  onLogout: () => void;
}

export default function NotificationSessionSettings(props: NotificationSessionSettingsProps) {
  return (
    <>
      <section class="settings-section">
        <h5>Notifications</h5>
        <label class="settings-checkbox" for="settings-voice-join-sound-enabled">
          <input
            id="settings-voice-join-sound-enabled"
            type="checkbox"
            checked={props.voiceJoinSoundEnabled}
            onInput={props.onVoiceJoinSoundToggle}
          />
          Play sound when someone joins your current voice channel
        </label>

        <label class="settings-checkbox" for="settings-voice-leave-sound-enabled">
          <input
            id="settings-voice-leave-sound-enabled"
            type="checkbox"
            checked={props.voiceLeaveSoundEnabled}
            onInput={props.onVoiceLeaveSoundToggle}
          />
          Play sound when someone leaves your current voice channel
        </label>
      </section>

      <section class="settings-section">
        <h5>Session</h5>
        <p class="settings-help">Sign out from this server and return to connect screen.</p>
        <div class="settings-actions">
          <button type="button" class="settings-danger" onClick={props.onLogout}>Log out</button>
        </div>
      </section>
    </>
  );
}
