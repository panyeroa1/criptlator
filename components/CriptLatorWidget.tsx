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

  // Supabase Sync for Listeners
  useEffect(() => {
    if (role !== UserRole.LISTENER || !isActive || !supabase) return;

    const channel = supabase
      .channel('broadcast_room')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transcriptions' }, (payload) => {
        const text = payload.new.text;
        if (text && serviceRef.current) {
          setInputCaption(text);
          // Feeds remote text into local Gemini for Translation + Speech
          serviceRef.current.sendText(text);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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
          if (role === UserRole.SPEAKER && supabase) {
            // Speaker broadcasts their live text to Supabase
            supabase.from('transcriptions').insert([{ text }]).then();
          }
        },
        onOutputTranscription: (text) => setOutputCaption(text),
        onAudioData: async (base64) => {
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

      // Output setup
      outputAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      outputAnalyserRef.current = outputAudioCtxRef.current.createAnalyser();
      outputGainRef.current = outputAudioCtxRef.current.createGain();
      outputGainRef.current.connect(outputAnalyserRef.current);
      outputAnalyserRef.current.connect(outputAudioCtxRef.current.destination);

      // Input setup (ONLY FOR SPEAKER)
      if (role === UserRole.SPEAKER) {
        inputAudioCtxRef.current = new AudioContext({ sampleRate: 16000 });
        inputAnalyserRef.current = inputAudioCtxRef.current.createAnalyser();
        const mixedDest = inputAudioCtxRef.current.createMediaStreamDestination();

        // Mic
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        activeStreamsRef.current.push(mic);
        inputAudioCtxRef.current.createMediaStreamSource(mic).connect(mixedDest);

        // System Audio / Screen Share
        try {
          const sys = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
          if (sys.getAudioTracks().length > 0) {
            activeStreamsRef.current.push(sys);
            inputAudioCtxRef.current.createMediaStreamSource(sys).connect(mixedDest);
            sys.getVideoTracks().forEach(t => t.stop());
          }
        } catch (e) {
          console.warn("System audio bypassed.");
        }

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
    <div className="flex flex-col items-center gap-6">
      {/* Role Toggle Switch */}
      <div className="flex bg-black/40 p-1 rounded-full border border-white/10 backdrop-blur-sm">
        <button
          onClick={() => setRole(UserRole.SPEAKER)}
          disabled={isActive}
          className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${role === UserRole.SPEAKER ? 'bg-white text-black' : 'text-white/40 hover:text-white/60 disabled:opacity-50'}`}
        >
          Speaker
        </button>
        <button
          onClick={() => setRole(UserRole.LISTENER)}
          disabled={isActive}
          className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${role === UserRole.LISTENER ? 'bg-white text-black' : 'text-white/40 hover:text-white/60 disabled:opacity-50'}`}
        >
          Listener
        </button>
      </div>

      {/* The Lying Down 8 (Infinity) Shape */}
      <div className="relative flex items-center justify-center h-28 w-[520px]">
        
        {/* Bridge Controls */}
        <div className="absolute z-20 flex flex-col items-center gap-1">
          <button
            onClick={isActive ? stopSession : startSession}
            disabled={isConnecting}
            className={`w-14 h-14 rounded-full border-2 border-white/20 flex items-center justify-center transition-all shadow-xl ${isActive ? 'bg-red-500/20 text-red-400 hover:bg-red-500/40' : 'bg-white/10 text-white hover:bg-white/20'}`}
          >
            {isConnecting ? (
              <div className="w-6 h-6 border-2 border-white border-t-transparent animate-spin rounded-full" />
            ) : isActive ? (
              <span className="text-xl">⏹</span>
            ) : (
              <span className="text-xl">▶</span>
            )}
          </button>
          
          <div className="bg-black/60 px-2 py-0.5 rounded border border-white/5 flex flex-col items-center">
             <span className="text-[7px] text-white/30 font-black uppercase tracking-widest">To Language</span>
             <select 
              value={targetLanguage} 
              onChange={(e) => setTargetLanguage(e.target.value as SupportLanguage)}
              disabled={isActive}
              className="bg-transparent text-[9px] uppercase font-black tracking-widest text-white/70 outline-none cursor-pointer"
            >
              <option value={SupportLanguage.AUTO}>Auto</option>
              {Object.values(SupportLanguage).filter(l => l !== SupportLanguage.AUTO).map(l => (
                <option key={l} value={l} className="bg-gray-900">{l}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Left Bubble (Green / Source / Incoming) */}
        <div className="relative w-72 h-28 bg-black/60 backdrop-blur-md rounded-full border border-white/10 -mr-16 overflow-hidden flex items-center justify-start pl-10 pr-20 shadow-[inset_0_0_30px_rgba(34,197,94,0.08)]">
          <div className="absolute inset-0 pointer-events-none opacity-20 bg-gradient-to-r from-green-500/20 to-transparent" />
          <div className="flex flex-col gap-1 w-full max-w-[160px]">
             <span className="text-[8px] uppercase font-black tracking-tighter text-green-400 opacity-60">
               {role === UserRole.SPEAKER ? 'Broadcasting Audio' : 'Incoming Broadcast'}
             </span>
             <div className="text-[11px] text-white/80 font-medium h-8 overflow-hidden line-clamp-2 leading-tight">
               {inputCaption || (isActive ? "Awaiting data..." : "Ready")}
             </div>
             {isActive && role === UserRole.SPEAKER && <AudioVisualizer analyser={inputAnalyserRef.current} color="#22c55e" width={140} height={24} />}
             {isActive && role === UserRole.LISTENER && <div className="h-[24px] flex items-center"><div className="w-full h-0.5 bg-green-500/20 overflow-hidden"><div className="h-full bg-green-500 animate-[loading_2s_infinite]" style={{width: '30%'}}></div></div></div>}
          </div>
        </div>

        {/* Right Bubble (White / Translate / Output) */}
        <div className="relative w-72 h-28 bg-black/60 backdrop-blur-md rounded-full border border-white/10 -ml-16 overflow-hidden flex items-center justify-end pr-10 pl-20 shadow-[inset_0_0_30px_rgba(255,255,255,0.05)]">
          <div className="absolute inset-0 pointer-events-none opacity-20 bg-gradient-to-l from-white/10 to-transparent" />
          <div className="flex flex-col items-end gap-1 w-full max-w-[160px]">
             <span className="text-[8px] uppercase font-black tracking-tighter text-white/40">Interpretation Out</span>
             <div className="text-[11px] text-blue-300 font-black h-8 overflow-hidden line-clamp-2 leading-tight text-right">
               {outputCaption || "---"}
             </div>
             {isActive && <AudioVisualizer analyser={outputAnalyserRef.current} color="#ffffff" width={140} height={24} />}
          </div>
        </div>
      </div>

      {error && (
        <div className="px-6 py-2 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] uppercase font-black tracking-widest animate-pulse">
          {error}
        </div>
      )}

      <style>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
};

export default CriptLatorWidget;
