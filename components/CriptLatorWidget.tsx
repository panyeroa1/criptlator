
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
  // Use useMemo to lazily initialize Supabase only if environment variables are present.
  const supabase = useMemo(() => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key || url === '' || key === '') {
      console.warn("Supabase environment variables are missing. Syncing features will be disabled.");
      return null;
    }
    return createClient(url, key);
  }, []);

  const [role, setRole] = useState<UserRole>(UserRole.SPEAKER);
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSilenced, setIsSilenced] = useState(false);
  const [isMuted, setIsMuted] = useState(false); 
  const [isSpeaking, setIsSpeaking] = useState(false); 
  const [isTranslationAudioEnabled, setIsTranslationAudioEnabled] = useState(true); 
  const [translationVolume, setTranslationVolume] = useState(1.0); 
  const [targetLanguage, setTargetLanguage] = useState<SupportLanguage>(SupportLanguage.AUTO);
  const [targetVoice, setTargetVoice] = useState<PrebuiltVoice>(PrebuiltVoice.KORE);
  const [sourceType, setSourceType] = useState<SourceType>(SourceType.MIC);
  const [inputCaption, setInputCaption] = useState<string>('');
  const [outputCaption, setOutputCaption] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Audio Refs
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const serviceRef = useRef<GeminiLiveService | null>(null);
  const activeStreamsRef = useRef<MediaStream[]>([]);
  const currentTurnRef = useRef<{ source: string; translation: string }>({ source: '', translation: '' });
  const lastActiveTimeRef = useRef<number>(Date.now());

  // Listen for Supabase Realtime in LISTENER mode
  useEffect(() => {
    if (role !== UserRole.LISTENER || !isActive || !supabase) return;

    // Subscribe to transcription channel for remote updates
    const channel = supabase
      .channel('transcription_sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transcriptions' }, (payload) => {
        const newText = payload.new.text;
        if (newText && serviceRef.current) {
          setInputCaption(newText);
          // Pass the broadcasted text to Gemini Live for translation and audio read-aloud
          serviceRef.current.sendText(newText);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, isActive, supabase]);

  // Sync translation audio properties (volume/mute)
  useEffect(() => {
    if (outputGainRef.current) {
      const targetGain = isTranslationAudioEnabled ? translationVolume : 0;
      outputGainRef.current.gain.setTargetAtTime(targetGain, outputAudioCtxRef.current?.currentTime || 0, 0.1);
    }
  }, [isTranslationAudioEnabled, translationVolume]);

  const stopSession = useCallback(() => {
    setIsActive(false);
    setIsConnecting(false);
    setIsSilenced(false);
    setIsMuted(false);
    setIsSpeaking(false);
    if (serviceRef.current) serviceRef.current.disconnect();
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    activeStreamsRef.current.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    activeStreamsRef.current = [];
    currentTurnRef.current = { source: '', translation: '' };
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
      setIsSilenced(false);
      setIsMuted(false);
      lastActiveTimeRef.current = Date.now();
      
      const apiKey = process.env.API_KEY || '';
      const effectiveLanguage = targetLanguage === SupportLanguage.AUTO ? resolveAutoLanguage() : targetLanguage;
      const service = new GeminiLiveService(apiKey, effectiveLanguage);
      serviceRef.current = service;

      // Audio Output Configuration
      if (!outputAudioCtxRef.current) outputAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      const outputCtx = outputAudioCtxRef.current;
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      const outputAnalyser = outputCtx.createAnalyser();
      outputAnalyser.fftSize = 64;
      outputAnalyserRef.current = outputAnalyser;

      const outputGain = outputCtx.createGain();
      outputGain.gain.setValueAtTime(isTranslationAudioEnabled ? translationVolume : 0, outputCtx.currentTime);
      outputGainRef.current = outputGain;

      outputGain.connect(outputAnalyser);
      outputAnalyser.connect(outputCtx.destination);

      await service.connect({
        onInputTranscription: (text) => {
          if (role === UserRole.SPEAKER) {
            setInputCaption(prev => {
              const fullText = (prev + ' ' + text).trim();
              currentTurnRef.current.source = fullText;
              // Broadcast to Supabase if available
              if (supabase) {
                supabase.from('transcriptions').insert({ text: text }).then();
              }
              return fullText.split(' ').slice(-15).join(' ');
            });
          }
        },
        onOutputTranscription: (text) => {
          setOutputCaption(prev => {
            const fullText = (prev + ' ' + text).trim();
            currentTurnRef.current.translation = fullText;
            return fullText.split(' ').slice(-15).join(' ');
          });
        },
        onAudioData: async (base64) => {
          const data = decode(base64);
          const buffer = await decodeAudioData(data, outputCtx, 24000, 1);
          const audioSource = outputCtx.createBufferSource();
          audioSource.buffer = buffer;
          audioSource.connect(outputGain);
          
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
          audioSource.start(nextStartTimeRef.current);
          nextStartTimeRef.current += buffer.duration;
          
          setIsSpeaking(true);
          sourcesRef.current.add(audioSource);
          audioSource.onended = () => {
            sourcesRef.current.delete(audioSource);
            if (sourcesRef.current.size === 0) setIsSpeaking(false);
          };
        },
        onInterrupted: () => interruptTranslation(),
        onError: (err) => { setError(err.message); stopSession(); },
      }, targetVoice);

      if (role === UserRole.SPEAKER) {
        // Speaker captures audio from selected source
        if (!inputAudioCtxRef.current) inputAudioCtxRef.current = new AudioContext({ sampleRate: 16000 });
        const inputCtx = inputAudioCtxRef.current;
        if (inputCtx.state === 'suspended') await inputCtx.resume();

        const inputAnalyser = inputCtx.createAnalyser();
        inputAnalyser.fftSize = 64;
        inputAnalyserRef.current = inputAnalyser;

        const destinationNode = inputCtx.createMediaStreamDestination();
        
        if (sourceType === SourceType.MIC || sourceType === SourceType.BOTH) {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          activeStreamsRef.current.push(micStream);
          inputCtx.createMediaStreamSource(micStream).connect(destinationNode);
        }
        if (sourceType === SourceType.SYSTEM || sourceType === SourceType.BOTH) {
          try {
            const sysStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            activeStreamsRef.current.push(sysStream);
            inputCtx.createMediaStreamSource(sysStream).connect(destinationNode);
            // We only need the audio part of system capture
            sysStream.getVideoTracks().forEach(t => t.stop());
          } catch (e) {
            console.warn("System audio capture declined or unavailable.");
          }
        }

        const mixedSource = inputCtx.createMediaStreamSource(destinationNode.stream);
        const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
        mixedSource.connect(inputAnalyser);
        mixedSource.connect(scriptProcessor);
        scriptProcessor.connect(inputCtx.destination);

        scriptProcessor.onaudioprocess = (e) => {
          if (!isActive || isMuted) return;
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Silence detection and activity monitoring
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
          const rms = Math.sqrt(sum / inputData.length);
          
          if (rms > SILENCE_THRESHOLD) {
            lastActiveTimeRef.current = Date.now();
            if (isSilenced) setIsSilenced(false);
            
            // Convert to PCM 16-bit for Gemini
            const int16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              int16[i] = Math.max(-1, Math.min(1, inputData[i])) * 32768;
            }
            const base64 = encode(new Uint8Array(int16.buffer));
            service.sendAudio(base64);
          } else if (Date.now() - lastActiveTimeRef.current > SILENCE_DURATION_MS) {
            if (!isSilenced) setIsSilenced(true);
          }
        };
      }

      setIsActive(true);
      setIsConnecting(false);
    } catch (err: any) {
      setError(err.message || "Failed to start session");
      stopSession();
    }
  };

  const handleToggle = () => {
    if (isActive) stopSession();
    else startSession();
  };

  return (
    <div className="w-[450px] bg-gray-900/80 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl transition-all duration-500 hover:border-white/20">
      {/* Header Branding */}
      <div className="px-6 py-5 flex items-center justify-between border-b border-white/5 bg-white/5">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full animate-pulse ${isActive ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.6)]' : 'bg-gray-600'}`} />
          <h1 className="text-white font-bold text-lg tracking-tight">CriptLator <span className="text-[10px] text-white/30 font-normal uppercase tracking-widest ml-1">Live</span></h1>
        </div>
        <button 
          onClick={() => setRole(role === UserRole.SPEAKER ? UserRole.LISTENER : UserRole.SPEAKER)}
          disabled={isActive}
          className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${role === UserRole.SPEAKER ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'} disabled:opacity-50`}
        >
          {role === UserRole.SPEAKER ? 'Broadcast' : 'Translate'}
        </button>
      </div>

      <div className="p-6 space-y-6">
        {/* Error Notification */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-xl text-red-400 text-xs flex items-center gap-3">
            <span className="text-lg">⚠️</span> {error}
          </div>
        )}

        {/* Configuration Interface */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest ml-1">Target Language</label>
            <select 
              value={targetLanguage} 
              onChange={(e) => setTargetLanguage(e.target.value as SupportLanguage)}
              disabled={isActive}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors cursor-pointer appearance-none"
            >
              <option value={SupportLanguage.AUTO}>Auto Detect</option>
              {Object.values(SupportLanguage).filter(l => l !== SupportLanguage.AUTO).map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest ml-1">AI Voice</label>
            <select 
              value={targetVoice} 
              onChange={(e) => setTargetVoice(e.target.value as PrebuiltVoice)}
              disabled={isActive}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-colors cursor-pointer appearance-none"
            >
              {Object.values(PrebuiltVoice).map(voice => (
                <option key={voice} value={voice}>{voice}</option>
              ))}
            </select>
          </div>
        </div>

        {role === UserRole.SPEAKER && (
          <div className="space-y-1.5">
            <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest ml-1">Audio Source</label>
            <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
              {Object.values(SourceType).map(type => (
                <button
                  key={type}
                  onClick={() => setSourceType(type)}
                  disabled={isActive}
                  className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${sourceType === type ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/60'}`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Transcription and Visualization Console */}
        <div className="bg-black/40 rounded-3xl border border-white/5 p-5 min-h-[220px] flex flex-col justify-between space-y-4">
          <div className="flex flex-col gap-4">
            {/* Input Transcript Display */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-emerald-400 font-black uppercase tracking-widest">Input Stream</span>
                  {isSilenced && <span className="text-[9px] text-white/20 uppercase font-bold">Silence Detected</span>}
                </div>
                <div className="text-white/90 text-sm leading-relaxed min-h-[40px] italic">
                  {inputCaption || (isActive ? (isSilenced ? "Waiting for sound..." : "Listening...") : "System Ready.")}
                </div>
              </div>
              <AudioVisualizer analyser={inputAnalyserRef.current} color="#10b981" width={80} height={30} />
            </div>

            <div className="h-px bg-white/5" />

            {/* Output Transcript Display */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-blue-400 font-black uppercase tracking-widest">Interpretation</span>
                  {isSpeaking && <div className="flex gap-0.5"><div className="w-1 h-1 bg-blue-400 rounded-full animate-bounce" /><div className="w-1 h-1 bg-blue-400 rounded-full animate-bounce [animation-delay:0.2s]" /><div className="w-1 h-1 bg-blue-400 rounded-full animate-bounce [animation-delay:0.4s]" /></div>}
                </div>
                <div className="text-white text-base font-medium leading-relaxed min-h-[48px]">
                  {outputCaption}
                </div>
              </div>
              <AudioVisualizer analyser={outputAnalyserRef.current} color="#3b82f6" width={80} height={30} />
            </div>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/5">
          <div className="flex-1 space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">Volume</label>
              <span className="text-[9px] text-white/60 font-mono">{Math.round(translationVolume * 100)}%</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.01" 
              value={translationVolume} 
              onChange={(e) => setTranslationVolume(parseFloat(e.target.value))}
              className="w-full accent-blue-500 h-1 bg-white/10 rounded-lg cursor-pointer"
            />
          </div>
          <button 
            onClick={() => setIsTranslationAudioEnabled(!isTranslationAudioEnabled)}
            className={`p-3 rounded-xl transition-all ${isTranslationAudioEnabled ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-white/20'}`}
          >
            {isTranslationAudioEnabled ? '🔊' : '🔇'}
          </button>
        </div>

        {/* Primary Toggle Button */}
        <button
          onClick={handleToggle}
          disabled={isConnecting}
          className={`w-full py-5 rounded-2xl font-black text-sm uppercase tracking-[0.2em] transition-all transform active:scale-[0.98] ${
            isActive 
              ? 'bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20' 
              : 'bg-white text-black hover:bg-white/90 shadow-[0_0_30px_rgba(255,255,255,0.1)]'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isConnecting ? 'Syncing Hardware...' : isActive ? 'Terminate Session' : 'Initiate Session'}
        </button>
      </div>
      
      {/* Footer Disclaimer */}
      <div className="px-6 py-4 bg-white/2 border-t border-white/5 flex justify-between items-center">
        <span className="text-[8px] text-white/20 uppercase font-black tracking-widest">Neural Link: AES-256 Enabled</span>
        <span className="text-[8px] text-white/20 uppercase font-black tracking-widest">Powered by EBURON.AI</span>
      </div>
    </div>
  );
};

export default CriptLatorWidget;
