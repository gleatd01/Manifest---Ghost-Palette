<script>
    import VideoRecorder from '../components/studymode/VideoRecorder.svelte';
</script>

<div class="test-container">
    <h2>📹 Standalone Video Record Test</h2>
    <p style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 20px;">
        Use this dedicated test page to verify camera access and WebM video recording capabilities before integrating into the main study mode workspace.
    </p>

    <VideoRecorder />
</div>

<style>
    .test-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: 800px;
        color: var(--text-color);
        box-sizing: border-box;
        margin: 0 auto;
    }
</style>
