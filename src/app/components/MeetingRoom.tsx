"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  GridLayout,
  useTracks,
  ConnectionStateToast,
  RoomName,
  useConnectionState,
  useParticipants,
  useLocalParticipant,
} from "@livekit/components-react";
import { Track, ConnectionState } from "livekit-client";
import ParticipantTileWithTranslation from "./ParticipantTileWithTranslation";

interface MeetingRoomProps {
  token: string;
  serverUrl: string;
  username: string;
  roomName: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
  noiseThreshold: number;
  setNoiseThreshold: (val: number) => void;
  isRNNoiseEnabled: boolean;
  setIsRNNoiseEnabled: (val: boolean) => void;
  onLeave: () => void;
}

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

export default function MeetingRoom({
  token,
  serverUrl,
  username,
  roomName,
  videoEnabled,
  audioEnabled,
  targetLanguage,
  setTargetLanguage,
  noiseThreshold,
  setNoiseThreshold,
  isRNNoiseEnabled,
  setIsRNNoiseEnabled,
  onLeave,
}: MeetingRoomProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // CRITICAL FIX: Freeze the initial video/audio intent in a ref.
  // LiveKitRoom's `video` and `audio` props are REACTIVE — if they stay
  // bound to a variable that is always `true`, every component re-render
  // (settings toggle, slider drag, state change) causes LiveKit to
  // re-acquire the camera/mic hardware, overriding the user's
  // setCameraEnabled(false). By reading from a ref that's set once, we
  // guarantee the prop value never changes after the first render.
  const initialVideoRef = useRef(videoEnabled);
  const initialAudioRef = useRef(audioEnabled);

  // --- Translation Logs State inside Meetings ---
  const [meetLogs, setMeetLogs] = useState<{ id: string; time: string; speaker: string; text: string }[]>([]);
  const [storeMeetLogs, setStoreMeetLogs] = useState<boolean>(true);

  // Load logs and preferences on mount
  useEffect(() => {
    try {
      const storedLogs = localStorage.getItem("aura_meet_logs");
      if (storedLogs) {
        setMeetLogs(JSON.parse(storedLogs));
      }
      const storedStoreSetting = localStorage.getItem("aura_meet_store_logs");
      if (storedStoreSetting !== null) {
        setStoreMeetLogs(JSON.parse(storedStoreSetting));
      }
    } catch (e) {
      console.error("Failed to load meet logs from localStorage:", e);
    }
  }, []);

  const handleLogTranslation = (speakerName: string, text: string) => {
    if (!storeMeetLogs) return;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const newLog = {
      id: crypto.randomUUID(),
      time: timeStr,
      speaker: speakerName,
      text: text
    };
    setMeetLogs((prev) => {
      const updated = [newLog, ...prev];
      localStorage.setItem("aura_meet_logs", JSON.stringify(updated));
      return updated;
    });
  };

  const handleClearLogs = () => {
    setMeetLogs([]);
    localStorage.removeItem("aura_meet_logs");
  };

  const handleToggleStoreLogs = (val: boolean) => {
    setStoreMeetLogs(val);
    localStorage.setItem("aura_meet_store_logs", JSON.stringify(val));
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-transparent text-white relative overflow-hidden">
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect={true}
        video={initialVideoRef.current}
        audio={initialAudioRef.current}
        onDisconnected={onLeave}
        className="flex-1 flex flex-row h-full overflow-hidden relative z-10"
        options={{
          publishDefaults: {
            simulcast: true,
            videoCodec: "vp8",
          },
          adaptiveStream: true,
          dynacast: true,
        }}
      >
        {/* Left main call area */}
        <div className="flex-1 flex flex-col h-full min-w-0">
          
          {/* Header Bar */}
          <header className="px-4 md:px-6 py-3 md:py-4 border-b border-white/6 bg-[#111827]/80 backdrop-blur-xl flex justify-between items-center z-20 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#00d4aa] flex items-center justify-center">
                <svg className="w-4 h-4 text-[#0f172a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-semibold text-white tracking-tight">
                  <RoomName />
                </h1>
                <ParticipantCounter />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ConnectionStatusBadge />
              <button
                onClick={onLeave}
                className="px-4 py-2 bg-red-500/15 hover:bg-red-500/25 text-red-400 font-semibold text-xs tracking-wide rounded-lg transition-all cursor-pointer"
              >
                Leave
              </button>
            </div>
          </header>

          {/* Media Grid */}
          <main className="flex-1 p-6 flex items-center justify-center relative overflow-hidden bg-transparent">
            <ConnectionStateToast />
            <RoomAudioRenderer />
            
            <ActiveVideoGrid targetLanguage={targetLanguage} noiseThreshold={noiseThreshold} onLogTranslation={handleLogTranslation} />
          </main>

          {/* Custom Control Bar */}
          <MeetingControlBar 
            isSettingsOpen={isSettingsOpen} 
            onToggleSettings={() => setIsSettingsOpen(!isSettingsOpen)} 
          />
        </div>

        {/* Right sliding Settings Sidebar */}
        <div 
          className={`fixed md:relative top-0 right-0 h-full z-50 md:z-40 border-l border-white/6 bg-[#111827]/95 md:bg-[#111827]/90 backdrop-blur-xl transition-all duration-300 ease-in-out flex flex-col ${
            isSettingsOpen ? "w-full md:w-80 opacity-100" : "w-0 opacity-0 pointer-events-none"
          }`}
        >
          {isSettingsOpen && (
            <SettingsSidebar 
              targetLanguage={targetLanguage}
              setTargetLanguage={setTargetLanguage}
              noiseThreshold={noiseThreshold}
              setNoiseThreshold={setNoiseThreshold}
              isRNNoiseEnabled={isRNNoiseEnabled}
              setIsRNNoiseEnabled={setIsRNNoiseEnabled}
              onClose={() => setIsSettingsOpen(false)}
              logs={meetLogs}
              onClearLogs={handleClearLogs}
              storeLogs={storeMeetLogs}
              onToggleStoreLogs={handleToggleStoreLogs}
            />
          )}
        </div>

      </LiveKitRoom>
    </div>
  );
}

// Subcomponent to render participant counts dynamically
function ParticipantCounter() {
  const participants = useParticipants();
  const count = participants.length + 1; // plus local participant
  return (
    <span className="text-[10px] text-slate-400 font-light block">
      {count} {count === 1 ? "participant" : "participants"} online
    </span>
  );
}

// Subcomponent to display current WebRTC connection states elegantly
function ConnectionStatusBadge() {
  const connectionState = useConnectionState();
  
  let label = "Connecting...";
  let colorClass = "bg-yellow-500/10 border-yellow-500/30 text-yellow-400";

  if (connectionState === ConnectionState.Connected) {
    label = "Connected";
    colorClass = "bg-emerald-500/10 border-emerald-500/30 text-emerald-400";
  } else if (connectionState === ConnectionState.Reconnecting) {
    label = "Reconnecting...";
    colorClass = "bg-orange-500/10 border-orange-500/30 text-orange-400 animate-pulse";
  } else if (connectionState === ConnectionState.Disconnected) {
    label = "Disconnected";
    colorClass = "bg-red-500/10 border-red-500/30 text-red-400";
  }

  return (
    <div className={`px-2 md:px-3 py-0.5 md:py-1 rounded-full text-[10px] md:text-xs font-semibold border ${colorClass}`}>
      {label}
    </div>
  );
}

// Subcomponent to render the video tiles grid based on active published media tracks
function ActiveVideoGrid({ 
  targetLanguage, 
  noiseThreshold,
  onLogTranslation
}: { 
  targetLanguage: string;
  noiseThreshold: number;
  onLogTranslation: (senderName: string, text: string) => void;
}) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 text-neutral-500">
        <svg className="w-12 h-12 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm font-light">Connecting to media streams...</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full max-w-6xl mx-auto flex items-center justify-center">
      <GridLayout
        tracks={tracks}
        className="w-full h-full max-h-[70vh] grid gap-4"
      >
        <ParticipantTileWithTranslation 
          targetLanguage={targetLanguage} 
          noiseThreshold={noiseThreshold} 
          onLogTranslation={onLogTranslation}
        />
      </GridLayout>
    </div>
  );
}

// Custom Control Bar — uses optimistic local state + event-driven sync
// to avoid the stale-hook glitch where isCameraEnabled lags behind
function MeetingControlBar({ 
  isSettingsOpen, 
  onToggleSettings 
}: { 
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  const { localParticipant } = useLocalParticipant();

  // Optimistic local state — updated instantly on click, then synced via events
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);

  // Sync local state with actual LiveKit track publication events
  useEffect(() => {
    if (!localParticipant) return;

    const syncState = () => {
      setMicOn(localParticipant.isMicrophoneEnabled);
      setCamOn(localParticipant.isCameraEnabled);
      setScreenOn(localParticipant.isScreenShareEnabled);
    };

    // Initial sync once the participant is ready
    syncState();

    localParticipant.on("trackMuted", syncState);
    localParticipant.on("trackUnmuted", syncState);
    localParticipant.on("localTrackPublished", syncState);
    localParticipant.on("localTrackUnpublished", syncState);

    return () => {
      localParticipant.off("trackMuted", syncState);
      localParticipant.off("trackUnmuted", syncState);
      localParticipant.off("localTrackPublished", syncState);
      localParticipant.off("localTrackUnpublished", syncState);
    };
  }, [localParticipant]);

  const toggleMicrophone = async () => {
    if (!localParticipant) return;
    const desired = !micOn;
    setMicOn(desired);  // instant visual feedback
    try {
      await localParticipant.setMicrophoneEnabled(desired);
    } catch (e) {
      setMicOn(!desired); // revert on failure
      console.error("Failed to toggle microphone:", e);
    }
  };

  const toggleCamera = async () => {
    if (!localParticipant) return;
    const desired = !camOn;
    setCamOn(desired);  // instant visual feedback
    try {
      await localParticipant.setCameraEnabled(desired);
    } catch (e) {
      setCamOn(!desired); // revert on failure
      console.error("Failed to toggle camera:", e);
    }
  };

  const toggleScreenShare = async () => {
    if (!localParticipant) return;
    const desired = !screenOn;
    setScreenOn(desired);
    try {
      await localParticipant.setScreenShareEnabled(desired);
    } catch (e) {
      setScreenOn(!desired);
      console.error("Failed to toggle screen share:", e);
    }
  };

  return (
    <footer className="w-full py-3 md:py-4 bg-[#111827]/80 backdrop-blur-xl border-t border-white/6 flex justify-center items-center shrink-0 z-20">
      <div className="bg-[#1e293b] border border-white/6 px-4 md:px-5 py-2 md:py-2.5 rounded-full flex items-center gap-3 md:gap-4">
        
        {/* Mic toggle */}
        <button
          onClick={toggleMicrophone}
          className={`p-2.5 rounded-full transition-all duration-200 cursor-pointer ${
            micOn 
              ? "bg-white/10 text-white hover:bg-white/15" 
              : "bg-red-500/15 text-red-400 hover:bg-red-500/25"
          }`}
          title={micOn ? "Mute Microphone" : "Unmute Microphone"}
        >
          {micOn ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          )}
        </button>

        {/* Camera toggle */}
        <button
          onClick={toggleCamera}
          className={`p-2.5 rounded-full transition-all duration-200 cursor-pointer ${
            camOn 
              ? "bg-white/10 text-white hover:bg-white/15" 
              : "bg-red-500/15 text-red-400 hover:bg-red-500/25"
          }`}
          title={camOn ? "Turn Camera Off" : "Turn Camera On"}
        >
          {camOn ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          )}
        </button>

        {/* Screen share toggle */}
        <button
          onClick={toggleScreenShare}
          className={`hidden md:inline-flex p-2.5 rounded-full transition-all duration-200 cursor-pointer ${
            screenOn 
              ? "bg-[#00d4aa]/20 text-[#00d4aa] hover:bg-[#00d4aa]/30" 
              : "bg-white/10 text-slate-300 hover:text-white hover:bg-white/15"
          }`}
          title={screenOn ? "Stop Sharing Screen" : "Share Screen"}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </button>

        {/* Vertical divider */}
        <div className="hidden md:block w-px h-5 bg-white/10" />

        {/* Custom translation settings toggle */}
        <button
          onClick={onToggleSettings}
          className={`p-2.5 rounded-full transition-all duration-200 cursor-pointer ${
            isSettingsOpen 
              ? "bg-[#00d4aa]/20 text-[#00d4aa]" 
              : "bg-white/10 text-slate-300 hover:text-white hover:bg-white/15"
          }`}
          title="Translation & Audio Settings"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </button>

      </div>
    </footer>
  );
}

// Collapsible Live Settings Sidebar
function SettingsSidebar({
  targetLanguage,
  setTargetLanguage,
  noiseThreshold,
  setNoiseThreshold,
  isRNNoiseEnabled,
  setIsRNNoiseEnabled,
  onClose,
  logs,
  onClearLogs,
  storeLogs,
  onToggleStoreLogs,
}: {
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
  noiseThreshold: number;
  setNoiseThreshold: (val: number) => void;
  isRNNoiseEnabled: boolean;
  setIsRNNoiseEnabled: (val: boolean) => void;
  onClose: () => void;
  logs: { id: string; time: string; speaker: string; text: string }[];
  onClearLogs: () => void;
  storeLogs: boolean;
  onToggleStoreLogs: (val: boolean) => void;
}) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const [localVolume, setLocalVolume] = useState(0);

  // Hook up local audio volume analyzer
  useEffect(() => {
    if (!localParticipant || !isMicrophoneEnabled) {
      setLocalVolume(0);
      return;
    }

    let audioContext: AudioContext | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let processorNode: ScriptProcessorNode | null = null;

    const setupLocalMeter = () => {
      const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
      if (!micPub || !micPub.isSubscribed || !micPub.audioTrack) {
        setLocalVolume(0);
        return;
      }

      const nativeTrack = micPub.audioTrack.mediaStreamTrack;
      if (!nativeTrack) return;

      const mediaStream = new MediaStream([nativeTrack]);

      try {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        sourceNode = audioContext.createMediaStreamSource(mediaStream);
        
        // 2048 buffer size is adequate and reduces audio graph processing latency
        processorNode = audioContext.createScriptProcessor(2048, 1, 1);
        let lastUpdateTime = 0;
        processorNode.onaudioprocess = (e) => {
          const now = performance.now();
          if (now - lastUpdateTime < 100) return; // Throttle state updates to ~10fps
          lastUpdateTime = now;

          const inputData = e.inputBuffer.getChannelData(0);
          let sumSquares = 0;
          for (let i = 0; i < inputData.length; i++) {
            sumSquares += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sumSquares / inputData.length);
          setLocalVolume(rms);
        };

        sourceNode.connect(processorNode);
        
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0;
        processorNode.connect(gainNode);
        gainNode.connect(audioContext.destination);
      } catch (err) {
        console.warn("Failed to initiate local mic visualizer:", err);
      }
    };

    setupLocalMeter();

    // Re-verify when tracks are published/unpublished on local participant
    localParticipant.on("localTrackPublished", setupLocalMeter);
    localParticipant.on("localTrackUnpublished", setupLocalMeter);

    return () => {
      if (localParticipant) {
        localParticipant.off("localTrackPublished", setupLocalMeter);
        localParticipant.off("localTrackUnpublished", setupLocalMeter);
      }
      if (processorNode) try { processorNode.disconnect(); } catch (e) {}
      if (sourceNode) try { sourceNode.disconnect(); } catch (e) {}
      if (audioContext) audioContext.close().catch(() => {});
    };
  }, [localParticipant, isMicrophoneEnabled]);

  const selectedLangLabel = LANGUAGES.find(l => l.code === targetLanguage)?.label || targetLanguage;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto p-5 select-none">
      
      {/* Title Header */}
      <div className="flex justify-between items-center border-b border-white/6 pb-4 mb-5">
        <div className="flex items-center gap-2">
          <svg className="w-4.5 h-4.5 text-[#00d4aa]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <h2 className="text-sm font-semibold text-white">Settings</h2>
        </div>
        <button 
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-5 flex-1 min-h-0">
        
        {/* Translation Language selector */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-slate-400">
            Translate Incoming Voice To
          </label>
          <select 
            value={targetLanguage} 
            onChange={(e) => setTargetLanguage(e.target.value)}
            className="w-full bg-[#0f172a] border border-white/8 text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/30 transition-all cursor-pointer"
          >
            {LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code} className="bg-[#1e293b] text-white">{lang.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-slate-500 leading-normal">
            Participants will be translated to {selectedLangLabel} in your speakers.
          </p>
        </div>

        {/* Neural Denoise Toggle */}
        <div className="flex flex-col gap-2 p-3.5 bg-[#0f172a]/60 border border-white/6 rounded-xl">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-slate-300 cursor-pointer select-none" htmlFor="meet-rnnoise-toggle">
              Neural Denoise (RNNoise)
            </label>
            <input 
              id="meet-rnnoise-toggle"
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

        {/* Audio Settings */}
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
        <div className="flex flex-col gap-2 border-t border-white/6 pt-4">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Mic Level</span>
            <span className={`text-[10px] font-semibold tracking-wider ${
              isMicrophoneEnabled && localVolume >= noiseThreshold 
                ? "text-[#00d4aa]" 
                : "text-slate-500"
            }`}>
              {!isMicrophoneEnabled 
                ? "MUTED" 
                : localVolume >= noiseThreshold 
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
            {isMicrophoneEnabled && (
              <div 
                className={`h-full rounded-full transition-all duration-75 ${
                  localVolume >= noiseThreshold 
                    ? "bg-[#00d4aa]" 
                    : "bg-white/10"
                }`}
                style={{ width: `${Math.min(100, (localVolume / 0.08) * 100)}%` }}
              />
            )}
          </div>
        </div>

        {/* Translation History Logs Section */}
        <div className="flex-1 flex flex-col min-h-[220px] border-t border-white/6 pt-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Meet Captions Log</h4>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#00d4aa]/15 text-[#00d4aa]">{logs.length}</span>
          </div>

          {/* Logs List */}
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 max-h-[240px] mb-3 text-xs font-light">
            {logs.length > 0 ? (
              logs.map((log) => (
                <div key={log.id} className="flex flex-col gap-0.5 bg-[#0f172a]/40 border border-white/5 rounded-lg p-2 animate-fade-in break-words">
                  <div className="flex justify-between items-center text-[10px] text-slate-500 font-normal">
                    <span className="font-semibold text-[#00d4aa]">{log.speaker}</span>
                    <span>{log.time}</span>
                  </div>
                  <p className="text-slate-200 leading-normal">{log.text}</p>
                </div>
              ))
            ) : (
              <div className="h-28 flex items-center justify-center text-slate-500 italic text-center p-4">
                No logs recorded yet...
              </div>
            )}
          </div>

          {/* Logs Settings / Actions */}
          <div className="flex items-center justify-between text-xs text-slate-400 border-t border-white/5 pt-3 select-none">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={storeLogs}
                onChange={(e) => onToggleStoreLogs(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-600 bg-[#0f172a] text-[#00d4aa] focus:ring-2 focus:ring-[#00d4aa]/30 cursor-pointer accent-[#00d4aa]"
              />
              <span>Store logs locally</span>
            </label>
            <button
              onClick={onClearLogs}
              className="px-2 py-1 text-[10px] font-semibold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 rounded-md transition-all cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
