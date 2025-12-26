import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

export interface GeminiLiveCallbacks {
  onOpen?: () => void;
  onInputTranscription: (text: string) => void;
  onOutputTranscription: (text: string) => void;
  onAudioData: (data: string) => void;
  onInterrupted: () => void;
  onError: (error: any) => void;
  onClose?: (event: CloseEvent) => void;
}

export class GeminiLiveService {
  private sessionPromise: Promise<any> | null = null;
  private targetLanguage: string;
  private apiKey: string;

  constructor(apiKey: string, targetLanguage: string) {
    this.apiKey = apiKey;
    this.targetLanguage = targetLanguage;
  }

  connect(callbacks: GeminiLiveCallbacks, voiceName: string = 'Kore') {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    
    const systemInstruction = `
      You are CriptLator, a high-speed real-time interpretation engine.
      
      OPERATIONAL MODES:
      1. TRANSCRIPTION (Audio Stream): Your sole task is to provide a text transcription of any audio you hear. Return this in 'inputTranscription'. DO NOT generate any speech or translation for this input.
      2. INTERPRETATION & READ ALOUD (Text Input): When you receive text prefixed with "Interpret:", you must immediately:
         - Translate the text accurately into ${this.targetLanguage}.
         - Return the translation text in 'outputTranscription'.
         - ACTIVATE READ ALOUD: Immediately synthesize and return high-quality audio of you speaking this translation in a natural, professional tone.
      
      CRITICAL RULES:
      - Stay silent during Mode 1.
      - Always speak during Mode 2 as soon as text is received.
      - Be succinct and maintain high fidelity to the original meaning.
    `.trim();

    this.sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
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
        onopen: () => {
          console.debug("Gemini Live: Connection opened");
          callbacks.onOpen?.();
        },
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
          console.debug("Gemini Live: Connection closed", event);
          callbacks.onClose?.(event);
        }
      },
    });

    return this.sessionPromise;
  }

  sendAudio(base64Data: string) {
    if (this.sessionPromise) {
      this.sessionPromise.then((session) => {
        session.sendRealtimeInput({
          media: {
            data: base64Data,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      });
    }
  }

  sendText(text: string) {
    if (this.sessionPromise) {
      this.sessionPromise.then((session) => {
        session.sendRealtimeInput({
          parts: [{ text: `Interpret: ${text}` }]
        });
      });
    }
  }

  async disconnect() {
    if (this.sessionPromise) {
      const session = await this.sessionPromise;
      session.close();
      this.sessionPromise = null;
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
