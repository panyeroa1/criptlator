
# CriptLator (TranC TranL)

CriptLator is a specialized "plugin-style" platform for simultaneous transcription and translation, designed for minimal interference and maximum clarity.

## Features (Current)
- **Role-Based Architecture**:
  - **Speaker (Broadcast)**: Captures local microphone and system audio (e.g., YouTube, Zoom tabs) via `getDisplayMedia`. Transcribes the audio locally and pushes raw text to Supabase.
  - **Listener (Translate)**: Automatically mutes microphone. Subscribes to the Speaker's Supabase broadcast. Feeds the incoming text into Gemini Live for real-time translation and high-quality TTS playback.
- **Infinity UI (Lying down 8)**:
  - **Left Orb (Green)**: Visualizes source audio capture (Speaker) or incoming caption stream (Listener).
  - **Right Orb (White)**: Visualizes the AI's interpreted voice output.
- **Multi-Source Audio Capture**: 
  - **Mic**: Standard microphone input.
  - **System Audio**: Shared tab or application audio (perfect for interpreting shared videos or remote meeting participants).
- **Live Duplex Interpretation**: Uses `gemini-2.5-flash-native-audio-preview-09-2025` for sub-second latency translation.

## Implementation Details
- **Backend Relay**: Uses Supabase Realtime (`postgres_changes`) to link Speakers and Listeners globally.
- **Audio Routing**: Speakers use a `ScriptProcessorNode` to stream PCM16 audio. Listeners use `sendText` to trigger TTS translation from the broadcasted source text.
- **Visualizers**: Custom `AudioVisualizer` component with exponential smoothing for fluid orb movement.

## Testing Playground
- **Source Audio Test**: Open a YouTube video in a tab. Start CriptLator as a **Speaker**. Select the YouTube tab in the system audio share dialog.
- **Interpretation Test**: Open CriptLator in a separate browser window or device as a **Listener**. Select your preferred target language. You will hear the AI interpret the YouTube video in real-time.

## Future To-Do / Not Yet Implemented
- [ ] Direct virtual driver support for native OS integration.
- [ ] Historical transcription log export.
- [ ] User authentication and private broadcast rooms.
