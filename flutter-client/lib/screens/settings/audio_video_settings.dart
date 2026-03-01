import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../state/settings.dart';
import '../../theme/app_theme.dart';

// ---- Device list provider --------------------------------------------------

final _devicesProvider = FutureProvider<List<MediaDeviceInfo>>((ref) async {
  return Helper.enumerateDevices();
});

// ---- Screen ----------------------------------------------------------------

/// Audio and video settings: device selection, noise suppression,
/// volume sliders, and push-to-talk toggle.
class AudioVideoSettings extends ConsumerWidget {
  const AudioVideoSettings({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settingsAsync = ref.watch(settingsProvider);
    final devicesAsync = ref.watch(_devicesProvider);

    return settingsAsync.when(
      loading: () => const Center(
        child: CircularProgressIndicator(color: AppColors.accent),
      ),
      error: (_, __) => const Center(child: Text('Failed to load settings')),
      data: (settings) => _AudioVideoContent(
        settings: settings,
        devicesAsync: devicesAsync,
      ),
    );
  }
}

class _AudioVideoContent extends ConsumerWidget {
  const _AudioVideoContent({
    required this.settings,
    required this.devicesAsync,
  });

  final AppSettings settings;
  final AsyncValue<List<MediaDeviceInfo>> devicesAsync;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(settingsProvider.notifier);

    final devices = devicesAsync.valueOrNull ?? [];
    final audioInputs = devices.where((d) => d.kind == 'audioinput').toList();
    final audioOutputs = devices.where((d) => d.kind == 'audiooutput').toList();
    final videoInputs = devices.where((d) => d.kind == 'videoinput').toList();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Audio / Video', style: AppTextStyles.displaySm),
          const SizedBox(height: AppSpacing.xl),

          // ---- Input devices ----
          _SectionTitle('Input'),
          const SizedBox(height: AppSpacing.md),

          _LabeledRow(
            label: 'Microphone',
            child: _DeviceDropdown(
              devices: audioInputs,
              selectedId: settings.inputDeviceId,
              hint: 'Default microphone',
              onChanged: (id) => notifier.setInputDevice(id),
            ),
          ),

          const SizedBox(height: AppSpacing.md),

          _LabeledRow(
            label: 'Mic volume',
            child: _VolumeSlider(
              value: settings.micVolume,
              onChanged: (v) => notifier.setMicVolume(v),
            ),
          ),

          const SizedBox(height: AppSpacing.lg),

          // ---- Output devices ----
          _SectionTitle('Output'),
          const SizedBox(height: AppSpacing.md),

          _LabeledRow(
            label: 'Speaker',
            child: _DeviceDropdown(
              devices: audioOutputs,
              selectedId: settings.outputDeviceId,
              hint: 'Default speaker',
              onChanged: (id) => notifier.setOutputDevice(id),
            ),
          ),

          const SizedBox(height: AppSpacing.md),

          _LabeledRow(
            label: 'Incoming volume',
            child: _VolumeSlider(
              value: settings.incomingVolume,
              onChanged: (v) => notifier.setIncomingVolume(v),
            ),
          ),

          const SizedBox(height: AppSpacing.lg),

          // ---- Video ----
          _SectionTitle('Video'),
          const SizedBox(height: AppSpacing.md),

          _LabeledRow(
            label: 'Camera',
            child: _DeviceDropdown(
              devices: videoInputs,
              selectedId: settings.cameraDeviceId,
              hint: 'Default camera',
              onChanged: (id) => notifier.setCameraDevice(id),
            ),
          ),

          const SizedBox(height: AppSpacing.lg),

          // ---- Processing ----
          _SectionTitle('Processing'),
          const SizedBox(height: AppSpacing.md),

          _LabeledRow(
            label: 'Noise suppression',
            child: Switch(
              value: settings.noiseSuppression,
              onChanged: notifier.setNoiseSuppression,
            ),
          ),

          _LabeledRow(
            label: 'Push to talk',
            child: Switch(
              value: settings.pushToTalk,
              onChanged: notifier.setPushToTalk,
            ),
          ),

          if (settings.pushToTalk)
            Padding(
              padding: const EdgeInsets.only(
                left: AppSpacing.lg,
                bottom: AppSpacing.sm,
              ),
              child: Text(
                'Hold a key to speak. Key binding configuration coming soon.',
                style: AppTextStyles.bodySm.copyWith(color: AppColors.gray9),
              ),
            ),
        ],
      ),
    );
  }
}

// ---- Widgets ---------------------------------------------------------------

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title.toUpperCase(),
      style: AppTextStyles.headingSm.copyWith(color: AppColors.gray9),
    );
  }
}

class _LabeledRow extends StatelessWidget {
  const _LabeledRow({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(
          width: 160,
          child: Text(label, style: AppTextStyles.bodyMd),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(child: child),
      ],
    );
  }
}

class _DeviceDropdown extends StatelessWidget {
  const _DeviceDropdown({
    required this.devices,
    required this.selectedId,
    required this.hint,
    required this.onChanged,
  });

  final List<MediaDeviceInfo> devices;
  final String? selectedId;
  final String hint;
  final void Function(String? id) onChanged;

  @override
  Widget build(BuildContext context) {
    // Validate that selectedId is actually in the list
    final validId =
        devices.any((d) => d.deviceId == selectedId) ? selectedId : null;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.gray2,
        borderRadius: BorderRadius.all(AppRadius.md),
        border: Border.all(color: AppColors.gray6),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: validId,
          hint: Text(
            hint,
            style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray8),
          ),
          isExpanded: true,
          dropdownColor: AppColors.gray3,
          style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray12),
          icon: const Icon(
            Icons.keyboard_arrow_down_rounded,
            color: AppColors.gray9,
          ),
          items: [
            DropdownMenuItem<String>(
              value: null,
              child: Text(
                hint,
                style: AppTextStyles.bodyMd.copyWith(color: AppColors.gray9),
              ),
            ),
            ...devices.map((d) => DropdownMenuItem<String>(
                  value: d.deviceId,
                  child: Text(
                    d.label.isNotEmpty ? d.label : d.deviceId,
                    overflow: TextOverflow.ellipsis,
                  ),
                )),
          ],
          onChanged: onChanged,
        ),
      ),
    );
  }
}

class _VolumeSlider extends StatelessWidget {
  const _VolumeSlider({required this.value, required this.onChanged});

  final double value;
  final void Function(double) onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Slider(
            value: value.clamp(0, 100),
            min: 0,
            max: 100,
            divisions: 20,
            onChanged: onChanged,
          ),
        ),
        SizedBox(
          width: 36,
          child: Text(
            '${value.round()}',
            style: AppTextStyles.codeSm,
            textAlign: TextAlign.end,
          ),
        ),
      ],
    );
  }
}
