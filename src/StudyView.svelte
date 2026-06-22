<script>
    import { onMount } from 'svelte';
    import * as pdfjsLib from 'pdfjs-dist';

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    let pdfUrl = "/sample-document.pdf"; 
    let audioUrl = "/sample-audio.mp3";
    let transcriptText = `Welcome to the lecture workspace. \n\nToday we are going to cover the core components of the newly integrated document architecture. You can place your actual 'sample-document.pdf' and 'sample-audio.mp3' directly into the 'public/' directory of this project so they load natively. \n\nEventually, this audio player will drive the synchronization of these transcribed text blocks!`;

    let canvasRef; 
    let pdfDoc = null; 
    let pageNum = 1; 
    let isRendering = false; 
    let pagePending = null; 

    onMount(async () => {
        try {
            const loadingTask = pdfjsLib.getDocument(pdfUrl);
            pdfDoc = await loadingTask.promise;
            renderPage(pageNum);
        } catch (error) {
            console.error("PDF Load Execution Warning.", error);
            transcriptText = "⚠️ WARNING: sample-document.pdf not found in /public folder. Please add a PDF to test the viewer renderer.";
        }
    });

    async function renderPage(num) {
        isRendering = true;
        const page = await pdfDoc.getPage(num);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef;
        const ctx = canvas.getContext('2d');
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        isRendering = false;

        if (pagePending !== null) {
            renderPage(pagePending);
            pagePending = null;
        }
    }

    function queueRenderPage(num) {
        if (isRendering) { pagePending = num; } 
        else { renderPage(num); }
    }

    function prevPage() {
        if (pageNum <= 1) return;
        pageNum--;
        queueRenderPage(pageNum);
    }

    function nextPage() {
        if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
        pageNum++;
        queueRenderPage(pageNum);
    }
</script>

<div class="study-workspace">
    <div class="pdf-panel">
        <div class="panel-header">
            <h2>Document Sandbox</h2>
            <div class="pdf-controls">
                <button on:click={prevPage} disabled={pageNum <= 1}>&larr; Prev</button>
                <span>Page {pageNum} of {pdfDoc ? pdfDoc.numPages : '--'}</span>
                <button on:click={nextPage} disabled={!pdfDoc || pageNum >= pdfDoc.numPages}>Next &rarr;</button>
            </div>
        </div>
        <div class="canvas-container">
            <canvas bind:this={canvasRef}></canvas>
        </div>
    </div>

    <div class="transcript-panel">
        <div class="panel-header">
            <h2>Audio Transcription</h2>
        </div>
        <div class="audio-player-container">
            <audio controls class="audio-player">
                <source src={audioUrl} type="audio/mpeg">
            </audio>
        </div>
        <div class="transcript-content">
            <p>{transcriptText}</p>
        </div>
    </div>
</div>

<style>
    .study-workspace { display: flex; gap: 20px; height: calc(100vh - 150px); min-height: 600px; background: #0c0c0c; color: #e2e8f0; margin-top: 15px; }
    .pdf-panel { flex: 3; display: flex; flex-direction: column; background: #141414; border: 1px solid #222; border-radius: 10px; overflow: hidden; }
    .transcript-panel { flex: 2; display: flex; flex-direction: column; background: #141414; border: 1px solid #222; border-radius: 10px; overflow: hidden; }
    .panel-header { background: #1a1a1a; padding: 15px; border-bottom: 1px solid #222; display: flex; justify-content: space-between; align-items: center; }
    .panel-header h2 { margin: 0; font-size: 1.1rem; color: #a1a1aa; font-weight: 700; }
    .pdf-controls button { background: #333; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.85rem; }
    .pdf-controls button:disabled { background: #222; color: #555; cursor: not-allowed; }
    .pdf-controls span { margin: 0 10px; font-size: 0.9rem; font-weight: 600; color: #ccc; }
    .canvas-container { flex-grow: 1; overflow: auto; background: #080808; display: flex; justify-content: center; align-items: flex-start; padding: 20px; }
    canvas { background: white; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.8); border-radius: 2px;}
    .audio-player-container { padding: 15px; background: #161616; border-bottom: 1px solid #222; }
    .audio-player { width: 100%; border-radius: 4px; }
    .transcript-content { padding: 25px; overflow-y: auto; line-height: 1.7; font-size: 1.05rem; flex-grow: 1; color: #cbd5e1; white-space: pre-wrap; }
    @media (max-width: 900px) { .study-workspace { flex-direction: column; height: auto; } .canvas-container { height: 50vh; } .transcript-content { min-height: 40vh; } }
</style>