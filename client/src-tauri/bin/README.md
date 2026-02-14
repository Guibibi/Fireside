Place the Windows FFmpeg binary at `client/src-tauri/bin/ffmpeg.exe`.

This file is bundled into packaged builds and used as the default NVENC encoder probe/runner path when `YANKCORD_NATIVE_NVENC_FFMPEG_PATH` is not set.

Notes:
- The FFmpeg build must include `h264_nvenc`.
- Ensure your FFmpeg redistribution terms are compatible with your app distribution model.
