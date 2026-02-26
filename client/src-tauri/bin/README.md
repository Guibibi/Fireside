This directory is kept for optional local tooling binaries.

The Windows native screen-share pipeline no longer requires a bundled `ffmpeg.exe`.
Encoding is performed in-process through the Rust `playa-ffmpeg` integration.
