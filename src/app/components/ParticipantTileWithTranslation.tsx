"use client";

import React, { useEffect, useState, useRef } from "react";
import { ParticipantTile } from "@livekit/components-react";
import { Track, RemoteParticipant, RemoteAudioTrack } from "livekit-client";

interface ParticipantTileWithTranslationProps {
  trackRef?: any;
  targetLanguage: string;
  noiseThreshold: number;
  onLogTranslation?: (senderName: string, text: string) => void;
}

const TTS_VOICE_MAP: { [key: string]: string } = {
  es: "es-ES",
  en: "en-US",
  fr: "fr-FR",
  de: "de-DE",
  ja: "ja-JP",
  ko: "ko-KR",
  hi: "hi-IN",
  "zh-Hans": "zh-CN",
  it: "it-IT",
  "pt-BR": "pt-BR",
  ar: "ar-SA",
  ru: "ru-RU",
  ta: "ta-IN",
  te: "te-IN",
  bn: "bn-IN",
  tr: "tr-TR",
  vi: "vi-VN",
  th: "th-TH",
  nl: "nl-NL",
  pl: "pl-PL",
};

// Downsamples float32 audio buffer from inputSampleRate to outputSampleRate
const downsampleBuffer = (
  buffer: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array => {
  if (inputSampleRate === outputSampleRate) return buffer;
  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0, count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
};

export default function ParticipantTileWithTranslation({
  trackRef,
  targetLanguage,
  noiseThreshold,
  onLogTranslation,
}: ParticipantTileWithTranslationProps) {
  const participant = trackRef?.participant;
  const [subtitle, setSubtitle] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);

  // Keep threshold in a ref so it's always current inside the audio callback
  // without tearing down & rebuilding the entire Web Audio pipeline on every slider drag
  const noiseThresholdRef = useRef(noiseThreshold);
  useEffect(() => { noiseThresholdRef.current = noiseThreshold; }, [noiseThreshold]);

  // Audio capture references
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Buffers for speech recording
  const recordedChunksRef = useRef<Float32Array[]>([]);
  const isSpeakingRef = useRef(false);
  const silenceTimeMsRef = useRef(0);
  const audioTrackRef = useRef<RemoteAudioTrack | null>(null);

  // Track the component unmount state to prevent async state updates
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanupAudioPipeline();
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const cleanupAudioPipeline = () => {
    if (processorNodeRef.current) {
      try { processorNodeRef.current.disconnect(); } catch (e) {}
      processorNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch (e) {}
      sourceNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    recordedChunksRef.current = [];
    isSpeakingRef.current = false;
    silenceTimeMsRef.current = 0;
  };

  // Perform translation on captured audio chunk using serverless API
  const translateAudioChunk = async (audioData: Float32Array, sampleRate: number) => {
    if (audioData.length === 0) return;
    if (!isMountedRef.current) return;

    setIsTranslating(true);
    try {
      // 1. Downsample audio to 16kHz PCM
      const downsampled = downsampleBuffer(audioData, sampleRate, 16000);
      
      // 2. Convert to Int16 array
      const pcmData = new Int16Array(downsampled.length);
      for (let i = 0; i < downsampled.length; i++) {
        let s = Math.max(-1, Math.min(1, downsampled[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // 3. Convert PCM to base64
      const buffer = new Uint8Array(pcmData.buffer);
      let binary = "";
      for (let i = 0; i < buffer.byteLength; i++) {
        binary += String.fromCharCode(buffer[i]);
      }
      const base64Audio = btoa(binary);

      // 4. POST to translate API
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Audio,
          targetLanguage,
          mimeType: "audio/pcm;rate=16000",
        }),
      });

      if (!response.ok) {
        throw new Error(`Translation status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.text && data.text.trim()) {
        const translatedText = data.text.trim();
        if (isMountedRef.current) {
          setSubtitle(translatedText);
        }
        
        // 5. Trigger Local browser Text-to-Speech (TTS)
        playTTS(translatedText);

        // 6. Log the translation history
        if (onLogTranslation) {
          const speakerName = participant?.identity || "Speaker";
          onLogTranslation(speakerName, translatedText);
        }
      }
    } catch (err) {
      console.error("[Remote Translation Error]:", err);
    } finally {
      if (isMountedRef.current) {
        setIsTranslating(false);
      }
    }
  };

  // Speaks translated text aloud and ducks the original speaker's raw track volume
  const playTTS = (text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    // Cancel any current speaking queue to avoid backlog overlap
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const langTag = TTS_VOICE_MAP[targetLanguage] || targetLanguage;
    utterance.lang = langTag;

    // Attempt to locate a matching native browser voice for the selected language
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang.startsWith(langTag) || v.lang.includes(langTag.replace("-", "_")));
    if (voice) {
      utterance.voice = voice;
    }

    // Duck the raw WebRTC track volume when speech translation starts
    utterance.onstart = () => {
      if (audioTrackRef.current) {
        console.log(`[TTS Translation] Ducking original voice for ${participant?.identity}`);
        audioTrackRef.current.setVolume(0.15); // Duck down to 15%
      }
    };

    // Restore the raw WebRTC track volume when speech translation ends
    const restoreVolume = () => {
      if (audioTrackRef.current) {
        console.log(`[TTS Translation] Restoring original voice for ${participant?.identity}`);
        audioTrackRef.current.setVolume(1.0); // Reset back to full volume
      }
    };

    utterance.onend = restoreVolume;
    utterance.onerror = restoreVolume;

    window.speechSynthesis.speak(utterance);
  };

  // Initialize Web Audio listener hook on the participant's subscribed microphonic track
  useEffect(() => {
    if (!participant || !(participant instanceof RemoteParticipant)) {
      cleanupAudioPipeline();
      return;
    }

    const setupAudioCapture = () => {
      cleanupAudioPipeline();

      // Find the subscribed mic track publication
      const micPub = participant.getTrackPublication(Track.Source.Microphone);
      if (!micPub || !micPub.isSubscribed || !micPub.audioTrack) {
        return;
      }

      const remoteAudioTrack = micPub.audioTrack as RemoteAudioTrack;
      audioTrackRef.current = remoteAudioTrack;

      // Extract native WebRTC browser MediaStreamTrack
      const nativeTrack = remoteAudioTrack.mediaStreamTrack;
      if (!nativeTrack) return;

      const mediaStream = new MediaStream([nativeTrack]);

      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioCtx;

        const source = audioCtx.createMediaStreamSource(mediaStream);
        sourceNodeRef.current = source;

        // ScriptProcessorNode size 4096, 1 input, 1 output channel
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorNodeRef.current = processor;

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Calculate RMS level
          let sumSquares = 0;
          for (let i = 0; i < inputData.length; i++) {
            sumSquares += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sumSquares / inputData.length);

          const threshold = noiseThresholdRef.current; // Read live value from ref
          const sampleRate = audioCtx.sampleRate;

          if (rms >= threshold) {
            if (!isSpeakingRef.current) {
              isSpeakingRef.current = true;
              recordedChunksRef.current = [];
              if (isMountedRef.current) {
                setSubtitle(""); // Clear previous subtitle when they start speaking
              }
            }
            silenceTimeMsRef.current = 0;
            // Record chunks
            recordedChunksRef.current.push(new Float32Array(inputData));
          } else {
            if (isSpeakingRef.current) {
              // Calculate duration of silence processed
              silenceTimeMsRef.current += (inputData.length / sampleRate) * 1000;
              
              // Still record silence briefly in case of brief mid-word pauses
              recordedChunksRef.current.push(new Float32Array(inputData));

              // If speaker pauses for 1.3 seconds, trigger the translation
              if (silenceTimeMsRef.current >= 1300) {
                isSpeakingRef.current = false;
                
                // Flatten the recorded float chunks
                const totalLength = recordedChunksRef.current.reduce((acc, c) => acc + c.length, 0);
                const flattened = new Float32Array(totalLength);
                let offset = 0;
                for (const chunk of recordedChunksRef.current) {
                  flattened.set(chunk, offset);
                  offset += chunk.length;
                }

                recordedChunksRef.current = [];
                translateAudioChunk(flattened, sampleRate);
              }
            }
          }
        };

        source.connect(processor);
        
        // Zero gain node to trigger onaudioprocess but avoid audio duplication in client speakers
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0;
        processor.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        console.log(`[Translation Pipeline] Active for participant ${participant.identity}`);
      } catch (err) {
        console.error("Failed to establish remote audio context pipeline:", err);
      }
    };

    // Run setup initially
    setupAudioCapture();

    // Listen to track updates (subscription events)
    participant.on("trackSubscribed", setupAudioCapture);
    participant.on("trackUnsubscribed", cleanupAudioPipeline);

    return () => {
      participant.off("trackSubscribed", setupAudioCapture);
      participant.off("trackUnsubscribed", cleanupAudioPipeline);
      cleanupAudioPipeline();
    };
  }, [participant, targetLanguage]);

  return (
    <div className="relative w-full h-full group rounded-xl overflow-hidden border border-white/6 bg-[#1e293b]">
      {/* Underlying standard LiveKit participant tile (renders webcams, name tags, placeholders) */}
      <ParticipantTile trackRef={trackRef} />

      {/* Custom Subtitle Overlay */}
      {subtitle && (
        <div className="absolute bottom-12 left-4 right-4 z-10 flex justify-center pointer-events-none">
          <div className="px-4 py-2.5 rounded-xl bg-[#0f172a]/85 border border-white/8 text-white text-sm font-medium tracking-wide shadow-lg text-center max-w-[85%] backdrop-blur-md animate-fade-in break-words select-none">
            {subtitle}
          </div>
        </div>
      )}

      {/* Small translation indicator */}
      {isTranslating && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-[#00d4aa] text-[#0f172a] px-2.5 py-1 rounded-md text-[9px] font-bold tracking-wider uppercase shadow-md">
          <span className="flex h-1.5 w-1.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
          </span>
          Translating
        </div>
      )}
    </div>
  );
}
