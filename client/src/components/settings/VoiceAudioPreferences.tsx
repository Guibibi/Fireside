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
    <>
      <label class="settings-checkbox" for="settings-voice-noise-suppression-enabled">
        <input
          id="settings-voice-noise-suppression-enabled"
          type="checkbox"
          checked={props.voiceNoiseSuppressionEnabled}
          onInput={props.onVoiceNoiseSuppressionToggle}
        />
        Noise suppression
      </label>
      <p class="settings-help">Reduces steady background sounds from your microphone before sending audio.</p>

      <label class="settings-checkbox" for="settings-voice-echo-cancellation-enabled">
        <input
          id="settings-voice-echo-cancellation-enabled"
          type="checkbox"
          checked={props.voiceEchoCancellationEnabled}
          onInput={props.onVoiceEchoCancellationToggle}
        />
        Echo cancellation
      </label>
      <p class="settings-help">Helps prevent your speakers from feeding back into your microphone.</p>

      <label class="settings-checkbox" for="settings-voice-auto-level-enabled">
        <input
          id="settings-voice-auto-level-enabled"
          type="checkbox"
          checked={props.voiceAutoLevelEnabled}
          onInput={props.onVoiceAutoLevelToggle}
        />
        Auto level incoming voices
      </label>
      <p class="settings-help">Smooths sudden loud peaks while keeping per-user volume sliders effective.</p>

      <div class="settings-audio-row">
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

      <div class="settings-audio-row">
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
    </>
  );
}
