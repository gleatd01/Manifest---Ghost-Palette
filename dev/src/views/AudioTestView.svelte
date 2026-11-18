<script>
    import { onMount, onDestroy } from 'svelte';

    let testMode = 'combined'; // 'combined', 'speech-only', 'recorder-only'
    let isRecording = false;
    let isSpeechRunning = false;

    let finalTranscript = '';
    let interimTranscript = '';
    let audioUrl = '';
    let recordedMime = '';
    let recordedSize = 0;
    let chunkCount = 0;

    let recognition = null;
    let mediaRecorder = null;
    let mediaStream = null;
    let audioChunks = [];

    let capabilities = {
        speechRecognition: false,
        webkitSpeechRecognition: false,
        mediaRecorder: false,
        getUserMedia: false,
        supportedMimes: [],
        userAgent: ''
    };

    let logs = [];

    function addLog(type, msg) {
        const ts = new Date().toLocaleTimeString();
        logs = [{ ts, type, msg }, ...logs.slice(0, 49)];
    }

    function detectCapabilities() {
        capabilities.speechRecognition = 'SpeechRecognition' in window;
        capabilities.webkitSpeechRecognition = 'webkitSpeechRecognition' in window;
        capabilities.mediaRecorder = 'MediaRecorder' in window;
        capabilities.getUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        capabilities.userAgent = navigator.userAgent;

        const mimeCandidates = [
            'audio/mp4',
            'audio/mp4;codecs=mp4a.40.2',
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/wav'
        ];
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
            capabilities.supportedMimes = mimeCandidates.filter(m => MediaRecorder.isTypeSupported(m));
        }
        addLog('INFO', `Detected capabilities: Speech=${capabilities.speechRecognition || capabilities.webkitSpeechRecognition}, MediaRecorder=${capabilities.mediaRecorder}, Mimes=[${capabilities.supportedMimes.join(', ')}]`);
    }

    function getBestAudioMime() {
        if (capabilities.supportedMimes.length > 0) {
            const m = capabilities.supportedMimes[0];
            const ext = m.includes('mp4') ? 'm4a' : m.includes('ogg') ? 'ogg' : 'webm';
            return { mimeType: m, ext };
        }
        return { mimeType: '', ext: 'm4a' };
    }

    function initSpeech() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            addLog('ERROR', 'SpeechRecognition API is not available in this browser/WebView.');
            return null;
        }
        const rec = new SR();
        rec.lang = navigator.language || 'en-US';
        rec.continuous = true;
        rec.interimResults = true;

        rec.onstart = () => {
            isSpeechRunning = true;
            addLog('SPEECH', 'SpeechRecognition started (onstart)');
        };
        rec.onaudiostart = () => addLog('SPEECH', 'Audio capture started (onaudiostart)');
        rec.onspeechstart = () => addLog('SPEECH', 'Speech detected (onspeechstart)');
        rec.onspeechend = () => addLog('SPEECH', 'Speech ended (onspeechend)');

        rec.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const text = event.results[i][0].transcript;
                const conf = (event.results[i][0].confidence * 100).toFixed(1);
                if (event.results[i].isFinal) {
                    finalTranscript += text.trim() + ' ';
                    addLog('RESULT', `Final [${conf}%]: "${text.trim()}"`);
                } else {
                    interim += text;
                }
            }
            interimTranscript = interim;
        };

        rec.onerror = (event) => {
            addLog('ERROR', `SpeechRecognition error: "${event.error}" ${event.message ? `(${event.message})` : ''}`);
        };

        rec.onend = () => {
            isSpeechRunning = false;
            interimTranscript = '';
            addLog('SPEECH', 'SpeechRecognition ended (onend)');
            if (isRecording && (testMode === 'combined' || testMode === 'speech-only')) {
                addLog('INFO', 'Auto-restarting SpeechRecognition after pause...');
                setTimeout(() => {
                    if (isRecording && recognition) {
                        try {
                            recognition.start();
                        } catch (e) {
                            addLog('ERROR', `Auto-restart failed: ${e.message}`);
                        }
                    }
                }, 250);
            }
        };

        return rec;
    }

    async function startTest() {
        addLog('INFO', `Starting test in mode: ${testMode}`);
        interimTranscript = '';
        isRecording = true;

        // IMPORTANT for iPadOS: Call recognition.start() synchronously inside user gesture BEFORE any await getUserMedia()
        if (testMode === 'combined' || testMode === 'speech-only') {
            if (!recognition) recognition = initSpeech();
            if (recognition) {
                try {
                    recognition.start();
                    addLog('SPEECH', 'Called recognition.start() synchronously in click handler');
                } catch (e) {
                    addLog('ERROR', `recognition.start() threw: ${e.message}`);
                }
            }
        }

        if (testMode === 'combined' || testMode === 'recorder-only') {
            try {
                addLog('RECORDER', 'Requesting navigator.mediaDevices.getUserMedia({ audio: true })...');
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const tracks = mediaStream.getAudioTracks();
                addLog('RECORDER', `Mic granted: ${tracks.map(t => `${t.label || 'AudioTrack'} (${t.readyState})`).join(', ')}`);

                const { mimeType } = getBestAudioMime();
                mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
                recordedMime = mediaRecorder.mimeType || mimeType || 'default';
                audioChunks = [];
                chunkCount = 0;
                recordedSize = 0;

                mediaRecorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) {
                        audioChunks.push(e.data);
                        chunkCount = audioChunks.length;
                        recordedSize += e.data.size;
                    }
                };

                mediaRecorder.onerror = (e) => {
                    addLog('ERROR', `MediaRecorder error: ${e.error?.message || e.type}`);
                };

                mediaRecorder.onstop = () => {
                    const blob = new Blob(audioChunks, { type: recordedMime || 'audio/mp4' });
                    if (audioUrl) URL.revokeObjectURL(audioUrl);
                    audioUrl = URL.createObjectURL(blob);
                    addLog('RECORDER', `MediaRecorder stopped. Created Blob (${blob.size} bytes, type=${blob.type})`);
                    if (mediaStream) {
                        mediaStream.getTracks().forEach(t => t.stop());
                        mediaStream = null;
                    }
                };

                mediaRecorder.start(1000);
                addLog('RECORDER', `MediaRecorder started (mimeType="${recordedMime}")`);
            } catch (err) {
                addLog('ERROR', `getUserMedia / MediaRecorder failed: ${err.name}: ${err.message}`);
                if (testMode === 'recorder-only') {
                    isRecording = false;
                }
            }
        }
    }

    function stopTest() {
        addLog('INFO', 'Stopping test...');
        isRecording = false;
        interimTranscript = '';

        if (recognition) {
            try {
                recognition.stop();
            } catch (e) {
                addLog('ERROR', `recognition.stop() error: ${e.message}`);
            }
        }

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try {
                mediaRecorder.stop();
            } catch (e) {
                addLog('ERROR', `mediaRecorder.stop() error: ${e.message}`);
            }
        } else if (mediaStream) {
            mediaStream.getTracks().forEach(t => t.stop());
            mediaStream = null;
        }
    }

    onMount(() => {
        detectCapabilities();
        recognition = initSpeech();
    });

    onDestroy(() => {
        if (isRecording) stopTest();
        if (audioUrl) URL.revokeObjectURL(audioUrl);
    });
</script>

<div class="audio-test-container">
    <h2>🎙️ iPadOS & Browser Audio Recording + Transcription Diagnostics</h2>
    <p class="subtitle">
        Test SpeechRecognition and MediaRecorder together or independently to diagnose iPadOS WebKit microphone conflicts, MIME types, and gesture requirements.
    </p>

    <!-- System Capabilities Summary -->
    <div class="diag-grid">
        <div class="diag-card">
            <span class="label">SpeechRecognition API</span>
            <span class="val {capabilities.speechRecognition || capabilities.webkitSpeechRecognition ? 'ok' : 'err'}">
                {capabilities.speechRecognition ? 'Standard' : capabilities.webkitSpeechRecognition ? 'webkitSpeechRecognition' : 'Unsupported'}
            </span>
        </div>
        <div class="diag-card">
            <span class="label">MediaRecorder API</span>
            <span class="val {capabilities.mediaRecorder ? 'ok' : 'err'}">
                {capabilities.mediaRecorder ? 'Supported' : 'Unsupported'}
            </span>
        </div>
        <div class="diag-card">
            <span class="label">Best Audio MIME</span>
            <span class="val ok">{capabilities.supportedMimes[0] || 'Default'}</span>
        </div>
        <div class="diag-card">
            <span class="label">Speech State</span>
            <span class="val {isSpeechRunning ? 'ok' : ''}">{isSpeechRunning ? '🟢 Listening' : '⚪ Idle'}</span>
        </div>
    </div>

    <!-- Mode Selector & Controls -->
    <div class="controls-bar">
        <div class="mode-group">
            <label>Test Mode:</label>
            <select bind:value={testMode} disabled={isRecording}>
                <option value="combined">1. Combined (SpeechRecognition + MediaRecorder)</option>
                <option value="speech-only">2. Speech Transcription Only (No MediaRecorder)</option>
                <option value="recorder-only">3. Audio Recording Only (No SpeechRecognition)</option>
            </select>
        </div>

        <div class="action-group">
            {#if !isRecording}
                <button class="btn start-btn" on:click={startTest}>🔴 Start Test</button>
            {:else}
                <button class="btn stop-btn" on:click={stopTest}>⏹ Stop Test</button>
            {/if}
            <button class="btn secondary" on:click={() => { finalTranscript = ''; interimTranscript = ''; logs = []; }}>🧹 Clear</button>
        </div>
    </div>

    <!-- Live Transcription Output -->
    <div class="panel">
        <div class="panel-header">
            <span>📝 Live Transcription Output</span>
            {#if interimTranscript}
                <span class="interim-badge">🎤 Hearing: "{interimTranscript}"</span>
            {/if}
        </div>
        <textarea
            class="transcript-area"
            bind:value={finalTranscript}
            placeholder="Speak into your microphone after clicking Start Test..."
        ></textarea>
    </div>

    <!-- Audio Playback Output -->
    <div class="panel">
        <div class="panel-header">
            <span>🔊 Recorded Audio Playback</span>
            <span style="font-size: 0.78rem; color: #94a3b8;">
                Chunks: {chunkCount} | Size: {(recordedSize / 1024).toFixed(1)} KB | MIME: {recordedMime || 'N/A'}
            </span>
        </div>
        {#if audioUrl}
            <audio controls src={audioUrl} class="audio-player"></audio>
        {:else}
            <p style="margin: 0; font-size: 0.82rem; color: #64748b;">Stop a recording in Combined or Audio Recording Only mode to test playback here.</p>
        {/if}
    </div>

    <!-- Diagnostic Event Log -->
    <div class="panel">
        <div class="panel-header">
            <span>🛠️ Real-Time Event & Error Log</span>
            <span style="font-size: 0.72rem; color: #64748b;">{capabilities.userAgent}</span>
        </div>
        <div class="log-box">
            {#if logs.length === 0}
                <div style="color: #64748b;">No events logged yet.</div>
            {:else}
                {#each logs as item}
                    <div class="log-row {item.type.toLowerCase()}">
                        <span class="log-ts">[{item.ts}]</span>
                        <span class="log-tag">{item.type}</span>
                        <span class="log-msg">{item.msg}</span>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
</div>

<style>
    .audio-test-container { display: flex; flex-direction: column; gap: 15px; color: var(--text-color); }
    .subtitle { font-size: 0.85rem; color: #94a3b8; margin: 0; }

    .diag-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .diag-card { background: var(--sidebar-bg); border: 1px solid var(--border-color); padding: 10px 14px; border-radius: 8px; display: flex; flex-direction: column; gap: 4px; }
    .diag-card .label { font-size: 0.72rem; color: #94a3b8; text-transform: uppercase; }
    .diag-card .val { font-size: 0.9rem; font-weight: bold; }
    .diag-card .val.ok { color: #34d399; }
    .diag-card .val.err { color: #f87171; }

    .controls-bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; background: var(--sidebar-bg); padding: 12px 15px; border-radius: 8px; border: 1px solid var(--border-color); }
    .mode-group { display: flex; align-items: center; gap: 10px; font-size: 0.88rem; }
    .mode-group select { background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; }
    .action-group { display: flex; gap: 10px; }

    .btn { padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; border: none; font-size: 0.88rem; }
    .start-btn { background: #ef4444; color: white; }
    .stop-btn { background: #f59e0b; color: black; }
    .secondary { background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); }

    .panel { background: var(--sidebar-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .panel-header { display: flex; justify-content: space-between; align-items: center; font-weight: bold; font-size: 0.88rem; flex-wrap: wrap; gap: 8px; }
    .interim-badge { background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; font-style: italic; }

    .transcript-area { width: 100%; min-height: 100px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; font-family: inherit; font-size: 0.9rem; resize: vertical; box-sizing: border-box; }
    .audio-player { width: 100%; height: 38px; }

    .log-box { background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; max-height: 220px; overflow-y: auto; font-family: monospace; font-size: 0.78rem; display: flex; flex-direction: column; gap: 4px; }
    .log-row { display: flex; gap: 8px; line-height: 1.4; }
    .log-ts { color: #64748b; flex-shrink: 0; }
    .log-tag { font-weight: bold; flex-shrink: 0; min-width: 72px; }
    .log-row.error { color: #f87171; }
    .log-row.result { color: #34d399; }
    .log-row.speech { color: #60a5fa; }
    .log-row.recorder { color: #fbbf24; }
</style>
