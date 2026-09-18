---
name: video-analyze
description: Analyze and transform local video with the desktop Video studio (FFmpeg/FFprobe).
---

# Video analysis (desktop)

Use this when the user wants to inspect, convert, cut, or otherwise work with video files **on this machine**. Media stays local — nothing is uploaded.

## Where it lives

Desktop only: **Video** in the sidebar (`/video`). No engine connection is required — Mode selection has a Video studio entry. FFmpeg and FFprobe run as the Tauri sidecar (or from `PATH`). The browser web client does not run these tools.

Setup once per machine:

```bash
cd apps/desktop
pnpm setup:sidecars    # links Homebrew/PATH ffmpeg + ffprobe
# optional: brew install yt-dlp   # YouTube download
```

## Tools

| Group | Route | What to use it for |
|---|---|---|
| Inspect | `/video/probe` | Container, duration, bit rate, every stream (codec, FPS, size, language) |
| Convert | `/video/transcode` | Re-encode (software/hardware), burn or copy subs, mux streams |
| Convert | `/video/extract` | Audio (MP3/AAC/FLAC/WAV/Opus) or subs (SRT/ASS/VTT) |
| Convert | `/video/gif` | Palette GIF from a time range |
| Convert | `/video/download` | Public YouTube watch/shorts/playlist via yt-dlp |
| Edit | `/video/trim` `/video/clips` `/video/concat` | Cut, mark in/out, join |
| Edit | `/video/crop` `/video/resize` `/video/transform` | Rectangle, scale, rotate/flip |
| Edit | `/video/speed` `/video/fade` `/video/volume` `/video/watermark` | Rate, fade, gain/loudnorm, overlay |
| App | `/video/viewer` | Play, frame step, snapshot |
| App | `/video/timeline` | Multi-track NLE + export/proxy |
| App | `/video/jobs` | Last 50 runs, reveal output, rerun |

Picking a file on Home remembers it (`?file=`) across tools.

## Agent notes

- Prefer **Analyze** (`probe`) before any encode so duration/streams are known.
- Jobs emit `ffmpeg-progress` and can be cancelled. History is `localStorage` (`neos-video:job-history`).
- Hardware encoders are whatever the local FFmpeg reports (VideoToolbox / NVENC / QSV). Failed HW encodes retry in software.
- Timeline export is unlocked in NEOS Work (no video-rs Pro license gate).
- Do not add upload APIs or a second cloud job queue for this studio.
