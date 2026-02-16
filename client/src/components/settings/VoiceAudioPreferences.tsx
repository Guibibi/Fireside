interface VoiceAudioPreferencesProps {
  voiceAutoLevelEnabled: boolean;
  voiceNoiseSuppressionEnabled: boolean;
  voiceEchoCancellationEnabled: boolean;
  voiceIncomingVolume: number;
  voiceOutgoingVolume: number;
  onVoiceAutoLevelToggle: (event: Event) => void;
  onVoiceNoiseSuppressionToggle: (event: Event) => void;
  onVoiceEchoCancellationToggle: (event: Event) => void;
  onVoiceIncomingVolumeInput: (event: InputEvent) => void;
  onVoiceOutgoingVolumeInput: (event: InputEvent) => void;
}

export default function VoiceAudioPreferences(props: VoiceAudioPreferencesProps) {
  return (
    <div class="settings-audio-preferences">
      <section class="settings-audio-group">
        <div class="settings-audio-group-head">
          <h6>Voice Processing</h6>
          <p class="settings-help">Reduce noise and keep speech levels more consistent.</p>
        </div>

        <div class="settings-toggle-stack">
          <label class="settings-toggle-card" for="settings-voice-noise-suppression-enabled">
            <span class="settings-toggle-copy">
              <span class="settings-toggle-title">Noise suppression</span>
              <span class="settings-help">Reduces steady background sounds from your microphone before sending audio.</span>
            </span>
            <input
              id="settings-voice-noise-suppression-enabled"
              type="checkbox"
              checked={props.voiceNoiseSuppressionEnabled}
              onInput={props.onVoiceNoiseSuppressionToggle}
            />
          </label>

          <label class="settings-toggle-card" for="settings-voice-echo-cancellation-enabled">
            <span class="settings-toggle-copy">
              <span class="settings-toggle-title">Echo cancellation</span>
              <span class="settings-help">Helps prevent your speakers from feeding back into your microphone.</span>
            </span>
            <input
              id="settings-voice-echo-cancellation-enabled"
              type="checkbox"
              checked={props.voiceEchoCancellationEnabled}
              onInput={props.onVoiceEchoCancellationToggle}
            />
          </label>

          <label class="settings-toggle-card" for="settings-voice-auto-level-enabled">
            <span class="settings-toggle-copy">
              <span class="settings-toggle-title">Auto level incoming voices</span>
              <span class="settings-help">Smooths sudden loud peaks while keeping per-user volume sliders effective.</span>
            </span>
            <input
              id="settings-voice-auto-level-enabled"
              type="checkbox"
              checked={props.voiceAutoLevelEnabled}
              onInput={props.onVoiceAutoLevelToggle}
            />
          </label>
        </div>
      </section>

      <section class="settings-audio-group">
        <div class="settings-audio-group-head">
          <h6>Volume</h6>
          <p class="settings-help">Fine tune how loud voices sound for you and for others.</p>
        </div>

        <div class="settings-slider-stack">
          <div class="settings-slider-card">
            <div class="settings-volume-header">
              <label class="settings-label" for="settings-voice-incoming-volume">Incoming voice volume</label>
              <span class="settings-volume-value">{props.voiceIncomingVolume}%</span>
            </div>
            <input
              id="settings-voice-incoming-volume"
              type="range"
              min="0"
              max="200"
              step="1"
              value={props.voiceIncomingVolume}
              onInput={props.onVoiceIncomingVolumeInput}
            />
            <p class="settings-help">Adjusts all incoming voice audio before per-user volume sliders.</p>
          </div>

          <div class="settings-slider-card">
            <div class="settings-volume-header">
              <label class="settings-label" for="settings-voice-outgoing-volume">Outgoing microphone volume</label>
              <span class="settings-volume-value">{props.voiceOutgoingVolume}%</span>
            </div>
            <input
              id="settings-voice-outgoing-volume"
              type="range"
              min="0"
              max="200"
              step="1"
              value={props.voiceOutgoingVolume}
              onInput={props.onVoiceOutgoingVolumeInput}
            />
            <p class="settings-help">Adjusts your microphone level sent to other participants.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
