"use client";

import React, { useState, useEffect, useRef } from "react";

interface LobbyProps {
  onJoin: (roomName: string, username: string, videoEnabled: boolean, audioEnabled: boolean) => void;
  initialRoom?: string;
}

export default function Lobby({ onJoin, initialRoom = "" }: LobbyProps) {
  const [username, setUsername] = useState("");
  const [roomName, setRoomName] = useState(initialRoom);
  
  // Device list states
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  
  // Selected device IDs
  const [selectedVideoId, setSelectedVideoId] = useState<string>("");
  const [selectedAudioId, setSelectedAudioId] = useState<string>("");

  // Media state
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [micVolume, setMicVolume] = useState(0);
  const [permissionError, setPermissionError] = useState<string>("");

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(false);

  // Track mount state to prevent React warning about state updates before mount
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Generate a cryptographically secure random room ID (UUID-like)
  const handleGenerateRoom = () => {
    const randomBytes = new Uint8Array(8);
    window.crypto.getRandomValues(randomBytes);
    const hex = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    setRoomName(`room-${hex.slice(0, 4)}-${hex.slice(4, 8)}`);
  };

  // Enumerate active video and audio hardware devices
  const getDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const video = devices.filter((d) => d.kind === "videoinput");
      const audio = devices.filter((d) => d.kind === "audioinput");
      
      if (!isMountedRef.current) return;
      setVideoDevices(video);
      setAudioDevices(audio);
      
      if (video.length > 0 && !selectedVideoId) {
        setSelectedVideoId(video[0].deviceId);
      }
      if (audio.length > 0 && !selectedAudioId) {
        setSelectedAudioId(audio[0].deviceId);
      }
    } catch (err) {
      console.warn("Could not list hardware devices:", err);
    }
  };

  // Stop all active streams and clean up Web Audio API instances
  const stopLocalStream = () => {
    // Increment request ID to cancel any pending async getUserMedia requests
    requestIdRef.current++;
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (isMountedRef.current) setMicVolume(0);
  };

  // Acquire media streams for preview
  const startPreview = async () => {
    stopLocalStream();
    const myRequestId = ++requestIdRef.current;
    if (isMountedRef.current) setPermissionError("");

    if (!videoEnabled && !audioEnabled) {
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: videoEnabled
          ? { deviceId: selectedVideoId ? { exact: selectedVideoId } : undefined }
          : false,
        audio: audioEnabled
          ? { deviceId: selectedAudioId ? { exact: selectedAudioId } : undefined }
          : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // CRITICAL RACE CONDITION GUARD
      if (myRequestId !== requestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      localStreamRef.current = stream;

      // 1. Assign stream to video element for preview
      if (videoEnabled && videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // 2. Set up Web Audio analyzer node for mic input level
      if (audioEnabled) {
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioContextRef.current = audioContext;

          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyserRef.current = analyser;

          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          const checkVolume = () => {
            if (!analyserRef.current || !isMountedRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
              sum += dataArray[i];
            }
            const average = sum / bufferLength;
            setMicVolume(Math.min(100, (average / 128) * 100));
            animationFrameRef.current = requestAnimationFrame(checkVolume);
          };

          checkVolume();
        }
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      console.error("Lobby media error:", err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setPermissionError("Access to camera and/or microphone was denied. Please update your browser site permissions to continue.");
      } else {
        setPermissionError(`Could not access devices: ${err.message || err.name}`);
      }
    }
  };

  // Re-acquire preview stream when active devices or permission toggles change
  useEffect(() => {
    startPreview();
    getDevices();
    
    return () => {
      stopLocalStream();
    };
  }, [selectedVideoId, selectedAudioId, videoEnabled, audioEnabled]);

  // Handle Join callback
  const handleJoinClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    if (!roomName.trim()) return;
    
    // Stop local preview tracks so that the LiveKit SDK can successfully claim the hardware devices
    stopLocalStream();
    
    onJoin(roomName.trim(), username.trim(), videoEnabled, audioEnabled);
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col md:flex-row gap-6 items-stretch justify-center relative z-10">
      {/* Left — Video Preview Panel */}
      <div className="flex-1 rounded-2xl bg-[#1e293b] border border-white/6 p-4 md:p-5 flex flex-col gap-3.5 md:gap-4 relative overflow-hidden shadow-lg">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Camera & Mic Preview</h3>
        
        {/* Video Box */}
        <div className="h-[200px] sm:h-[240px] md:h-auto md:min-h-[200px] md:flex-1 bg-[#0f172a] rounded-xl overflow-hidden relative flex items-center justify-center">
          {videoEnabled && !permissionError ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <svg className="w-14 h-14 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="text-xs tracking-wide font-medium text-slate-500">Camera Off</span>
            </div>
          )}

          {/* Floating Toggle Controls */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-[#0f172a]/80 px-4 py-2 rounded-full border border-white/6 backdrop-blur-sm">
            {/* Mic Toggle */}
            <button
              type="button"
              onClick={() => setAudioEnabled(!audioEnabled)}
              className={`p-2.5 rounded-full transition-all duration-200 cursor-pointer ${
                audioEnabled 
                  ? "bg-white/10 text-white hover:bg-white/15" 
                  : "bg-red-500/15 text-red-400 hover:bg-red-500/25"
              }`}
              title={audioEnabled ? "Mute" : "Unmute"}
            >
              {audioEnabled ? (
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

            {/* Video Toggle */}
            <button
              type="button"
              onClick={() => setVideoEnabled(!videoEnabled)}
              className={`p-2.5 rounded-full transition-all duration-200 cursor-pointer ${
                videoEnabled 
                  ? "bg-white/10 text-white hover:bg-white/15" 
                  : "bg-red-500/15 text-red-400 hover:bg-red-500/25"
              }`}
              title={videoEnabled ? "Turn Camera Off" : "Turn Camera On"}
            >
              {videoEnabled ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mic Level Bar */}
        {audioEnabled && (
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Mic Level</span>
              <span className="text-[#00d4aa] text-[10px] font-semibold uppercase tracking-wider">Active</span>
            </div>
            <div className="w-full h-4 bg-[#0f172a] rounded-full overflow-hidden border border-white/6">
              <div
                className="h-full bg-[#00d4aa] rounded-full transition-all duration-75"
                style={{ width: `${micVolume}%` }}
              />
            </div>
          </div>
        )}

        {/* Permission Error Display */}
        {permissionError && (
          <div className="p-3 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl leading-relaxed">
            {permissionError}
          </div>
        )}
      </div>

      {/* Right — Join Form */}
      <div className="w-full md:w-[340px] flex flex-col justify-center gap-4 md:gap-5 relative z-10">
        <form onSubmit={handleJoinClick} className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-2xl font-semibold tracking-tight text-white">Join Meeting</h2>
            <p className="text-sm text-slate-400">Enter your details to connect.</p>
          </div>

          <div className="flex flex-col gap-3">
            {/* Username */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="username" className="text-xs font-medium text-slate-400">Display Name</label>
              <input
                id="username"
                type="text"
                required
                placeholder="E.g., Spiderman"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0f172a] border border-white/8 text-white placeholder-slate-500 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 focus:border-[#00d4aa]/40 transition-all"
              />
            </div>

            {/* Room ID */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="roomName" className="text-xs font-medium text-slate-400">Room ID</label>
              <div className="flex gap-2">
                <input
                  id="roomName"
                  type="text"
                  required
                  placeholder="E.g., design-sync"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="flex-1 px-4 py-2.5 bg-[#0f172a] border border-white/8 text-white placeholder-slate-500 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 focus:border-[#00d4aa]/40 transition-all"
                />
                <button
                  type="button"
                  onClick={handleGenerateRoom}
                  className="px-3.5 py-2.5 bg-[#0f172a] border border-white/8 text-slate-300 text-xs font-medium rounded-lg hover:bg-white/5 hover:text-white transition-all flex items-center justify-center shrink-0 cursor-pointer"
                  title="Generate Random ID"
                >
                  Generate
                </button>
              </div>
            </div>
          </div>

          {/* Hardware Selection */}
          <div className="flex flex-col gap-3 p-3.5 bg-[#0f172a]/60 border border-white/6 rounded-xl">
            <h4 className="text-xs font-medium text-slate-400">Devices</h4>
            
            {/* Camera Select */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Camera</span>
              <select
                disabled={!videoEnabled}
                value={selectedVideoId}
                onChange={(e) => setSelectedVideoId(e.target.value)}
                className="w-full text-sm bg-[#1e293b] border border-white/8 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 disabled:opacity-35 transition-all cursor-pointer"
              >
                {videoDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId} className="bg-[#1e293b] text-white">
                    {d.label || `Camera ${d.deviceId.slice(0, 4)}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Microphone Select */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Microphone</span>
              <select
                disabled={!audioEnabled}
                value={selectedAudioId}
                onChange={(e) => setSelectedAudioId(e.target.value)}
                className="w-full text-sm bg-[#1e293b] border border-white/8 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 disabled:opacity-35 transition-all cursor-pointer"
              >
                {audioDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId} className="bg-[#1e293b] text-white">
                    {d.label || `Microphone ${d.deviceId.slice(0, 4)}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Join Button */}
          <button
            type="submit"
            disabled={!username.trim() || !roomName.trim()}
            className="w-full py-3 bg-[#00d4aa] hover:bg-[#00e5b8] active:bg-[#00c49e] disabled:bg-white/5 disabled:text-slate-500 disabled:cursor-not-allowed text-[#0f172a] font-semibold rounded-lg shadow-md shadow-[#00d4aa]/15 hover:shadow-[#00d4aa]/25 transition-all text-sm tracking-wide cursor-pointer"
          >
            Join Now
          </button>
        </form>
      </div>
    </div>
  );
}
