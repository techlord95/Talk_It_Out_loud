"use client";

import { useState, useEffect, useRef } from "react";
import { useLiveAPI } from "./hooks/useLiveAPI";
import Lobby from "./components/Lobby";
import MeetingRoom from "./components/MeetingRoom";

const LANGUAGES = [
  { label: "Hindi", code: "hi" },
  { label: "Spanish", code: "es" },
  { label: "English", code: "en" },
  { label: "French", code: "fr" },
  { label: "German", code: "de" },
  { label: "Japanese", code: "ja" },
  { label: "Korean", code: "ko" },
  { label: "Chinese (Simplified)", code: "zh-Hans" },
  { label: "Italian", code: "it" },
  { label: "Portuguese (Brazil)", code: "pt-BR" },
  { label: "Arabic", code: "ar" },
  { label: "Russian", code: "ru" },
  { label: "Tamil", code: "ta" },
  { label: "Telugu", code: "te" },
  { label: "Bengali", code: "bn" },
  { label: "Turkish", code: "tr" },
  { label: "Vietnamese", code: "vi" },
  { label: "Thai", code: "th" },
  { label: "Dutch", code: "nl" },
  { label: "Polish", code: "pl" },
];

interface MeetingConfig {
  token: string;
  roomName: string;
  username: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
}

export default function Home() {
  // Navigation / Tabs State
  const [activeTab, setActiveTab] = useState<"translator" | "meet">("translator");

  // --- Solo Live Translator Hooks & States ---
  const [targetLanguage, setTargetLanguage] = useState(LANGUAGES[0].code);
  const [noiseThreshold, setNoiseThreshold] = useState(0.003);
  const [isRNNoiseEnabled, setIsRNNoiseEnabled] = useState(true);
  const [isSoloSettingsOpen, setIsSoloSettingsOpen] = useState(false);

  const {
    isConnected,
    translation,
    clearTranslation,
    currentVolume,
    errorMsg: translatorError,
    startConnection,
    stopConnection
  } = useLiveAPI(targetLanguage, noiseThreshold, isRNNoiseEnabled);

  const selectedLangLabel = LANGUAGES.find(l => l.code === targetLanguage)?.label || targetLanguage;

  const toggleRecording = () => {
    if (isConnected) {
      stopConnection();
    } else {
      startConnection();
    }
  };

  // --- Translation History / Local Storage Logs ---
  const [translationLogs, setTranslationLogs] = useState<{ id: string; time: string; text: string; lang: string }[]>([]);
  const [storeLogs, setStoreLogs] = useState<boolean>(true);

  // Load logs and storage preference on mount
  useEffect(() => {
    try {
      const storedLogs = localStorage.getItem("aura_translation_logs");
      if (storedLogs) {
        setTranslationLogs(JSON.parse(storedLogs));
      }
      const storedStoreLogsSetting = localStorage.getItem("aura_store_logs");
      if (storedStoreLogsSetting !== null) {
        setStoreLogs(JSON.parse(storedStoreLogsSetting));
      }
    } catch (e) {
      console.error("Failed to load translation logs from localStorage:", e);
    }
  }, []);

  // Timer reference for speech finalization
  const finalizeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce loop for finalization
  useEffect(() => {
    if (finalizeTimerRef.current) {
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }

    if (translation && translation.trim()) {
      finalizeTimerRef.current = setTimeout(() => {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const newLog = {
          id: crypto.randomUUID(),
          time: timeStr,
          text: translation.trim(),
          lang: selectedLangLabel
        };

        if (storeLogs) {
          setTranslationLogs(prev => {
            const updated = [newLog, ...prev];
            localStorage.setItem("aura_translation_logs", JSON.stringify(updated));
            return updated;
          });
        }
        
        clearTranslation();
      }, 2000); // 2 seconds of silence finalizes the speech segment
    }

    return () => {
      if (finalizeTimerRef.current) {
        clearTimeout(finalizeTimerRef.current);
      }
    };
  }, [translation, storeLogs, selectedLangLabel, clearTranslation]);

  // Handle immediate finalization on disconnect
  useEffect(() => {
    if (!isConnected && translation && translation.trim()) {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const newLog = {
        id: crypto.randomUUID(),
        time: timeStr,
        text: translation.trim(),
        lang: selectedLangLabel
      };

      if (storeLogs) {
        setTranslationLogs(prev => {
          const updated = [newLog, ...prev];
          localStorage.setItem("aura_translation_logs", JSON.stringify(updated));
          return updated;
        });
      }
      clearTranslation();
    }
  }, [isConnected, translation, storeLogs, selectedLangLabel, clearTranslation]);

  // --- Google Meet (LiveKit WebRTC) States & Logic ---
  const [meetingConfig, setMeetingConfig] = useState<MeetingConfig | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [meetError, setMeetError] = useState("");

  const livekitServerUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || "ws://localhost:7880";

  // Ephemeral token acquisition using exponential backoff with jitter
  const fetchLiveKitToken = async (
    room: string,
    username: string,
    attempt = 1
  ): Promise<string> => {
    try {
      const response = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, username }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error ${response.status}`);
      }
      const data = await response.json();
      if (!data.token) {
        throw new Error("The API did not return a valid credentials token.");
      }
      return data.token;
    } catch (error: any) {
      if (attempt >= 3) {
        throw new Error(`Connection failed after 3 attempts. Error: ${error.message}`);
      }
      // Calculate exponential backoff with a random jitter (500ms max) to prevent request stampedes
      const backoffDelay = Math.pow(2, attempt - 1) * 1000 + Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      return fetchLiveKitToken(room, username, attempt + 1);
    }
  };

  const handleJoinMeeting = async (
    roomName: string,
    username: string,
    videoEnabled: boolean,
    audioEnabled: boolean
  ) => {
    setIsJoining(true);
    setMeetError("");
    try {
      if (!process.env.NEXT_PUBLIC_LIVEKIT_URL) {
        console.warn("NEXT_PUBLIC_LIVEKIT_URL is not set. Defaulting to local connection (ws://localhost:7880).");
      }

      const token = await fetchLiveKitToken(roomName, username);
      setMeetingConfig({
        token,
        roomName,
        username,
        videoEnabled,
        audioEnabled,
      });
    } catch (err: any) {
      setMeetError(err.message || "An error occurred while connecting to the meeting server.");
    } finally {
      setIsJoining(false);
    }
  };

  const handleLeaveMeeting = () => {
    setMeetingConfig(null);
    setMeetError("");
  };

  return (
    <div className="min-h-screen bg-transparent text-slate-50 font-sans selection:bg-[#00d4aa]/20 flex flex-col relative overflow-hidden">

      {/* Universal Header */}
      {!meetingConfig && (
        <header className="fixed top-0 w-full px-4 md:px-8 py-3.5 md:py-4 flex justify-between items-center z-50 border-b border-white/6 bg-[#111827]/80 backdrop-blur-xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#00d4aa] flex items-center justify-center">
              <svg className="w-4.5 h-4.5 text-[#0f172a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-white">
              Aura
            </h1>
          </div>

          {/* Navigation Toggle */}
          <div className="hidden md:flex p-1 bg-white/5 border border-white/6 rounded-full">
            <button
              onClick={() => {
                if (isConnected) stopConnection();
                setActiveTab("translator");
              }}
              className={`px-5 py-2 rounded-full text-xs font-semibold tracking-wide transition-all duration-200 cursor-pointer ${activeTab === "translator"
                ? "bg-[#00d4aa] text-[#0f172a] shadow-sm"
                : "text-slate-400 hover:text-slate-200"
                }`}
            >
              🎙️ Voice Translator
            </button>
            <button
              onClick={() => {
                if (isConnected) stopConnection();
                setActiveTab("meet");
              }}
              className={`px-5 py-2 rounded-full text-xs font-semibold tracking-wide transition-all duration-200 cursor-pointer ${activeTab === "meet"
                ? "bg-[#00d4aa] text-[#0f172a] shadow-sm"
                : "text-slate-400 hover:text-slate-200"
                }`}
            >
              👥 Meet Portal
            </button>
          </div>

          <div className="flex items-center gap-2.5 md:gap-4">
            {activeTab === "translator" ? (
              <>
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  disabled={isConnected}
                  className="hidden md:block bg-white/5 border border-white/8 text-slate-300 text-xs rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/30 disabled:opacity-50 transition-all hover:bg-white/10 cursor-pointer"
                >
                  {LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code} className="bg-[#1e293b] text-white">To {lang.label}</option>
                  ))}
                </select>
                <div className={`px-2.5 md:px-3.5 py-1 md:py-1.5 rounded-full text-[11px] md:text-xs font-semibold border transition-all duration-300 ${isConnected ? 'border-red-500/30 bg-red-500/10 text-red-400 animate-pulse' : 'border-white/6 bg-white/5 text-slate-400'}`}>
                  {isConnected ? 'Listening' : 'Standby'}
                </div>
                <button
                  onClick={() => setIsSoloSettingsOpen(!isSoloSettingsOpen)}
                  className={`p-2 rounded-full border transition-all duration-200 cursor-pointer ${
                    isSoloSettingsOpen 
                      ? "bg-[#00d4aa]/15 border-[#00d4aa]/30 text-[#00d4aa]" 
                      : "bg-white/5 border-white/8 text-slate-400 hover:text-white hover:bg-white/10"
                  }`}
                  title="Advanced Settings"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </>
            ) : (
              <div className="px-2.5 md:px-3.5 py-1 md:py-1.5 rounded-full text-[11px] md:text-xs font-medium border border-[#00d4aa]/20 bg-[#00d4aa]/10 text-[#00d4aa]">
                Studio Mode
              </div>
            )}
          </div>
        </header>
      )}

      {/* Main Container */}
      <div className="flex-1 flex flex-col justify-center">
        {activeTab === "translator" ? (
          /* --- TAB 1: SOLO LIVE TRANSLATOR --- */
          <div className="flex-1 flex flex-row h-full w-full overflow-hidden relative">
            <main className="flex-1 pt-24 md:pt-32 pb-36 md:pb-24 px-4 md:px-6 max-w-4xl mx-auto flex flex-col gap-6 w-full relative z-10 justify-center">
              {/* Hero Title */}
              <section className="flex flex-col items-center justify-center text-center mt-2 md:mt-4 mb-2">
                <h2 className="text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-purple-200 mb-3 md:mb-4 drop-shadow-sm">
                  Talk Beyond Borders
                </h2>
                <p className="text-slate-400 max-w-xl text-sm md:text-base font-light leading-relaxed">
                  Speak naturally. Aura translates your voice in real-time, utilizing advanced AI and intelligent neural noise reduction.
                </p>
                {translatorError && (
                  <div className="mt-4 px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs backdrop-blur-md">
                    {translatorError}
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-4 md:gap-6 max-w-3xl mx-auto w-full">
                {/* Mobile Target Language Select */}
                <div className="flex md:hidden items-center justify-between gap-3 bg-white/5 border border-white/6 rounded-xl px-4 py-2.5 backdrop-blur-md">
                  <span className="text-xs font-semibold text-[#00d4aa] uppercase tracking-wider">Target Language:</span>
                  <select
                    value={targetLanguage}
                    onChange={(e) => setTargetLanguage(e.target.value)}
                    disabled={isConnected}
                    className="bg-[#1e293b] border border-white/8 text-slate-300 text-xs rounded-full px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/30 disabled:opacity-50 transition-all hover:bg-white/10 cursor-pointer"
                  >
                    {LANGUAGES.map(lang => (
                      <option key={lang.code} value={lang.code} className="bg-[#1e293b] text-white">To {lang.label}</option>
                    ))}
                  </select>
                </div>

                {/* Translation Card */}
                <div className="relative group rounded-2xl bg-[#1e293b] border border-white/6 p-5 md:p-8 flex flex-col gap-4 md:gap-5 min-h-[240px] md:min-h-[300px] overflow-hidden transition-all duration-300 shadow-md">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-semibold text-[#00d4aa] uppercase tracking-widest flex items-center gap-1.5">
                      <span>Live Translation</span>
                      {isConnected && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] bg-red-500/10 border border-red-500/20 text-red-400 font-bold uppercase tracking-wider animate-pulse">Live</span>
                      )}
                    </h3>
                    {isConnected && (
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500"></span>
                      </span>
                    )}
                  </div>
                  
                  {/* Active Live Streaming Caption */}
                  <div className="text-xl md:text-2xl leading-relaxed text-white font-light tracking-wide min-h-[60px] max-h-[120px] overflow-y-auto mb-2 pr-1">
                    {translation ? (
                      <span className="text-white drop-shadow-md">{translation}</span>
                    ) : (
                      <span className="text-slate-500 italic select-none text-base font-normal">Start speaking, and your translation will manifest here in real-time...</span>
                    )}
                  </div>

                  {/* History Logs Divider and Container */}
                  <div className="flex-1 flex flex-col border-t border-white/6 pt-4 mt-1 min-h-[140px]">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">History Logs</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#00d4aa]/10 text-[#00d4aa]">{translationLogs.length}</span>
                    </div>

                    <div className="flex-1 overflow-y-auto max-h-40 space-y-2 pr-1 text-sm font-light">
                      {translationLogs.length > 0 ? (
                        translationLogs.map((log) => (
                          <div key={log.id} className="flex flex-col gap-1 p-2.5 bg-[#0f172a]/40 border border-white/5 rounded-xl animate-fade-in break-words">
                            <div className="flex justify-between items-center text-[10px] text-slate-500">
                              <span className="font-semibold text-[#00d4aa]">{log.lang}</span>
                              <span>{log.time}</span>
                            </div>
                            <p className="text-slate-200 leading-normal">{log.text}</p>
                          </div>
                        ))
                      ) : (
                        <div className="h-20 flex items-center justify-center text-slate-500 italic text-sm">
                          No history logged
                        </div>
                      )}
                    </div>
                  </div>

                  {/* History Settings Checkbox & Clear action inside the box itself */}
                  <div className="flex items-center justify-between text-xs text-slate-400 border-t border-white/5 pt-3 mt-1 select-none">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={storeLogs}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setStoreLogs(val);
                          localStorage.setItem("aura_store_logs", JSON.stringify(val));
                        }}
                        className="w-3.5 h-3.5 rounded border-slate-600 bg-[#0f172a] text-[#00d4aa] focus:ring-2 focus:ring-[#00d4aa]/30 cursor-pointer accent-[#00d4aa]"
                      />
                      <span>Store history locally</span>
                    </label>
                    <button
                      onClick={() => {
                        setTranslationLogs([]);
                        localStorage.removeItem("aura_translation_logs");
                      }}
                      className="px-2.5 py-1 text-[11px] font-semibold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 rounded-md transition-all cursor-pointer"
                    >
                      Clear History
                    </button>
                  </div>
                </div>
              </section>

              {/* Controls */}
              <div className="fixed bottom-16 md:bottom-0 left-0 w-full px-8 py-4 md:p-8 flex justify-center items-center bg-gradient-to-t from-[#111827] via-[#111827]/90 to-transparent pb-10 pointer-events-none z-30">
                <button
                  onClick={toggleRecording}
                  className={`pointer-events-auto relative flex items-center justify-center w-18 h-18 rounded-full shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none focus:ring-4 focus:ring-[#00d4aa]/30 ${isConnected
                    ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/10'
                    : 'bg-white hover:bg-slate-100 text-[#0f172a]'
                    }`}
                >
                  {isConnected ? (
                    <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="7" y="7" width="10" height="10" rx="1.5" />
                    </svg>
                  ) : (
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  )}
                  {isConnected && (
                    <span className="absolute inset-0 rounded-full border-2 border-red-600 animate-ping opacity-75"></span>
                  )}
                </button>
              </div>
            </main>

            {/* Right sliding Advanced Settings Sidebar */}
            <div 
              className={`fixed md:relative top-0 right-0 h-full z-50 md:z-40 border-l border-white/6 bg-[#111827]/95 md:bg-[#111827]/90 backdrop-blur-xl transition-all duration-300 ease-in-out flex flex-col ${
                isSoloSettingsOpen ? "w-full md:w-80 opacity-100" : "w-0 opacity-0 pointer-events-none"
              }`}
            >
              {isSoloSettingsOpen && (
                <div className="flex-1 flex flex-col h-full overflow-y-auto p-5 select-none animate-fade-in">
                  
                  {/* Title Header */}
                  <div className="flex justify-between items-center border-b border-white/6 pb-4 mb-5">
                    <div className="flex items-center gap-2">
                      <svg className="w-4.5 h-4.5 text-[#00d4aa]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <h2 className="text-sm font-semibold text-white">Advanced Settings</h2>
                    </div>
                    <button 
                      onClick={() => setIsSoloSettingsOpen(false)}
                      className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Settings Content */}
                  <div className="flex flex-col gap-5">
                    
                    {/* Neural Denoise Toggle */}
                    <div className="flex flex-col gap-2 p-3.5 bg-[#0f172a]/60 border border-white/6 rounded-xl">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-medium text-slate-300 cursor-pointer select-none" htmlFor="solo-rnnoise-toggle">
                          Neural Denoise (RNNoise)
                        </label>
                        <input 
                          id="solo-rnnoise-toggle"
                          type="checkbox"
                          checked={isRNNoiseEnabled}
                          onChange={(e) => setIsRNNoiseEnabled(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-600 bg-[#0f172a] text-[#00d4aa] focus:ring-2 focus:ring-[#00d4aa]/30 cursor-pointer accent-[#00d4aa]"
                        />
                      </div>
                      <p className="text-[10px] text-slate-500 leading-normal">
                        Suppresses fan noise, keyboard clicks, and background echo.
                      </p>
                    </div>

                    {/* Audio Settings — Sensitivity slider */}
                    <div className="flex flex-col gap-3 p-3.5 bg-[#0f172a]/60 border border-white/6 rounded-xl">
                      <h4 className="text-xs font-medium text-slate-400">Noise Gate</h4>
                      <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs text-slate-300">
                          <span>Sensitivity: <span className="text-[#00d4aa] font-mono font-medium">{noiseThreshold.toFixed(4)}</span></span>
                          <span className="text-slate-500 text-[10px]">
                            {noiseThreshold <= 0.005 ? "Sensitive" : noiseThreshold >= 0.04 ? "Aggressive" : "Balanced"}
                          </span>
                        </div>
                        <input 
                          type="range"
                          min="0.001"
                          max="0.080"
                          step="0.001"
                          value={noiseThreshold}
                          onChange={(e) => setNoiseThreshold(parseFloat(e.target.value))}
                          className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#00d4aa] focus:outline-none transition-all"
                        />
                      </div>
                    </div>

                    {/* Local volume meter */}
                    <div className="flex flex-col gap-2 border-t border-white/6 pt-4 mt-1">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Mic Level</span>
                        <span className={`text-[10px] font-semibold tracking-wider ${
                          isConnected && currentVolume >= noiseThreshold 
                            ? "text-[#00d4aa]" 
                            : "text-slate-500"
                        }`}>
                          {!isConnected 
                            ? "STANDBY" 
                            : currentVolume >= noiseThreshold 
                              ? "ACTIVE" 
                              : "GATED"}
                        </span>
                      </div>
                      <div className="relative w-full h-4 bg-[#0f172a] rounded-full overflow-hidden border border-white/6">
                        {/* Threshold marker */}
                        <div 
                          className="absolute top-0 bottom-0 w-0.5 bg-red-500/50 z-10"
                          style={{ left: `${Math.min(100, (noiseThreshold / 0.08) * 100)}%` }}
                        />
                        {/* Volume feedback */}
                        {isConnected && (
                          <div 
                            className={`h-full rounded-full transition-all duration-75 ${
                              currentVolume >= noiseThreshold 
                                ? "bg-[#00d4aa]" 
                                : "bg-white/10"
                            }`}
                            style={{ width: `${Math.min(100, (currentVolume / 0.08) * 100)}%` }}
                          />
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* --- TAB 2: Private MEET (WEBRTC VIA LIVEKIT) --- */
          <div className="w-full flex-1 flex flex-col justify-center min-h-screen">
            {meetingConfig ? (
              <MeetingRoom
                token={meetingConfig.token}
                serverUrl={livekitServerUrl}
                username={meetingConfig.username}
                roomName={meetingConfig.roomName}
                videoEnabled={meetingConfig.videoEnabled}
                audioEnabled={meetingConfig.audioEnabled}
                targetLanguage={targetLanguage}
                setTargetLanguage={setTargetLanguage}
                noiseThreshold={noiseThreshold}
                setNoiseThreshold={setNoiseThreshold}
                isRNNoiseEnabled={isRNNoiseEnabled}
                setIsRNNoiseEnabled={setIsRNNoiseEnabled}
                onLeave={handleLeaveMeeting}
              />
            ) : (
              <main className="pt-20 pb-8 px-6 max-w-5xl mx-auto flex flex-col gap-6 w-full items-center justify-center relative z-10 flex-1">
                {meetError && (
                  <div className="w-full max-w-xl p-6 rounded-3xl glass-panel-heavy text-neutral-200 text-sm leading-relaxed mb-4 shadow-2xl flex flex-col gap-4">
                    <div className="flex items-center gap-3 text-red-400 font-semibold border-b border-white/5 pb-3">
                      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      LiveKit Credentials Required
                    </div>
                    {meetError.includes("credentials") || meetError.includes("configured") ? (
                      <div className="flex flex-col gap-4">
                        <p className="text-neutral-400 text-xs leading-relaxed font-light">
                          To run WebRTC video conferencing, you need a LiveKit server instance. LiveKit Cloud offers a free tier (5,000 mins/month) with no credit card required.
                        </p>
                        <ol className="list-decimal list-inside space-y-2 text-xs text-neutral-300 font-light">
                          <li>Go to <a href="https://cloud.livekit.io" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">cloud.livekit.io</a> and create a project.</li>
                          <li>Copy your API credentials from the project Settings.</li>
                          <li>Open the file <code className="px-1.5 py-0.5 bg-black rounded border border-white/5 text-indigo-400 font-mono">.env.local</code> in the root of this project and add:</li>
                        </ol>
                        <pre className="p-4 bg-black/60 rounded-xl border border-white/5 text-xs font-mono text-emerald-400 overflow-x-auto select-all shadow-inner">
                          {`LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud`}
                        </pre>
                        <p className="text-neutral-500 text-[10px] leading-relaxed italic">
                          💡 Replace the values with your actual keys from LiveKit Cloud, then restart the Next.js development server.
                        </p>
                      </div>
                    ) : (
                      <p className="text-red-400 font-medium">{meetError}</p>
                    )}
                  </div>
                )}

                {isJoining ? (
                  <div className="flex flex-col items-center gap-4 text-neutral-400">
                    <svg className="w-12 h-12 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-sm font-light">Connecting to secure meet room...</span>
                  </div>
                ) : (
                  <Lobby onJoin={handleJoinMeeting} />
                )}
              </main>
            )}
          </div>
        )}
      </div>

      {/* Mobile Bottom Navigation Bar */}
      {!meetingConfig && (
        <div className="md:hidden fixed bottom-0 left-0 w-full bg-[#111827]/85 backdrop-blur-xl border-t border-white/6 py-3 px-6 flex justify-around items-center z-40 select-none">
          <button
            onClick={() => {
              if (isConnected) stopConnection();
              setActiveTab("translator");
            }}
            className={`flex flex-col items-center gap-1 text-[11px] font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === "translator"
                ? "text-[#00d4aa]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <span className="text-base">🎙️</span>
            <span>Translator</span>
          </button>
          <button
            onClick={() => {
              if (isConnected) stopConnection();
              setActiveTab("meet");
            }}
            className={`flex flex-col items-center gap-1 text-[11px] font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === "meet"
                ? "text-[#00d4aa]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <span className="text-base">👥</span>
            <span>Meet Portal</span>
          </button>
        </div>
      )}
    </div>
  );
}
