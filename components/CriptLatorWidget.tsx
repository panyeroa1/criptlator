
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@^2.45.0';
import { 
  GeminiLiveService, 
  decode, 
  decodeAudioData, 
  encode 
} from '../services/geminiLiveService';
import { SupportLanguage, resolveAutoLanguage, PrebuiltVoice, SourceType, UserRole } from '../types';
import AudioVisualizer from './AudioVisualizer';

const SILENCE_THRESHOLD = 0.015; 
const SILENCE_DURATION_MS = 2500; 

const CriptLatorWidget: React.FC = () => {
  const supabase = useMemo(() => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    return createClient(url, key);
  }, []);

  const [role, setRole] = useState<UserRole>(UserRole.SPEAKER);
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSilenced, setIsSilenced] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false); 
  const [targetLanguage, setTargetLanguage] = useState<SupportLanguage>(SupportLanguage.AUTO);
  const [targetVoice, setTargetVoice] = useState<PrebuiltVoice>(PrebuiltVoice.KORE);
  const [sourceType, setSourceType] = useState<SourceType>(SourceType.MIC);
  const [inputCaption, setInputCaption] = useState<string>('');
  const [outputCaption, setOutputCaption] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const serviceRef = useRef<GeminiLiveService | null>(null);
  const activeStreamsRef = useRef<MediaStream[]>([]);
  const lastActiveTimeRef = useRef<number>(Date.now());

  // Supabase Sync for Listeners: Listen for broadcasts from the speaker
  useEffect(() => {
    if (role !== UserRole.LISTENER || !isActive || !supabase) return;

    const channel = supabase
      .channel('transcription_sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transcriptions' }, (payload) => {
        const newText = payload.new.text;
        if (newText && serviceRef.current) {
          setInputCaption(newText);
          serviceRef.current.sendText(newText);
        }
      })
      .subscribe();

    return () => { if (channel) supabase.removeChannel(channel); };
  }, [role, isActive, supabase]);

  const stopSession = useCallback(() => {
    setIsActive(false);
    setIsConnecting(false);
    setIsSilenced(false);
    setIsSpeaking(false);
    if (serviceRef.current) serviceRef.current.disconnect();
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    activeStreamsRef.current.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    activeStreamsRef.current = [];
  }, []);

  const interruptTranslation = useCallback(() => {
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    if (outputAudioCtxRef.current) nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
    setIsSpeaking(false);
  }, []);

  const startSession = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      setInputCaption('');
      setOutputCaption('');

      const resolvedLang = targetLanguage === SupportLanguage.AUTO ? resolveAutoLanguage() : targetLanguage;
      
      // Initialize Gemini Live Service
      serviceRef.current = new GeminiLiveService(process.env.API_KEY || '', resolvedLang);
      
      await serviceRef.current.connect({
        onOpen: () => {
          setIsConnecting(false);
          setIsActive(true);
        },
        onInputTranscription: (text) => {
          setInputCaption(prev => prev + (prev ? ' ' : '') + text);
          if (role === UserRole.SPEAKER && supabase) {
            // Broadcast transcription to listeners via Supabase
            supabase.from('transcriptions').insert([{ 
              text, 
              type: 'input', 
              language: resolvedLang,
              timestamp: Date.now() 
            }]).then();
          }
        },
        onOutputTranscription: (text) => setOutputCaption(prev => prev + (prev ? ' ' : '') + text),
        onAudioData: async (base64) => {
          if (!outputAudioCtxRef.current) return;
          setIsSpeaking(true);
          const buffer = await decodeAudioData(decode(base64), outputAudioCtxRef.current, 24000, 1);
          const source = outputAudioCtxRef.current.createBufferSource();
          source.buffer = buffer;
          source.connect(outputGainRef.current!);
          
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioCtxRef.current.currentTime);
          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += buffer.duration;
          
          sourcesRef.current.add(source);
          source.onended = () => {
            sourcesRef.current.delete(source);
            if (sourcesRef.current.size === 0) setIsSpeaking(false);
          };
        },
        onInterrupted: () => interruptTranslation(),
        onError: (err) => {
          setError(`Session Error: ${err.message || 'Unknown error'}`);
          stopSession();
        },
        onClose: () => stopSession()
      }, targetVoice);

      // Setup Audio Output Context
      outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputAnalyserRef.current = outputAudioCtxRef.current.createAnalyser();
      outputGainRef.current = outputAudioCtxRef.current.createGain();
      outputGainRef.current.connect(outputAnalyserRef.current);
      outputAnalyserRef.current.connect(outputAudioCtxRef.current.destination);

      // Setup Audio Input if in Speaker mode
      if (role === UserRole.SPEAKER) {
        inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        inputAnalyserRef.current = inputAudioCtxRef.current.createAnalyser();
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        activeStreamsRef.current.push(stream);
        
        const source = inputAudioCtxRef.current.createMediaStreamSource(stream);
        const processor = inputAudioCtxRef.current.createScriptProcessor(4096, 1, 1);
        
        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Basic silence detection for visual feedback
          let sum = 0;
          for(let i=0; i<inputData.length; i++) sum += Math.abs(inputData[i]);
          const avg = sum / inputData.length;
          
          if (avg < SILENCE_THRESHOLD) {
            if (Date.now() - lastActiveTimeRef.current > SILENCE_DURATION_MS) setIsSilenced(true);
          } else {
            setIsSilenced(false);
            lastActiveTimeRef.current = Date.now();
          }

          // Convert to PCM16 for Gemini Live API
          const pcm16 = new Int16Array(inputData.length);
          for(let i=0; i<inputData.length; i++) {
            pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
          }
          serviceRef.current?.sendAudio(encode(new Uint8Array(pcm16.buffer)));
        };

        source.connect(inputAnalyserRef.current);
        inputAnalyserRef.current.connect(processor);
        processor.connect(inputAudioCtxRef.current.destination);
      }

    } catch (err: any) {
      setError(`Startup Error: ${err.message || 'Failed to initialize session'}`);
      stopSession();
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-white/10 backdrop-blur-xl rounded-3xl border border-white/20 shadow-2xl text-white">
      <div className="flex flex-col md:flex-row gap-6 mb-8">
        <div className="flex-1 space-y-4">
          <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
            CriptLator Live
          </h2>
          <p className="text-white/60 text-sm">Real-time simultaneous translation and broadcast powered by Gemini.</p>
        </div>
        
        <div className="flex flex-wrap gap-3 items-center">
          <select 
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            disabled={isActive}
          >
            {Object.values(UserRole).map(r => <option key={r} value={r} className="bg-gray-900 text-white">{r}</option>)}
          </select>

          <select 
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value as SupportLanguage)}
            disabled={isActive}
          >
            <option value={SupportLanguage.AUTO} className="bg-gray-900 text-white">{SupportLanguage.AUTO}</option>
            {Object.entries(SupportLanguage).filter(([k,v]) => v !== SupportLanguage.AUTO).map(([k, v]) => (
              <option key={k} value={v as string} className="bg-gray-900 text-white">{v as string}</option>
            ))}
          </select>

          <button
            onClick={isActive ? stopSession : startSession}
            disabled={isConnecting}
            className={`px-8 py-2 rounded-xl font-bold transition-all ${
              isActive 
                ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/50' 
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20'
            }`}
          >
            {isConnecting ? 'Initializing...' : isActive ? 'Stop Session' : 'Start Session'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="bg-black/20 rounded-2xl p-6 border border-white/5 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold uppercase tracking-widest text-white/40">Source Input</span>
            {isActive && <AudioVisualizer analyser={inputAnalyserRef.current} color="#60A5FA" />}
          </div>
          <div className="min-h-[120px] max-h-[200px] overflow-y-auto text-lg leading-relaxed text-white/90">
            {inputCaption || <span className="text-white/20 italic">Awaiting audio input...</span>}
          </div>
        </div>

        {/* Output Panel */}
        <div className="bg-black/20 rounded-2xl p-6 border border-white/5 space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold uppercase tracking-widest text-white/40">Translation Output</span>
            {isActive && <AudioVisualizer analyser={outputAnalyserRef.current} color="#A78BFA" />}
          </div>
          <div className="min-h-[120px] max-h-[200px] overflow-y-auto text-lg font-medium text-blue-300">
            {outputCaption || <span className="text-white/20 italic">Translating...</span>}
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-center gap-6">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-white/10'}`} />
          <span className="text-xs text-white/40 uppercase tracking-tighter">Live Status</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-blue-500 animate-pulse' : 'bg-white/10'}`} />
          <span className="text-xs text-white/40 uppercase tracking-tighter">AI Speaking</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isSilenced ? 'bg-yellow-500' : 'bg-white/10'}`} />
          <span className="text-xs text-white/40 uppercase tracking-tighter">Silence Detected</span>
        </div>
      </div>
    </div>
  );
};

export default CriptLatorWidget;
