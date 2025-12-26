
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

export interface GeminiLiveCallbacks {
  onInputTranscription: (text: string) => void;
  onOutputTranscription: (text: string) => void;
  onAudioData: (data: string) => void;
  onInterrupted: () => void;
  onError: (error: any) => void;
}

export class GeminiLiveService {
  private session: any;
  private targetLanguage: string;
  private apiKey: string;

  constructor(apiKey: string, targetLanguage: string) {
    this.apiKey = apiKey;
    this.targetLanguage = targetLanguage;
  }

  async connect(callbacks: GeminiLiveCallbacks, voiceName: string = 'Kore') {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    
    const systemInstruction = `
      You are CriptLator, a high-performance Real-Time Simultaneous AI Interpreter and Transcriber.
      
      CORE MISSION:
      - Provide instant, low-latency transcription of any source input (audio or text).
      - If provided text, immediately translate it into ${this.targetLanguage} and read it aloud using your AI voice.
      
      OPERATIONAL PROTOCOL:
      1. ZERO-LATENCY: Respond instantly to any input. 
      2. PARALLEL STREAMING: Deliver both text results and high-quality interpreted audio.
      3. CHANNEL SEPARATION: Your primary audio output is the interpreted voice.
      
      BEHAVIOR: Act as a professional live interpreter.
    `.trim();

    try {
      this.session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              callbacks.onInputTranscription(message.serverContent.inputTranscription.text);
            }
            if (message.serverContent?.outputTranscription) {
              callbacks.onOutputTranscription(message.serverContent.outputTranscription.text);
            }
            if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
              callbacks.onAudioData(message.serverContent.modelTurn.parts[0].inlineData.data);
            }
            if (message.serverContent?.interrupted) {
              callbacks.onInterrupted();
            }
          },
          onerror: (err: any) => {
            console.error("Gemini Live Error:", err);
            callbacks.onError(err);
          },
          onclose: (event: CloseEvent) => {
            console.debug("Session closed", event);
          }
        },
      });
      return this.session;
    } catch (err: any) {
      console.error("Connection Failed:", err);
      throw err;
    }
  }

  sendAudio(base64Data: string) {
    if (this.session) {
      // Solely rely on session sendRealtimeInput for low-latency streaming
      this.session.sendRealtimeInput({
        media: {
          data: base64Data,
          mimeType: 'audio/pcm;rate=16000',
        },
      });
    }
  }

  sendText(text: string) {
    if (this.session) {
      // Send text parts through the realtime interface to trigger interpretation
      this.session.sendRealtimeInput({
        parts: [{ text: `Translate and speak aloud: ${text}` }]
      });
    }
  }

  disconnect() {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }
}

export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
