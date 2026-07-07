# 🎙️ LiveTranslate: Real-Time Audio-to-Audio Translation

**LiveTranslate** is a high-performance, low-latency, real-time voice translation web application. It connects your microphone directly to the **Gemini Live API** over a full-duplex WebSocket connection, providing instant spoken translations and transcriptions. 

The application features an advanced client-side audio engineering pipeline, integrating a high-pass filter, WebAssembly-powered neural noise suppression (RNNoise), and a voice activity detection (VAD) noise gate to ensure high-fidelity audio transmission even in noisy environments.

---

## 🌟 Key Features

*   **Real-Time Bidirectional Translation**: Full-duplex WebSocket communication using `models/gemini-3.5-live-translate-preview` for immediate vocal and textual translation.
*   **WebAssembly Neural Denoising (RNNoise)**: Integrates the state-of-the-art `@timephy/rnnoise-wasm` package running natively inside a browser `AudioWorkletNode` to suppress ambient noise using recurrent neural networks.
*   **Advanced Web Audio API Pipeline**:
    *   **High-Pass Filtering**: Built-in 80Hz cutoff filter to eliminate low-frequency room rumble and mains hum.
    *   **Dynamic Audio Graph Routing**: Seamlessly toggles neural noise suppression on/off in real-time without interrupting microphone capture or renegotiating the connection.
    *   **Dynamic Downsampler**: Downsamples native browser audio (44.1kHz or 48kHz) down to the 16kHz mono PCM required by Gemini.
    *   **Voice Activity Detection (VAD) / Noise Gate**: Uses Root Mean Square (RMS) metering. Automatically gates (mutes) audio packet transmission when the user is not speaking, using a 500ms hangover duration to prevent clipping mid-sentence.
*   **Low-Latency PCM Playback Queue**: Decodes incoming 24kHz 16-bit mono PCM chunks from Gemini and schedules them back-to-back in the browser's playback context for smooth, gapless vocal output.
*   **Premium Modern UI**: Built with Next.js 16, React 19, and Tailwind CSS v4, featuring glassmorphism, gradient visualizers, real-time volume indicators, and interactive configuration sliders.

---

## 🏗️ Audio Processing Architecture

The following diagram illustrates how your voice is captured, filtered, denoised, downsampled, transmitted, and played back:

```mermaid
graph TD
    %% Audio Capture and Processing Pipeline
    subgraph CapturePipeline ["Client Audio Capture & Processing (Native Rate: 44.1/48 kHz)"]
        Mic[🎤 Microphone MediaStream] --> Source[MediaStreamAudioSourceNode]
        Source --> HPFilter[BiquadFilterNode <br> Highpass @ 80Hz]
        HPFilter --> DenoiseMux{RNNoise Toggle}
        
        %% RNNoise Branch
        DenoiseMux -- Enabled --> RNNoise[AudioWorkletNode <br> RNNoise WASM Neural Denoising]
        RNNoise --> Processor[ScriptProcessorNode <br> Buffer: 4096 Samples]
        
        %% Bypass Branch
        DenoiseMux -- Bypassed --> Processor
    end

    %% Client-side processing before WebSocket transmission
    subgraph DataPrep ["Data Preparation (16 kHz PCM)"]
        Processor --> RMSCalc[1. Calculate RMS Volume]
        Processor --> GateCheck[2. VAD / Noise Gate Check]
        Processor --> Downsample[3. Downsample to 16 kHz]
        
        GateCheck -- Speaking (Volume >= Threshold) --> Packetize[4. Pack Int16 PCM Array]
        GateCheck -- Silence (Volume < Threshold for 500ms) --> Mute[4. Pack Zeroes (Silence)]
        
        Packetize --> Base64Encoder[5. Base64 Encode]
        Mute --> Base64Encoder
    end

    %% WebSocket Link
    Base64Encoder -->|WebSocket: realtime_input| WS[🌐 Google Gemini Live API WS]
    WS -->|WebSocket: serverContent| ClientWS[Client WebSocket Listener]

    %% Playback Pipeline
    subgraph PlaybackPipeline ["Client Audio Playback (24 kHz PCM)"]
        ClientWS -->|Extract 16-bit PCM Chunks| PCMParser[Convert Base64 to Float32]
        PCMParser --> PlaybackQueue[Schedule Playback Time Queue]
        PlaybackQueue --> PlaybackCtx[AudioBufferSourceNode <br> Resampled to Native Playback Rate]
        PlaybackCtx --> Speakers[🔊 Speakers / Headphones]
    end

    %% Styles
    classDef capture fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#fff;
    classDef prep fill:#18181b,stroke:#a855f7,stroke-width:2px,color:#fff;
    classDef ws fill:#0f172a,stroke:#22c55e,stroke-width:2px,color:#fff;
    classDef play fill:#1e293b,stroke:#ec4899,stroke-width:2px,color:#fff;
    
    class Mic,Source,HPFilter,DenoiseMux,RNNoise,Processor capture;
    class RMSCalc,GateCheck,Downsample,Packetize,Mute,Base64Encoder prep;
    class WS,ClientWS ws;
    class PCMParser,PlaybackQueue,PlaybackCtx,Speakers play;
```

---

## 🛠️ Technology Stack

*   **Framework**: [Next.js 16 (App Router)](https://nextjs.org/)
*   **Library**: [React 19](https://react.dev/)
*   **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
*   **API Client**: [@google/genai (v2.8.0)](https://www.npmjs.com/package/@google/genai)
*   **Neural Denoising**: [@timephy/rnnoise-wasm](https://www.npmjs.com/package/@timephy/rnnoise-wasm)
*   **Browser Interfaces**: Web Audio API, WebSockets, Audio Worklets

---

## 📂 Project Structure

```bash
live-translate/
├── src/
│   └── app/
│       ├── api/
│       │   └── translate/
│       │       └── route.ts       # Fallback server-side translator endpoint
│       ├── hooks/
│       │   └── useLiveAPI.ts      # Core WebSocket and Web Audio API wrapper hook
│       ├── actions.ts             # Server Action to securely retrieve Gemini API key
│       ├── globals.css            # Global Tailwind CSS imports
│       ├── layout.tsx             # Root document layout
│       └── page.tsx               # Interactive Dashboard UI and settings controls
├── public/
│   └── rnnoise-wasm/              # Dynamically copied WASM noise suppressor binaries
├── copy-rnnoise.js                # Build script to copy & patch RNNoise ES Module imports
├── package.json                   # Script configurations and project dependencies
├── next.config.ts                 # Next.js compiler settings
└── tsconfig.json                  # TypeScript compiler settings
```

---

## ⚙️ How it Works under the Hood

### 1. WebAssembly RNNoise Integration
Browser security and standard ES module resolution patterns can cause issues with importing extensionless files inside `AudioWorklet` runtimes. During development and compilation, `copy-rnnoise.js` is automatically executed to:
*   Copy WebAssembly assets from `node_modules/@timephy/rnnoise-wasm/dist` into `public/rnnoise-wasm/`.
*   Patch import statements inside `NoiseSuppressorWorklet.js` to explicitly specify `.js` file extensions, enabling native ES Module loading directly in the browser's Worklet thread.

### 2. Real-time Audio Routing
When the user switches the **Enable RNNoise** checkbox in the UI, the `useLiveAPI` hook alters the audio graph structure on-the-fly:
```typescript
// Disconnect nodes to avoid duplicates
sourceNode.disconnect();
highpassNode.disconnect();
noiseSuppressionNode.disconnect();

// Reconnect based on toggle state
sourceNode.connect(highpassNode);
if (isRNNoiseEnabled && noiseSuppressionNode) {
  highpassNode.connect(noiseSuppressionNode);
  noiseSuppressionNode.connect(processorNode);
} else {
  highpassNode.connect(processorNode);
}
```

### 3. VAD Noise Gate and Hangover Time
Instead of transmitting silent hums or rustling noise to Gemini (which can trigger hallucinated translations), the audio processor uses a noise gate.
*   **RMS Calculation**: Measures the Root Mean Square of the captured buffer.
*   **Threshold Comparison**: Checks if the RMS is greater than or equal to the slider's `noiseThreshold`.
*   **Hangover Delay (500ms)**: When the signal drops below the threshold, the gate remains open for another 500ms before closing. This prevents chopping off the end of words or sentences during pauses.
*   **Muted Gating**: When the gate is closed, the buffer values are set to zero (silence) before packetizing and encoding.

---

## 🚀 Getting Started

### 1. Prerequisites
Make sure you have Node.js (v18+) installed.

### 2. Installation
Clone this repository and install the dependencies:
```bash
npm install
```

### 3. Environment Setup
Create a `.env.local` file in the root directory:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 4. Running the Development Server
Start the dev server. This will run the `copy-rnnoise.js` script first and then start Next.js:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to experience live translation.

### 5. Production Build
To build the application for production deployment:
```bash
npm run build
```

---

## 🛡️ License

This project is open-source and available under the MIT License.
