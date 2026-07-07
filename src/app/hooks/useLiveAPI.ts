"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { hasGeminiApiKey } from "../actions";

// Downsamples an audio Float32Array buffer from inputSampleRate to outputSampleRate
const downsampleBuffer = (buffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array => {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }
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

export function useLiveAPI(targetLanguage: string, noiseThreshold: number, isRNNoiseEnabled: boolean) {
  const [isConnected, setIsConnected] = useState(false);
  const [translation, setTranslation] = useState("");
  const [currentVolume, setCurrentVolume] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  // Separate contexts: one for mic capture (running at native rate for RNNoise compatibility), one at native rate for playback
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlaybackTimeRef = useRef<number>(0);
  const setupCompleteRef = useRef<boolean>(false);

  // References for dynamic audio routing
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const highpassNodeRef = useRef<BiquadFilterNode | null>(null);
  const noiseSuppressionNodeRef = useRef<AudioWorkletNode | null>(null);

  const thresholdRef = useRef(noiseThreshold);
  const isSpeakingRef = useRef(false);
  const silenceTimeMsRef = useRef(0);
  const retryCountRef = useRef(0);

  useEffect(() => {
    thresholdRef.current = noiseThreshold;
  }, [noiseThreshold]);

  // Dynamically swap the node connections in the audio graph when the user toggles RNNoise in real-time
  useEffect(() => {
    if (sourceNodeRef.current && highpassNodeRef.current && processorNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
        highpassNodeRef.current.disconnect();
        if (noiseSuppressionNodeRef.current) {
          noiseSuppressionNodeRef.current.disconnect();
        }
      } catch (e) {
        // ignore disconnection errors
      }

      sourceNodeRef.current.connect(highpassNodeRef.current);
      if (isRNNoiseEnabled && noiseSuppressionNodeRef.current) {
        highpassNodeRef.current.connect(noiseSuppressionNodeRef.current);
        noiseSuppressionNodeRef.current.connect(processorNodeRef.current);
        console.log("[LiveAPI] RNNoise dynamic routing: CONNECTED");
      } else {
        highpassNodeRef.current.connect(processorNodeRef.current);
        console.log("[LiveAPI] RNNoise dynamic routing: BYPASSED");
      }
    }
  }, [isRNNoiseEnabled]);

  const startConnection = async () => {
    try {
      if (retryCountRef.current >= 3) {
        setErrorMsg("Connection blocked due to too many consecutive errors. Please check your network and key, then refresh the page.");
        return;
      }

      setErrorMsg("");
      setTranslation("");
      setupCompleteRef.current = false;

      // Create playback context at browser's native sample rate (44100/48000)
      const playbackCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      playbackCtxRef.current = playbackCtx;
      if (playbackCtx.state === 'suspended') {
        await playbackCtx.resume();
      }
      console.log("[LiveAPI] Playback AudioContext created at", playbackCtx.sampleRate, "Hz");

      // Start mic capture
      const audioReady = await startAudio();
      if (!audioReady) return;

      const hasKey = await hasGeminiApiKey();
      if (!hasKey) {
        setErrorMsg("Gemini API key is not configured on the server.");
        console.error("Gemini API key is not configured on the server.");
        stopAudio();
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/ws/gemini`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log("[LiveAPI] WebSocket connected, sending setup...");

        const setupMsg = {
          setup: {
            model: "models/gemini-3.5-live-translate-preview",
            generation_config: {
              response_modalities: ["AUDIO"],
              translation_config: {
                target_language_code: targetLanguage,
                echo_target_language: false
              }
            }
          }
        };
        console.log("[LiveAPI] Sending Setup payload:", JSON.stringify(setupMsg));
        ws.send(JSON.stringify(setupMsg));
      };

      const handleJsonResponse = (response: any) => {
        // Handle setupComplete
        if (response.setupComplete || response.setup_complete) {
          console.log("[LiveAPI] ✅ Setup complete! Now accepting audio.");
          setupCompleteRef.current = true;
          retryCountRef.current = 0; // Reset retries on successful handshake
          return;
        }

        const content = response.serverContent || response.server_content;
        if (!content) return;

        // Handle translated text transcription
        const outputTranscript = content.outputTranscription || content.output_transcription;
        if (outputTranscript?.text) {
          console.log("[LiveAPI] Transcription text:", outputTranscript.text);
          setTranslation(prev => {
            const newText = outputTranscript.text;
            if (newText && !prev.endsWith(newText)) {
              return prev + (prev ? " " : "") + newText;
            }
            return prev;
          });
        }

        // Handle model turn (audio + text parts)
        const turn = content.modelTurn || content.model_turn;
        if (turn?.parts) {
          for (const part of turn.parts) {
            // Text part — translated text
            if (part.text) {
              console.log("[LiveAPI] Model text part:", part.text);
              setTranslation(prev => prev + part.text);
            }

            // Audio part — base64-encoded PCM in JSON
            const inlineData = part.inlineData || part.inline_data;
            if (inlineData) {
              const mimeType = inlineData.mimeType || inlineData.mime_type || '';
              if (mimeType.startsWith('audio/pcm') && inlineData.data) {
                const binaryString = atob(inlineData.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                playRawPCM(bytes);
              }
            }
          }
        }
      };

      const handleBinaryData = (bytes: Uint8Array) => {
        // Check if it looks like a JSON string (starts with '{' after skipping whitespace)
        let isJson = false;
        for (let i = 0; i < bytes.length; i++) {
          if (bytes[i] > 32) { // Non-whitespace
            if (bytes[i] === 0x7b) { // '{'
              isJson = true;
            }
            break;
          }
        }

        if (isJson) {
          try {
            const text = new TextDecoder("utf-8").decode(bytes);
            const response = JSON.parse(text);
            handleJsonResponse(response);
          } catch (e: any) {
            console.error("[LiveAPI] Failed to parse binary JSON:", e.message);
          }
        } else {
          playRawPCM(bytes);
        }
      };

      ws.onmessage = (event) => {
        try {
          if (typeof event.data === "string") {
            const response = JSON.parse(event.data);
            handleJsonResponse(response);
          } else if (event.data instanceof Blob) {
            event.data.arrayBuffer().then(buf => {
              handleBinaryData(new Uint8Array(buf));
            });
          } else if (event.data instanceof ArrayBuffer) {
            handleBinaryData(new Uint8Array(event.data));
          }
        } catch (e: any) {
          console.error("[LiveAPI] Error in onmessage:", e.message);
        }
      };

      ws.onclose = (e) => {
        setIsConnected(false);
        setupCompleteRef.current = false;
        stopAudio();
        console.log(`[LiveAPI] WebSocket closed, code: ${e.code}, reason: ${e.reason}`);
        if (e.code !== 1000) {
          retryCountRef.current += 1;
          setErrorMsg(`WebSocket closed unexpectedly: ${e.code} ${e.reason} (Attempt ${retryCountRef.current}/3)`);
        }
      };

      ws.onerror = (error: any) => {
        console.error("[LiveAPI] WebSocket error:", error.message || error);
        retryCountRef.current += 1;
        setErrorMsg(`WebSocket connection error. Check console. (Attempt ${retryCountRef.current}/3)`);
        setIsConnected(false);
        stopAudio();
      };

    } catch (e: any) {
      console.error("[LiveAPI] Failed to start:", e.message);
      setErrorMsg(`Failed to start: ${e.message}`);
    }
  };

  /** Play raw 16-bit PCM bytes (little-endian, mono, 24kHz) through the playback context */
  const playRawPCM = (bytes: Uint8Array) => {
    const playbackCtx = playbackCtxRef.current;
    if (!playbackCtx || playbackCtx.state === 'closed') {
      return;
    }

    if (playbackCtx.state === 'suspended') {
      playbackCtx.resume().catch(err => {
        console.error("[LiveAPI] Error resuming playback context:", err.message);
      });
    }

    // Ensure even number of bytes for Int16
    const usableLength = bytes.length - (bytes.length % 2);
    if (usableLength < 2) return;

    const samples = usableLength / 2;

    try {
      // Create buffer at 24kHz (Gemini's output rate) — the playback context will resample to its native rate
      const audioBuffer = playbackCtx.createBuffer(1, samples, 24000);
      const channelData = audioBuffer.getChannelData(0);
      
      // Convert raw bytes to Float32 sample data manually (little-endian 16-bit PCM)
      for (let i = 0; i < samples; i++) {
        const byteIndex = i * 2;
        let val = bytes[byteIndex] | (bytes[byteIndex + 1] << 8);
        if (val & 0x8000) {
          val |= ~0xffff; // sign extend
        }
        channelData[i] = val / 32768.0;
      }

      const source = playbackCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(playbackCtx.destination);

      const now = playbackCtx.currentTime;
      if (nextPlaybackTimeRef.current < now) {
        nextPlaybackTimeRef.current = now;
      }
      source.start(nextPlaybackTimeRef.current);
      nextPlaybackTimeRef.current += audioBuffer.duration;
    } catch (e: any) {
      console.error("[LiveAPI] playRawPCM Error playing audio buffer:", e.message);
    }
  };

  const startAudio = async () => {
    try {
      // Capture context at native rate for RNNoise compatibility (usually 44100 or 48000Hz)
      const captureCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      captureCtxRef.current = captureCtx;

      if (captureCtx.state === 'suspended') {
        await captureCtx.resume();
      }
      console.log("[LiveAPI] Capture AudioContext created natively at", captureCtx.sampleRate, "Hz");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
        }
      });
      mediaStreamRef.current = stream;

      const source = captureCtx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // Create high-pass filter to cut off low-frequency background hum (below 80Hz)
      const highpass = captureCtx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 80;
      highpassNodeRef.current = highpass;

      // Try loading RNNoise WASM AudioWorklet
      let noiseSuppressionNode: AudioWorkletNode | null = null;
      try {
        await captureCtx.audioWorklet.addModule('/rnnoise-wasm/NoiseSuppressorWorklet.js');
        noiseSuppressionNode = new AudioWorkletNode(captureCtx, 'NoiseSuppressorWorklet');
        noiseSuppressionNodeRef.current = noiseSuppressionNode;
        console.log("[LiveAPI] RNNoise WASM AudioWorklet loaded successfully");
      } catch (err: any) {
        console.warn("[LiveAPI] Failed to load RNNoise WASM AudioWorklet:", err.message || err);
      }

      // Buffer size of 4096 samples at native rate
      const processor = captureCtx.createScriptProcessor(4096, 1, 1);
      processorNodeRef.current = processor;

      processor.onaudioprocess = (e) => {
        const nativeData = e.inputBuffer.getChannelData(0);
        
        // Downsample native input data (44.1kHz/48kHz) to 16kHz expected by Gemini
        const inputData = downsampleBuffer(nativeData, captureCtx.sampleRate, 16000);

        // Calculate dynamic RMS volume of downsampled data
        let sumSquares = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSquares += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSquares / inputData.length);
        
        // Push volume reading back to React state for UI visualizer
        setCurrentVolume(rms);

        // VAD Noise Gate Logic with 500ms Hangover duration
        const threshold = thresholdRef.current;
        if (rms >= threshold) {
          isSpeakingRef.current = true;
          silenceTimeMsRef.current = 0;
        } else {
          if (isSpeakingRef.current) {
            // inputData.length samples at 16kHz sample rate
            silenceTimeMsRef.current += (inputData.length / 16000) * 1000;
            if (silenceTimeMsRef.current >= 500) {
              isSpeakingRef.current = false;
            }
          }
        }

        if (!setupCompleteRef.current) return;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        try {
          const pcmData = new Int16Array(inputData.length);
          if (isSpeakingRef.current) {
            for (let i = 0; i < inputData.length; i++) {
              let s = Math.max(-1, Math.min(1, inputData[i]));
              pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
          } // if isSpeakingRef is false, pcmData remains initialized with zero values (silence)

          const buffer = new Uint8Array(pcmData.buffer);
          let binary = '';
          for (let i = 0; i < buffer.byteLength; i++) {
            binary += String.fromCharCode(buffer[i]);
          }
          const base64Audio = btoa(binary);

          wsRef.current.send(JSON.stringify({
            realtime_input: {
              media_chunks: [{
                mime_type: "audio/pcm;rate=16000",
                data: base64Audio
              }]
            }
          }));
        } catch (err) {
          console.error("[LiveAPI] Audio processing error:", err);
        }
      };

      // Connect nodes dynamically based on initial state
      source.connect(highpass);
      if (isRNNoiseEnabled && noiseSuppressionNode) {
        highpass.connect(noiseSuppressionNode);
        noiseSuppressionNode.connect(processor);
        console.log("[LiveAPI] Initial RNNoise routing: CONNECTED");
      } else {
        highpass.connect(processor);
        console.log("[LiveAPI] Initial RNNoise routing: BYPASSED");
      }
      
      // Connect processor to destination through a zero-gain node 
      // so onaudioprocess fires, but we don't hear our own mic (prevents loud feedback loops)
      const gainNode = captureCtx.createGain();
      gainNode.gain.value = 0;
      processor.connect(gainNode);
      gainNode.connect(captureCtx.destination);
      return true;

    } catch (err: any) {
      console.error("[LiveAPI] Audio error:", err);
      setErrorMsg(`Microphone access error: ${err.message || err.name}`);
      stopConnection();
      return false;
    }
  };

  const stopConnection = useCallback(() => {
    setupCompleteRef.current = false;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopAudio();
    setIsConnected(false);
  }, []);

  const stopAudio = () => {
    if (processorNodeRef.current) {
      try { processorNodeRef.current.disconnect(); } catch(e){}
      processorNodeRef.current = null;
    }
    if (noiseSuppressionNodeRef.current) {
      try { noiseSuppressionNodeRef.current.disconnect(); } catch(e){}
      noiseSuppressionNodeRef.current = null;
    }
    if (highpassNodeRef.current) {
      try { highpassNodeRef.current.disconnect(); } catch(e){}
      highpassNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch(e){}
      sourceNodeRef.current = null;
    }
    if (captureCtxRef.current) {
      captureCtxRef.current.close();
      captureCtxRef.current = null;
    }
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close();
      playbackCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    nextPlaybackTimeRef.current = 0;
  };

  const clearTranslation = useCallback(() => {
    setTranslation("");
  }, []);

  useEffect(() => {
    return () => {
      stopConnection();
    };
  }, [stopConnection]);

  return {
    isConnected,
    transcript: "",
    translation,
    clearTranslation,
    currentVolume,
    errorMsg,
    startConnection,
    stopConnection
  };
}
