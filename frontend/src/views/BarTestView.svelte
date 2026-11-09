<script>
    import CommandBar from '../components/studymode/CommandBar.svelte';
    import HandwritingCanvas from '../components/studymode/HandwritingCanvas.svelte';
    import VideoRecorder from '../components/studymode/VideoRecorder.svelte';

    let activeMode = 'notes'; // Default mode
    let isRecordingAudio = false;
    let isRecordingVideo = false;

    // Handwriting state
    let activeTool = 'pen';
    let strokeColor = '#3b82f6';
    let strokeSize = 5;
    let allStrokes = [];

    function handleModeChange(event) {
        activeMode = event.detail.mode;
    }

    function clearCanvas() {
        allStrokes = [];
    }
</script>

<div class="bar-test-container">
    <h2>🧪 Command Bar Integration Test</h2>
    <p style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 20px;">
        Testing modular architecture. The Command Bar dictates which tool view is active below.
    </p>

    <!-- Orchestrator Command Bar -->
    <CommandBar
        bind:activeMode
        bind:isRecordingAudio
        bind:isRecordingVideo
        on:modeChange={handleModeChange}
    />

    <!-- Dynamic Content Area Based on Active Mode -->
    <div class="content-area">
        {#if activeMode === 'notes'}
            <div class="notes-workspace">
                <div class="toolbar">
                    <div class="tools-group">
                        <button class="tool-btn {activeTool === 'pen' ? 'active' : ''}" on:click={() => activeTool = 'pen'}>🖊️ Pen</button>
                        <button class="tool-btn {activeTool === 'highlighter' ? 'active' : ''}" on:click={() => activeTool = 'highlighter'}>🖍️ Highlight</button>
                        <button class="tool-btn {activeTool === 'eraser' ? 'active' : ''}" on:click={() => activeTool = 'eraser'}>🧹 Eraser</button>
                        <button class="tool-btn {activeTool === 'pan' ? 'active' : ''}" on:click={() => activeTool = 'pan'}>🖐 Pan</button>
                    </div>

                    {#if activeTool !== 'eraser' && activeTool !== 'pan'}
                        <div class="color-group">
                            {#each ['#3b82f6', '#ef4444', '#10b981', '#eab308', '#ffffff', '#000000'] as color}
                                <button
                                    style="width:24px; height:24px; border-radius:50%; background:{color}; border: {strokeColor === color ? '2px solid white' : '1px solid #64748b'}; cursor:pointer;"
                                    on:click={() => strokeColor = color}
                                ></button>
                            {/each}
                        </div>
                    {/if}

                    <button class="btn secondary" style="margin-left: auto;" on:click={clearCanvas}>🗑️ Clear</button>
                </div>

                <div class="canvas-box">
                    <HandwritingCanvas
                        canvasWidth={800}
                        canvasHeight={600}
                        bind:allStrokes
                        bind:activeTool
                        bind:strokeColor
                        bind:strokeSize
                        isPanEnabled={activeTool === 'pan'}
                    />
                </div>
            </div>

        {:else if activeMode === 'audio'}
            <div class="placeholder-module">
                <h3>🎙️ Audio Recording Module</h3>
                <p>Standalone audio recording capabilities would be orchestrated here.</p>
                <button class="btn" on:click={() => isRecordingAudio = !isRecordingAudio}>
                    {isRecordingAudio ? 'Stop Recording' : 'Start Audio Record'}
                </button>
            </div>

        {:else if activeMode === 'video'}
            <div class="video-workspace">
                <VideoRecorder bind:isRecording={isRecordingVideo} />
            </div>
        {/if}
    </div>
</div>

<style>
    .bar-test-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: 900px;
        color: var(--text-color);
        box-sizing: border-box;
        margin: 0 auto;
    }

    .content-area {
        background: var(--container-bg);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        min-height: 500px;
        padding: 20px;
        display: flex;
        flex-direction: column;
    }

    .notes-workspace {
        display: flex;
        flex-direction: column;
        gap: 15px;
        height: 100%;
    }

    .toolbar {
        display: flex;
        gap: 15px;
        align-items: center;
        background: var(--sidebar-bg);
        padding: 10px;
        border-radius: 8px;
        border: 1px solid var(--border-color);
    }

    .tools-group, .color-group {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .tool-btn {
        background: var(--input-bg);
        color: var(--text-color);
        border: 1px solid var(--border-color);
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 0.9rem;
        cursor: pointer;
    }

    .tool-btn.active {
        background: var(--btn-primary-bg);
        font-weight: bold;
    }

    .canvas-box {
        flex: 1;
        background: #fff;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        overflow: hidden;
        position: relative;
        min-height: 600px;
    }

    .placeholder-module {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 20px;
        text-align: center;
        color: #94a3b8;
    }

    .btn {
        background: var(--btn-primary-bg);
        color: var(--text-color);
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
    }
</style>
