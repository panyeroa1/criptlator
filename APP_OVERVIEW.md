
# CriptLator (TranC TranL)

CriptLator is a specialized "plugin-style" platform for simultaneous transcription and translation, designed for minimal interference and maximum clarity.

## Features (Current)
- **Audio Modes (Interpretation vs. Raw)**: Listeners can toggle between "AI Interpretation" (where they hear the translated voice) and "Raw Audio" (where the translation is visual captions only, and the AI voice is muted).
- **Speaker Priority (Zero-Overlap Interruption)**: If the local user or system source becomes active (detected via RMS threshold), all currently playing translation audio is instantly killed. This allows the user to speak without hearing delayed AI echoes of their own or others' previous sentences.
- **Multi-Source Audio Capture**: 
  - **Mic**: Standard microphone input.
  - **Internal Speaker**: System audio capture (for meeting participants or video).
  - **Both**: Mixed capture of local mic and system sound.
- **Continuous Subtitle Stream**: Dual-column videoke display anchors Source Input (Left) and Translated Output (Right).
- **Stereo Panned Interpretation**: Translation audio is panned to the Right channel to provide spatial separation from the primary source audio.
- **Live Duplex Audio**: Instant audio-to-audio translation using Gemini 2.5 Native Audio.
- **Selectable Voices & Languages**: 5 premium voice profiles and 50+ target languages.

## Implementation Details
- Uses `gemini-2.5-flash-native-audio-preview-09-2025`.
- **System Audio Capture**: Uses `navigator.mediaDevices.getDisplayMedia`.
- **Stereo Panner**: `StereoPannerNode` set to `0.8` for translated output.
- **Mute Logic**: `GainNode` on the output path is controlled by `isTranslationAudioEnabled`.
- **Interruption**: `sourcesRef` (Set of `AudioBufferSourceNode`) is force-stopped when input RMS > threshold.

## Future To-Do / Not Yet Implemented
- [ ] Direct virtual driver support for native OS integration.
- [ ] Translation confidence scoring display.
- [ ] Historical transcription log export.
