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

  // Supabase Sync for Listeners: Watches for new transcriptions from the Speaker
  useEffect(() => {
    if (role !== UserRole.LISTENER || !isActive || !supabase) return;

    const channel = supabase
      .channel('criptlator_broadcast')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transcriptions' }, (payload) => {
        const text = payload.new.text;
        if (text && serviceRef.current) {
          setInputCaption(text);
          // Broadcast text triggers the Listener's AI to interpret and speak
          serviceRef.current.sendText(text);
        }
      })
      .subscribe();

    return () => { 
      if (channel) supabase.removeChannel(channel); 
    };
  }, [role, isActive, supabase]);

  const stopSession = useCallback(() => {
    setIsActive(false);
    setIsConnecting(false);
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

  const startSession = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      setInputCaption('');
      setOutputCaption('');

      const resolvedLang = targetLanguage === SupportLanguage.AUTO ? resolveAutoLanguage() : targetLanguage;
      serviceRef.current = new GeminiLiveService(process.env.API_KEY || '', resolvedLang);
      
      await serviceRef.current.connect({
        onOpen: () => {
          setIsConnecting(false);
          setIsActive(true);
        },
        onInputTranscription: (text) => {
          setInputCaption(text);
          // Push transcription to broadcast only if we are the speaker
          if (role === UserRole.SPEAKER && supabase) {
            supabase.from('transcriptions').insert([{ text }]).then();
          }
        },
        onOutputTranscription: (text) => setOutputCaption(text),
        onAudioData: async (base64) => {
          // RULE: Speaker does not listen to their own interpretation
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
      }, PrebuiltVoice.KORE);

      // Setup output path (AI Translation Audio)
      outputAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      outputAnalyserRef.current = outputAudioCtxRef.current.createAnalyser();
      outputGainRef.current = outputAudioCtxRef.current.createGain();
      outputGainRef.current.connect(outputAnalyserRef.current);
      outputAnalyserRef.current.connect(outputAudioCtxRef.current.destination);

      if (role === UserRole.SPEAKER) {
        // Setup input path (Source Audio)
        inputAudioCtxRef.current = new AudioContext({ sampleRate: 16000 });
        inputAnalyserRef.current = inputAudioCtxRef.current.createAnalyser();
        const mixedDest = inputAudioCtxRef.current.createMediaStreamDestination();

        // 1. Microphone capture
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          activeStreamsRef.current.push(mic);
          inputAudioCtxRef.current.createMediaStreamSource(mic).connect(mixedDest);
        } catch(e) { console.warn("Mic capture failed/declined"); }

        // 2. System/Internal capture
        try {
          const sys = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
          if (sys.getAudioTracks().length > 0) {
            activeStreamsRef.current.push(sys);
            inputAudioCtxRef.current.createMediaStreamSource(sys).connect(mixedDest);
            sys.getVideoTracks().forEach(t => t.stop());
          }
        } catch (e) { console.warn("System audio capture declined/unavailable"); }

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

  return (
    <div className="flex flex-col items-center gap-10">
      {/* Role Switcher - Locked when active */}
      <div className="flex bg-black/50 p-1.5 rounded-full border border-white/10 backdrop-blur-xl shadow-2xl relative z-50">
        <button
          onClick={() => setRole(UserRole.SPEAKER)}
          disabled={isActive}
          className={`px-8 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[0.2em] transition-all duration-300 ${role === UserRole.SPEAKER ? 'bg-white text-black shadow-xl scale-105' : 'text-white/40 hover:text-white/70 disabled:opacity-30'}`}
        >
          Speaker
        </button>
        <button
          onClick={() => setRole(UserRole.LISTENER)}
          disabled={isActive}
          className={`px-8 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[0.2em] transition-all duration-300 ${role === UserRole.LISTENER ? 'bg-white text-black shadow-xl scale-105' : 'text-white/40 hover:text-white/70 disabled:opacity-30'}`}
        >
          Listener
        </button>
      </div>

      {/* Infinity Widget */}
      <div className="relative flex items-center justify-center h-48 w-[640px]">
        
        {/* BIG Central Play Button & Visualizer Hub */}
        <div className="absolute z-40 flex flex-col items-center gap-4">
          <div className="relative group">
            {/* Real-time Audio Visualizers Layered in the Center */}
            {isActive && (
              <div className="absolute inset-0 -m-16 flex items-center justify-center pointer-events-none overflow-visible">
                {/* Voice In (Green) */}
                <div className="absolute left-[-115px] top-1/2 -translate-y-1/2 scale-x-[-1]">
                  <AudioVisualizer analyser={inputAnalyserRef.current} color="#22c55e" width={220} height={180} mode="center" />
                </div>
                {/* Voice Out (White) */}
                <div className="absolute right-[-115px] top-1/2 -translate-y-1/2">
                  <AudioVisualizer analyser={outputAnalyserRef.current} color="#ffffff" width={220} height={180} mode="center" />
                </div>
                {/* Concentric Pulses */}
                <div className="absolute inset-0 flex items-center justify-center">
                   <AudioVisualizer analyser={outputAnalyserRef.current} color="#ffffff22" width={280} height={280} mode="radial" />
                   <AudioVisualizer analyser={inputAnalyserRef.current} color="#22c55e11" width={320} height={320} mode="radial" />
                </div>
              </div>
            )}

            <button
              onClick={isActive ? stopSession : startSession}
              disabled={isConnecting}
              className={`w-40 h-40 rounded-full border-4 border-white/10 flex items-center justify-center transition-all duration-700 shadow-[0_0_80px_rgba(0,0,0,0.9)] relative z-10 overflow-hidden ${isActive ? 'bg-black/90 text-red-500 border-white/5' : 'bg-white/5 text-white hover:bg-white/10 hover:scale-105 active:scale-95'}`}
            >
              {isActive && (
                <>
                  <div className="absolute inset-0 rounded-full bg-red-500/5 animate-pulse pointer-events-none" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-40">
                    {/* Radial visualization centered inside the button */}
                    <AudioVisualizer 
                       analyser={role === UserRole.SPEAKER ? inputAnalyserRef.current : outputAnalyserRef.current} 
                       color={role === UserRole.SPEAKER ? "#22c55e" : "#ffffff"} 
                       width={160} 
                       height={160} 
                       mode="radial" 
                    />
                  </div>
                </>
              )}
              
              {isConnecting ? (
                <div className="w-14 h-14 border-4 border-white border-t-transparent animate-spin rounded-full" />
              ) : isActive ? (
                <div className="w-12 h-12 bg-current rounded-sm shadow-2xl relative z-20" />
              ) : (
                <div className="w-0 h-0 border-t-[24px] border-t-transparent border-l-[40px] border-l-current border-b-[24px] border-b-transparent ml-2 drop-shadow-2xl relative z-20" />
              )}
            </button>
          </div>
          
          <div className="flex flex-col items-center bg-black/80 px-6 py-2 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-xl">
             <span className="text-[10px] text-white/40 font-black uppercase tracking-[0.5em] mb-1">Target Language</span>
             <select 
              value={targetLanguage} 
              onChange={(e) => setTargetLanguage(e.target.value as SupportLanguage)}
              disabled={isActive}
              className="bg-transparent text-xs uppercase font-black tracking-[0.2em] text-white/90 outline-none cursor-pointer appearance-none text-center"
            >
              <option value={SupportLanguage.AUTO}>Auto Detect</option>
              {Object.values(SupportLanguage).filter(l => l !== SupportLanguage.AUTO).map(l => (
                <option key={l} value={l} className="bg-gray-900">{l}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Left Orb (Voice In - Source) */}
        <div className="relative w-80 h-44 bg-black/40 backdrop-blur-3xl rounded-full border border-white/10 -mr-24 overflow-hidden flex items-center justify-start pl-14 pr-28 shadow-[inset_0_0_50px_rgba(34,197,94,0.02)] ring-1 ring-white/5 group">
          <div className="absolute inset-0 pointer-events-none opacity-10 bg-gradient-to-r from-green-500/20 via-transparent to-transparent group-hover:opacity-30 transition-opacity duration-700" />
          <div className="flex flex-col gap-2 w-full max-w-[200px] z-10">
             <div className="flex items-center gap-2">
               <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500 animate-pulse shadow-[0_0_12px_#22c55e]' : 'bg-white/20'}`} />
               <span className="text-[11px] uppercase font-black tracking-[0.2em] text-white/40">
                 Voice In
               </span>
             </div>
             <div className="text-sm text-white/90 font-medium h-16 overflow-hidden line-clamp-3 leading-relaxed">
               {inputCaption || (isActive ? (role === UserRole.SPEAKER ? "Broadcasting..." : "Syncing source...") : "Standby")}
             </div>
          </div>
        </div>

        {/* Right Orb (Voice Out - Interpretation) */}
        <div className="relative w-80 h-44 bg-black/40 backdrop-blur-3xl rounded-full border border-white/10 -ml-24 overflow-hidden flex items-center justify-end pr-14 pl-28 shadow-[inset_0_0_50px_rgba(255,255,255,0.02)] ring-1 ring-white/5 group">
          <div className="absolute inset-0 pointer-events-none opacity-10 bg-gradient-to-l from-white/10 via-transparent to-transparent group-hover:opacity-30 transition-opacity duration-700" />
          <div className="flex flex-col items-end gap-2 w-full max-w-[200px] z-10">
             <div className="flex items-center gap-2 flex-row-reverse">
               <div className={`w-2 h-2 rounded-full ${isActive && outputCaption ? 'bg-white animate-pulse shadow-[0_0_12px_#ffffff]' : 'bg-white/20'}`} />
               <span className="text-[11px] uppercase font-black tracking-[0.2em] text-white/40">
                 Voice Out
               </span>
             </div>
             <div className="text-sm text-blue-300 font-black h-16 overflow-hidden line-clamp-3 leading-relaxed text-right italic">
               {outputCaption || (isActive ? (role === UserRole.SPEAKER ? "Broadcasting only" : "Interpreting...") : "...")}
             </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-10 py-4 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] uppercase font-black tracking-[0.4em] animate-pulse shadow-2xl backdrop-blur-xl">
          {error}
        </div>
      )}
    </div>
  );
};

export default CriptLatorWidget;