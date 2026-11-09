<script>
    import { onMount, onDestroy } from 'svelte';
    import { createEventDispatcher } from 'svelte';

    const dispatch = createEventDispatcher();

    export let isRecording = false;
    let videoPreview;
    let mediaStream = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let videoUrl = null;

    onMount(async () => {
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (videoPreview) {
                videoPreview.srcObject = mediaStream;
            }
        } catch (err) {
            console.error("Error accessing media devices:", err);
            alert("Could not access camera/microphone. Please ensure permissions are granted.");
        }
    });

    onDestroy(() => {
        stopMediaStream();
    });

    function stopMediaStream() {
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
    }

    export function startRecording() {
        if (!mediaStream) return;
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'video/webm' });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            videoUrl = URL.createObjectURL(blob);
            dispatch('videoSaved', { blob, url: videoUrl });
        };

        mediaRecorder.start();
        isRecording = true;
        dispatch('recordingStart');
    }

    export function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        isRecording = false;
        dispatch('recordingStop');
    }
</script>

<div class="video-container">
    <video bind:this={videoPreview} class="video-preview" autoplay muted playsinline></video>

    <div class="controls">
        {#if !isRecording}
            <button class="record-btn" on:click={startRecording}>🔴 Record Video</button>
        {:else}
            <button class="stop-btn" on:click={stopRecording}>⏹ Stop Recording</button>
        {/if}
    </div>

    {#if videoUrl}
        <div class="playback-area">
            <h4>Recorded Video:</h4>
            <video src={videoUrl} controls class="video-playback"></video>
            <a href={videoUrl} download="recording.webm" class="btn secondary">Download</a>
        </div>
    {/if}
</div>

<style>
    .video-container {
        display: flex;
        flex-direction: column;
        gap: 15px;
        background: var(--sidebar-bg);
        padding: 20px;
        border-radius: 8px;
        border: 1px solid var(--border-color);
        align-items: center;
    }
    .video-preview {
        width: 100%;
        max-width: 600px;
        border-radius: 8px;
        background: #000;
    }
    .video-playback {
        width: 100%;
        max-width: 400px;
        border-radius: 8px;
        margin-top: 10px;
    }
    .controls {
        display: flex;
        gap: 10px;
    }
    .record-btn {
        background: var(--danger-bg, #ef4444);
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: bold;
    }
    .stop-btn {
        background: #64748b;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: bold;
    }
    .playback-area {
        margin-top: 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        width: 100%;
    }
</style>
