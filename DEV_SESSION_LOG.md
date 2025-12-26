
# Session Log: 20240520-143000
... (previous logs)

# Session Log: 20240522-120000
- **Start timestamp**: 2024-05-22 12:00:00
- **Objective(s)**: Implement Speaker Priority and interruption logic.
- **Results**: Modified `onaudioprocess` to clear active buffers on input detection.
- **End timestamp**: 2024-05-22 12:15:00

# Session Log: 20240522-140000
- **Start timestamp**: 2024-05-22 14:00:00
- **Objective(s)**: 
  - Add "Raw Audio" vs "AI Interpretation" toggle for listeners.
  - Refine Speaker Priority to handle seamless duplex switching.
  - Ensure local speakers don't hear their own translation echo.
- **Scope boundaries**: `components/CriptLatorWidget.tsx`, `APP_OVERVIEW.md`
- **Assumptions / risks**: 
  - Users might want to hear Raw audio from the source app (Zoom/Teams) while seeing captions.
- **Results**:
  - Added `isTranslationAudioEnabled` state and UI toggle.
  - Linked `outputGainRef` to the toggle state for instant muting of interpreted voice.
  - Strengthened `interruptTranslation` to reset `nextStartTimeRef` to `currentTime`, preventing "voice bursts" when resuming after a speaker interruption.
- **End timestamp**: 2024-05-22 14:30:00
