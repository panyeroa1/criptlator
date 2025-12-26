import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@^2.45.0';
import { 
  GeminiLiveService, 
  decode, 
  decodeAudioData, 
  encode 
} from '../services/geminiLiveService';
import { SupportLanguage, resolveAutoLanguage, PrebuiltVoice, UserRole } from '../types';
import AudioVisualizer from './AudioVisualizer';

const SAMPLES = [
  {
    id: 'sample-1',
    name: 'Sample 1: Tech Summit (English)',
    sentences: [
      "Artificial intelligence is transforming the global landscape.",
      "We are seeing a paradigm shift in how we work and create.",
      "The integration of neural networks into daily life is accelerating.",
      "Ethics and safety must remain at the forefront of development.",
      "Let's explore the future possibilities together in this session."
    ]
  },
  {
    id: 'sample-2',
    name: 'Sample 2: Conferencia (Spanish)',
    sentences: [
      "La inteligencia artificial está transformando el panorama global.",
      "Estamos viendo un cambio de paradigma en cómo trabajamos y creamos.",
      "La integración de redes neuronales en la vida diaria se está acelerando.",
      "La ética y la seguridad deben seguir siendo la prioridad del desarrollo.",
      "Exploremos juntos las posibilidades futuras en esta sesión."
    ]
  },
  {
    id: 'sample-3',
    name: 'Sample 3: サミット (Japanese)',
    sentences: [
      "人工知能はグローバルな展望を変えつつあります。",
      "仕事や創造のあり方にパラダイムシフトが起きています。",
      "日常生活へのニューラルネットワークの統合が加速しています。",
      "開発の最前線には常に倫理と安全性がなければなりません。",
      "このセッションで、未来の可能性を一緒に探っていきましょう。"
    ]
  }
];

const SpeakerIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

const VolumeIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

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
  const [targetLanguage, setTargetLanguage] = useState<SupportLanguage>(SupportLanguage.AUTO);
  const [selectedVoice, setSelectedVoice] = useState<PrebuiltVoice>(PrebuiltVoice.KORE);
  const [volume, setVolume] = useState<number>(0.8);
  const [inputCaption, setInputCaption] = useState<string>('');
  const [outputCaption, setOutputCaption] = useState<string>('');
  const [inputTimestamp, setInputTimestamp] = useState<string>('');
  const [outputTimestamp, setOutputTimestamp] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Sample playback state
  const [selectedSampleIndex, setSelectedSampleIndex] = useState<number>(-1);
  const [isSamplePlaying, setIsSamplePlaying] = useState(false);
  const sampleTimerRef = useRef<number | null>(null);
  const currentSentenceIdxRef = useRef(0);

  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const serviceRef = useRef<GeminiLiveService | null>(null);
  const activeStreamsRef = useRef<MediaStream[]>([]);

  const formatTime = () => {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  // Update volume in real-time when the state changes
  useEffect(() => {
    if (outputGainRef.current) {
      outputGainRef.current.gain.setTargetAtTime(volume, outputAudioCtxRef.current?.currentTime || 0, 0.05);
    }
  }, [volume]);

  // Supabase Sync for Listeners: Watches for new transcriptions from the Speaker
  useEffect(() => {
    if (role !== UserRole.LISTENER || !isActive || !supabase || isSamplePlaying) return;

    const channel = supabase
      .channel('criptlator_broadcast')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transcriptions' }, (payload) => {
        const text = payload.new.text;
        if (text && serviceRef.current) {
          setInputCaption(text);
          setInputTimestamp(formatTime());
          serviceRef.current.sendText(text);
        }
      })
      .subscribe();

    return () => { 
      if (channel) supabase.removeChannel(channel); 
    };
  }, [role, isActive, supabase, isSamplePlaying]);

  const stopSession = useCallback(() => {
    setIsActive(false);
    setIsConnecting(false);
    setIsSamplePlaying(false);
    if (sampleTimerRef.current) window.clearInterval(sampleTimerRef.current);
    
    if (serviceRef.current) serviceRef.current.disconnect();
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    activeStreamsRef.current.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    activeStreamsRef.current = [];
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }
  }, []);

  const playNextSampleSentence = useCallback(() => {
    if (selectedSampleIndex === -1) return;
    const sample = SAMPLES[selectedSampleIndex];
    const sentence = sample.sentences[currentSentenceIdxRef.current];
    
    setInputCaption(sentence);
    setInputTimestamp(formatTime());
    if (serviceRef.current) {
      serviceRef.current.sendText(sentence);
    }

    currentSentenceIdxRef.current = (currentSentenceIdxRef.current + 1) % sample.sentences.length;
  }, [selectedSampleIndex]);

  const toggleSamplePlayback = () => {
    if (!isActive) return;
    if (isSamplePlaying) {
      setIsSamplePlaying(false);
      if (sampleTimerRef.current) window.clearInterval(sampleTimerRef.current);
    } else {
      if (selectedSampleIndex === -1) {
        setError("Please select a sample first.");
        return;
      }
      setIsSamplePlaying(true);
      currentSentenceIdxRef.current = 0;
      playNextSampleSentence();
      // Interpretation cycles every 6 seconds for better read-aloud flow
      sampleTimerRef.current = window.setInterval(playNextSampleSentence, 6000);
    }
  };

  const startSession = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      setInputCaption('');
      setOutputCaption('');
      setInputTimestamp('');
      setOutputTimestamp('');

      const resolvedLang = targetLanguage === SupportLanguage.AUTO ? resolveAutoLanguage() : targetLanguage;
      serviceRef.current = new GeminiLiveService(process.env.API_KEY || '', resolvedLang);
      
      await serviceRef.current.connect({
        onOpen: () => {
          setIsConnecting(false);
          setIsActive(true);
        },
        onInputTranscription: (text) => {
          setInputCaption(text);
          setInputTimestamp(formatTime());
          if (role === UserRole.SPEAKER && supabase) {
            supabase.from('transcriptions').insert([{ text }]).then();
          }
        },
        onOutputTranscription: (text) => {
          setOutputCaption(text);
          setOutputTimestamp(formatTime());
        },
        onAudioData: async (base64) => {
          if (role === UserRole.SPEAKER) return; 

          if (!outputAudioCtxRef.current) return;
          const buffer = await decodeAudioData(decode(base64), outputAudioCtxRef.current, 24000, 1);
          const source = outputAudioCtxRef.current.createBufferSource();
          source.buffer = buffer;
          source.connect(outputGainRef.current!);
          
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioCtxRef.current.currentTime);
          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += buffer.duration;
          
          sourcesRef.current.add(source);
          source.onended = () => sourcesRef.current.delete(source);
        },
        onInterrupted: () => {
          sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
          sourcesRef.current.clear();
          if (outputAudioCtxRef.current) nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
        },
        onError: (err) => {
          setError(err.message || 'Network error');
          stopSession();
        },
        onClose: () => stopSession()
      }, selectedVoice);

      // Output setup for Gemini Read Aloud
      outputAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      outputAnalyserRef.current = outputAudioCtxRef.current.createAnalyser();
      outputAnalyserRef.current.fftSize = 512;
      outputGainRef.current = outputAudioCtxRef.current.createGain();
      outputGainRef.current.gain.value = volume; // Set initial volume
      
      // Chain: Source -> Gain -> Analyser (Visualize) -> Destination (Speakers)
      outputGainRef.current.connect(outputAnalyserRef.current);
      outputAnalyserRef.current.connect(outputAudioCtxRef.current.destination);

      if (role === UserRole.SPEAKER) {
        inputAudioCtxRef.current = new AudioContext({ sampleRate: 16000 });
        inputAnalyserRef.current = inputAudioCtxRef.current.createAnalyser();
        const mixedDest = inputAudioCtxRef.current.createMediaStreamDestination();

        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          activeStreamsRef.current.push(mic);
          inputAudioCtxRef.current.createMediaStreamSource(mic).connect(mixedDest);
        } catch(e) { console.warn("Mic capture failed"); }

        try {
          const sys = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
          if (sys.getAudioTracks().length > 0) {
            activeStreamsRef.current.push(sys);
            inputAudioCtxRef.current.createMediaStreamSource(sys).connect(mixedDest);
            sys.getVideoTracks().forEach(t => t.stop());
          }
        } catch (e) { console.warn("System audio capture declined"); }

        const processor = inputAudioCtxRef.current.createScriptProcessor(4096, 1, 1);
        const source = inputAudioCtxRef.current.createMediaStreamSource(mixedDest.stream);
        source.connect(inputAnalyserRef.current);
        source.connect(processor);
        processor.connect(inputAudioCtxRef.current.destination);

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(inputData.length);
          for(let i=0; i<inputData.length; i++) {
            pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
          }
          serviceRef.current?.sendAudio(encode(new Uint8Array(pcm16.buffer)));
        };
      }
    } catch (err: any) {
      setError(err.message || 'Access denied');
      stopSession();
    }
  };

  const isListener = role === UserRole.LISTENER;

  return (
    <div className="flex flex-col items-center gap-10 w-full relative">
      
      {/* Top Left: Sample Dropdown (Listener only) */}
      <div className={`absolute top-0 left-0 transition-all duration-700 z-50 ${isListener ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-10 pointer-events-none'}`}>
        <div className="bg-black/60 backdrop-blur-3xl border border-white/10 rounded-2xl p-4 flex items-center gap-4 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-white/40 uppercase font-black tracking-widest pl-1">Source Stream</span>
            <select 
              value={selectedSampleIndex}
              onChange={(e) => setSelectedSampleIndex(Number(e.target.value))}
              disabled={isActive && isSamplePlaying}
              className="bg-white/5 text-[11px] font-bold text-white/90 rounded-xl px-4 py-2 outline-none border border-white/10 cursor-pointer hover:bg-white/10 transition-all focus:ring-2 focus:ring-blue-500/50"
            >
              <option value={-1} className="bg-gray-900">Choose Sample...</option>
              {SAMPLES.map((s, idx) => (
                <option key={s.id} value={idx} className="bg-gray-900">{s.name}</option>
              ))}
            </select>
          </div>
          
          <button 
            onClick={toggleSamplePlayback}
            disabled={!isActive || selectedSampleIndex === -1}
            title={isSamplePlaying ? "Stop Interpretation" : "Start Interpretation"}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 ${!isActive || selectedSampleIndex === -1 ? 'opacity-20' : 'hover:scale-110 active:scale-95 shadow-2xl'} ${isSamplePlaying ? 'bg-red-500/30 text-red-400 border border-red-500/50 animate-pulse' : 'bg-white/10 text-white border border-white/20 hover:bg-white/20'}`}
          >
            {isSamplePlaying ? (
              <div className="w-3.5 h-3.5 bg-current rounded-sm shadow-[0_0_10px_currentColor]" />
            ) : (
              <div className="w-0 h-0 border-t-[7px] border-t-transparent border-l-[12px] border-l-current border-b-[7px] border-b-transparent ml-1 drop-shadow-[0_0_5px_rgba(255,255,255,0.5)]" />
            )}
          </button>
        </div>
      </div>

      {/* Role Switcher */}
      <div className="flex bg-black/60 p-2 rounded-full border border-white/10 backdrop-blur-3xl shadow-2xl relative z-50">
        <button
          onClick={() => setRole(UserRole.SPEAKER)}
          disabled={isActive}
          className={`px-10 py-3 rounded-full text-[11px] font-black uppercase tracking-[0.3em] transition-all duration-500 ${role === UserRole.SPEAKER ? 'bg-white text-black shadow-2xl scale-105' : 'text-white/30 hover:text-white/70 disabled:opacity-20'}`}
        >
          Speaker
        </button>
        <button
          onClick={() => setRole(UserRole.LISTENER)}
          disabled={isActive}
          className={`px-10 py-3 rounded-full text-[11px] font-black uppercase tracking-[0.3em] transition-all duration-500 ${role === UserRole.LISTENER ? 'bg-white text-black shadow-2xl scale-105' : 'text-white/30 hover:text-white/70 disabled:opacity-20'}`}
        >
          Listener
        </button>
      </div>

      {/* Infinity Widget */}
      <div className="relative flex items-center justify-center h-56 w-[680px]">
        
        {/* BIG Central Play Button & Visualizer Hub */}
        <div className="absolute z-40 flex flex-col items-center gap-6">
          <div className="relative group">
            {isActive && (
              <div className="absolute inset-0 -m-20 flex items-center justify-center pointer-events-none overflow-visible">
                {/* Voice In (Green) - Captures user/source input */}
                <div className="absolute left-[-130px] top-1/2 -translate-y-1/2 scale-x-[-1] opacity-60">
                  <AudioVisualizer analyser={inputAnalyserRef.current} color="#22c55e" width={240} height={200} mode="center" />
                </div>
                {/* Voice Out (White) - Gemini Read Aloud Visualization */}
                <div className="absolute right-[-130px] top-1/2 -translate-y-1/2 opacity-60">
                  <AudioVisualizer analyser={outputAnalyserRef.current} color="#ffffff" width={240} height={200} mode="center" />
                </div>
                {/* Dynamic Aura Pulses */}
                <div className="absolute inset-0 flex items-center justify-center">
                   <AudioVisualizer analyser={outputAnalyserRef.current} color="#ffffff33" width={320} height={320} mode="radial" />
                   <AudioVisualizer analyser={inputAnalyserRef.current} color="#22c55e22" width={360} height={360} mode="radial" />
                </div>
              </div>
            )}

            <button
              onClick={isActive ? stopSession : startSession}
              disabled={isConnecting}
              className={`w-44 h-44 rounded-full border-[6px] border-white/10 flex items-center justify-center transition-all duration-1000 shadow-[0_0_100px_rgba(0,0,0,0.9)] relative z-10 overflow-hidden ${isActive ? (isListener ? 'bg-white text-black border-white/40 ring-4 ring-white/20' : 'bg-black/95 text-red-500 border-red-500/20') : 'bg-white/5 text-white hover:bg-white/10 hover:scale-105 active:scale-95 ring-1 ring-white/20'}`}
            >
              {isActive && (
                <>
                  <div className={`absolute inset-0 rounded-full animate-pulse pointer-events-none ${isListener ? 'bg-white/10' : 'bg-red-500/10'}`} />
                  <div className="absolute inset-0 flex items-center justify-center opacity-60">
                    <AudioVisualizer 
                       analyser={role === UserRole.SPEAKER ? inputAnalyserRef.current : outputAnalyserRef.current} 
                       color={role === UserRole.SPEAKER ? "#22c55e" : (isListener ? "#000000" : "#ffffff")} 
                       width={180} 
                       height={180} 
                       mode="radial" 
                    />
                  </div>
                </>
              )}
              
              {isConnecting ? (
                <div className="w-16 h-16 border-[6px] border-white border-t-transparent animate-spin rounded-full" />
              ) : isActive ? (
                isListener ? (
                  <SpeakerIcon className="w-16 h-16 relative z-20 transition-transform duration-500" />
                ) : (
                  <div className="w-14 h-14 bg-current rounded-lg shadow-2xl relative z-20" />
                )
              ) : (
                <div className="w-0 h-0 border-t-[28px] border-t-transparent border-l-[44px] border-l-current border-b-[28px] border-b-transparent ml-3 drop-shadow-[0_0_20px_rgba(255,255,255,0.4)] relative z-20" />
              )}
            </button>
          </div>
          
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-row items-center gap-2">
              <div className="flex flex-col items-center bg-black/80 px-8 py-3 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-2xl ring-1 ring-white/5">
                <span className="text-[10px] text-white/40 font-black uppercase tracking-[0.5em] mb-1.5">Target Language</span>
                <select 
                  value={targetLanguage} 
                  onChange={(e) => setTargetLanguage(e.target.value as SupportLanguage)}
                  disabled={isActive}
                  className="bg-transparent text-[11px] uppercase font-black tracking-[0.2em] text-white/90 outline-none cursor-pointer appearance-none text-center hover:text-white transition-colors"
                >
                  <option value={SupportLanguage.AUTO}>Auto Detect</option>
                  {Object.values(SupportLanguage).filter(l => l !== SupportLanguage.AUTO).map(l => (
                    <option key={l} value={l} className="bg-gray-900">{l}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col items-center bg-black/80 px-8 py-3 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-2xl ring-1 ring-white/5">
                <span className="text-[10px] text-white/40 font-black uppercase tracking-[0.5em] mb-1.5">Voice Tone</span>
                <select 
                  value={selectedVoice} 
                  onChange={(e) => setSelectedVoice(e.target.value as PrebuiltVoice)}
                  disabled={isActive}
                  className="bg-transparent text-[11px] uppercase font-black tracking-[0.2em] text-white/90 outline-none cursor-pointer appearance-none text-center hover:text-white transition-colors"
                >
                  {Object.values(PrebuiltVoice).map(v => (
                    <option key={v} value={v} className="bg-gray-900">{v}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Volume Control */}
            <div className="flex flex-col items-center bg-black/80 w-full px-8 py-3 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-2xl ring-1 ring-white/5 group">
              <div className="flex items-center gap-3 w-full">
                <VolumeIcon className="w-4 h-4 text-white/40 group-hover:text-white/80 transition-colors" />
                <input 
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="flex-1 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white transition-all hover:bg-white/20"
                />
                <span className="text-[9px] font-mono text-white/40 w-6 text-right">{Math.round(volume * 100)}%</span>
              </div>
              <span className="text-[8px] text-white/20 font-black uppercase tracking-[0.5em] mt-1.5 pointer-events-none">Interpretation Volume</span>
            </div>
          </div>
        </div>

        {/* Left Orb (Broadcast In) */}
        <div className="relative w-80 h-48 bg-black/40 backdrop-blur-3xl rounded-full border border-white/10 -mr-28 overflow-hidden flex items-center justify-start pl-16 pr-32 shadow-[inset_0_0_60px_rgba(34,197,94,0.03)] ring-1 ring-white/10 group">
          <div className="absolute inset-0 pointer-events-none opacity-20 bg-gradient-to-r from-green-500/20 via-transparent to-transparent group-hover:opacity-40 transition-opacity duration-1000" />
          <div className="flex flex-col gap-3 w-full max-w-[220px] z-10">
             <div className="flex items-center gap-2">
               <div className={`w-2.5 h-2.5 rounded-full ${isActive ? 'bg-green-500 animate-pulse shadow-[0_0_15px_#22c55e]' : 'bg-white/10'}`} />
               <span className="text-[10px] uppercase font-black tracking-[0.3em] text-white/40">
                 {isListener ? "Source Input" : "Broadcast In"}
               </span>
               {inputTimestamp && (
                 <span className="text-[9px] font-mono text-green-500/50 ml-auto">[{inputTimestamp}]</span>
               )}
             </div>
             <div className="text-[13px] text-white/90 font-medium h-20 overflow-hidden line-clamp-4 leading-relaxed tracking-wide transition-all duration-300">
               {inputCaption || (isActive ? (role === UserRole.SPEAKER ? "Streaming Source..." : isSamplePlaying ? "Injecting Sample..." : "Awaiting Feed...") : "Standby")}
             </div>
          </div>
        </div>

        {/* Right Orb (Read Aloud Output) */}
        <div className="relative w-80 h-48 bg-black/40 backdrop-blur-3xl rounded-full border border-white/10 -ml-28 overflow-hidden flex items-center justify-end pr-16 pl-32 shadow-[inset_0_0_60px_rgba(255,255,255,0.03)] ring-1 ring-white/10 group">
          <div className="absolute inset-0 pointer-events-none opacity-20 bg-gradient-to-l from-white/10 via-transparent to-transparent group-hover:opacity-40 transition-opacity duration-1000" />
          <div className="flex flex-col items-end gap-3 w-full max-w-[220px] z-10">
             <div className="flex items-center gap-2 flex-row-reverse">
               <div className={`w-2.5 h-2.5 rounded-full ${isActive && outputCaption ? 'bg-white animate-pulse shadow-[0_0_15px_#ffffff]' : 'bg-white/10'}`} />
               <span className="text-[10px] uppercase font-black tracking-[0.3em] text-white/40">
                 {isListener ? "AI Speaker" : "Translation Out"}
               </span>
               {outputTimestamp && (
                 <span className="text-[9px] font-mono text-white/30 mr-auto">[{outputTimestamp}]</span>
               )}
             </div>
             <div className="text-[13px] text-blue-300 font-bold h-20 overflow-hidden line-clamp-4 leading-relaxed text-right italic tracking-wide transition-all duration-300">
               {outputCaption || (isActive ? (role === UserRole.SPEAKER ? "Monitoring..." : "Interpreting...") : "...")}
             </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-12 py-5 rounded-full bg-red-500/20 border border-red-500/40 text-red-400 text-[11px] uppercase font-black tracking-[0.5em] animate-bounce shadow-2xl backdrop-blur-3xl ring-2 ring-red-500/20">
          {error}
        </div>
      )}
    </div>
  );
};

export default CriptLatorWidget;
