# clip2manual

**English** | [日本語](./README-ja.md)

A desktop app that turns narrated screen recordings into polished, easy-to-watch manual videos.

clip2manual covers the whole pipeline — capture, transcribe, edit, re-narrate, and export — in a single tool so that non-technical members of a team can produce in-house tutorial videos on their own.

## Features

- **Screen recording**: captures screen, microphone audio, and click events together inside the app
- **Click highlights**: overlays a ripple animation on click positions to guide the viewer's eye
- **Transcription**: on-device speech-to-text via bundled `whisper.cpp`
- **Text editing**: edit the narration script segment-by-segment on the timeline
- **TTS replacement**: regenerate narration with VOICEVOX (selectable speakers)
- **Timing sync**: stretches the video to match audio length, with freeze-hold frames and a short trailing pause for a natural feel
- **Timeline editing**: split / merge / delete / trim / cut a specified range
- **Export**: render to MP4 via FFmpeg with click ripples burned in

## Tech stack

- Electron + TypeScript + React
- electron-vite / Vitest
- Tailwind CSS v4 + shadcn/ui (dark, pro-style NLE UI)
- whisper.cpp (bundled) / VOICEVOX / FFmpeg
- LLM correction through a provider abstraction (switchable between Anthropic / OpenAI / Azure)

## Setup

```sh
npm install
npm run setup:whisper    # download whisper.cpp binaries and model
npm run setup:voicevox   # download the VOICEVOX engine
npm run setup:ffmpeg     # download FFmpeg binaries
```

The same dependencies can also be provisioned from the in-app provisioning screen on first launch.

## Development

```sh
npm run dev          # start in development mode
npm run typecheck    # type-check the project
npm run test         # run Vitest
npm run build        # production build
npm start            # preview the built app
```

## Project layout

```
src/
  main/         Electron main process (recording, IPC, whisper/voicevox/ffmpeg integration, export)
  preload/     bridge to the renderer
  renderer/    React UI (Home / Recorder / Editor / Timeline)
  shared/      shared types and utilities
scripts/        setup scripts for bundled binaries
docs/           design specs (per-phase spec / plan)
vendor/         destination for bundled binaries
```

## Status

Development is organized into eight phases; per-phase specs live under `docs/superpowers/specs/`.

Already on `master`:

- [x] Phase 1 — Recording foundation
- [x] Phase 2 — Transcription + timeline
- [x] Phase 3 — Manual text editing (LLM-based correction deferred)
- [x] Phase 4 — VOICEVOX TTS replacement, with synced timed preview
- [x] Phase 5 — Click ripple preview compositing
- [x] Phase 6 — Timeline editing (split / merge / delete / trim / range cut)
- [x] Phase 7 — FFmpeg MP4 export with ripple burn-in
- [x] shadcn-based pro NLE UI redesign
- [x] Phase 8b-1 — In-app dependency provisioning (whisper / VOICEVOX / FFmpeg)

In progress / not yet started:

- [ ] Phase 3 follow-up — cloud LLM script correction
- [ ] Phase 8 — first-run wizard polish, settings screen, installer

## License & credits

- When using VOICEVOX, the **speaker must be credited** wherever the generated audio is used (follow the VOICEVOX terms of use).
- Licenses for the bundled whisper.cpp / FFmpeg / VOICEVOX binaries follow their respective upstream distributions.
