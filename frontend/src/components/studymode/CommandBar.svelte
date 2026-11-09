<script>
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();

    export let activeMode = 'notes'; // 'notes', 'audio', 'video'
    export let isRecordingAudio = false;
    export let isRecordingVideo = false;

    function setMode(mode) {
        activeMode = mode;
        dispatch('modeChange', { mode });
    }
</script>

<div class="command-bar">
    <button class="cmd-btn {activeMode === 'notes' ? 'active' : ''}" on:click={() => setMode('notes')}>
        ✍️ Notes
    </button>

    <button class="cmd-btn {activeMode === 'audio' ? 'active' : ''}" on:click={() => setMode('audio')}>
        🎙️ Audio {isRecordingAudio ? '🔴' : ''}
    </button>

    <button class="cmd-btn {activeMode === 'video' ? 'active' : ''}" on:click={() => setMode('video')}>
        📹 Video {isRecordingVideo ? '🔴' : ''}
    </button>
</div>

<style>
    .command-bar {
        display: flex;
        gap: 10px;
        background: var(--sidebar-bg);
        padding: 10px 15px;
        border-radius: 8px;
        border: 1px solid var(--border-color);
        align-items: center;
        justify-content: center;
        margin-bottom: 15px;
    }
    .cmd-btn {
        background: var(--input-bg);
        color: var(--text-color);
        border: 1px solid var(--border-color);
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 0.9rem;
        cursor: pointer;
        transition: 0.2s;
    }
    .cmd-btn.active {
        background: var(--btn-primary-bg);
        font-weight: bold;
        border-color: var(--btn-primary-bg);
    }
</style>
