<script>
    import { onMount, tick } from 'svelte';
    import { editingTask, isStudyMode, isHeaderCollapsed, loadTasks } from '../stores/appStore.js';
    import * as pdfjsLib from 'pdfjs-dist';

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // --- Study Mode Local State ---
    let drawingMode = 'off'; // 'off', 'svg', 'fabric'
    let isPanning = false;
    let pzInstance = null;
    let fabCanvas = null;
    let currentPoints = [];
    let strokes = [];

    // Notes Mode State
    let notesMode = 'text'; // 'text', 'scratchpad'
    let notesCurrentPoints = [];
    let notesStrokes = [];
    let notesPadRef;
    let notesPadWidth = 500;
    let notesPadHeight = 300;

    // PDF variables
    let pdfContainerRef;
    let canvasRef;
    let pdfDoc = null;
    let pageNum = 1;
    let isRendering = false;
    let pdfWidth = 0;
    let pdfHeight = 0;

    // Media variables
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recognition = null;
    let recordingStartTime = 0;
    let slideTimeline = [];
    let activePlaybackPage = 1;

    // Initialization logic for Study Mode
    onMount(async () => {
        if ($editingTask.slide_tracking) {
            slideTimeline = JSON.parse($editingTask.slide_tracking);
        } else {
            slideTimeline = [];
        }

        if ($editingTask.pdf_url) {
            await tick();
            loadPdf($editingTask.pdf_url);
        }

        initSpeechRecognition();
    });

    /**
     * Initializes the SpeechRecognition API to transcribe audio into the markdown editor.
     */
    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        $editingTask.transcription = ($editingTask.transcription || '') + event.results[i][0].transcript + ' ';
                        saveEdit();
                    }
                }
            };
        }
    }

    /**
     * Closes study mode and returns to the normal view layout.
     */
    function closeEdit() {
        if(isRecording) stopRecording();
        isStudyMode.set(false);
        isHeaderCollapsed.set(false);
        // Do not synchronously clear editingTask here to prevent null-dereference crashes
        // before Svelte unmounts this component. The parent App.svelte handles cleanup.
        setTimeout(() => editingTask.set(null), 10);
    }

    /**
     * Persists the current editingTask state to the server.
     */
    async function saveEdit() {
        await fetch(`/api/tasks/${$editingTask.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...$editingTask,
                dueDate: $editingTask.due_date,
                predecessors: $editingTask.predecessors,
                assignees: $editingTask.assignees,
                reminderTime: $editingTask.reminder_time,
                reminderFrequency: $editingTask.reminder_frequency
            })
        });
        loadTasks();
    }

    // --- INFINITE CANVAS & HANDWRITING LOGIC ---
    function initPanzoom() {
        if (pzInstance) return;
        const wrapper = document.getElementById('zoom-wrapper');
        if (!wrapper) return;

        pzInstance = window.panzoom(wrapper, {
            bounds: true,
            boundsPadding: 0.1,
            maxZoom: 5,
            minZoom: 0.5,
            beforeMouseDown: function(e) {
                if (drawingMode !== 'off' && !isPanning) return true;
                return false;
            }
        });
    }

    async function handleModeSwitch() {
        await tick();
        if (drawingMode !== 'off') initPanzoom();

        if (drawingMode === 'fabric') {
            if (fabCanvas) fabCanvas.dispose();
            fabCanvas = new window.fabric.Canvas('fab-canvas', {
                isDrawingMode: true,
                width: pdfWidth,
                height: pdfHeight
            });
            fabCanvas.freeDrawingBrush.color = '#3b82f6';
            fabCanvas.freeDrawingBrush.width = 3;
        } else {
            if (fabCanvas) { fabCanvas.dispose(); fabCanvas = null; }
        }
    }

    function clearHandwriting() {
        if (drawingMode === 'svg') strokes = [];
        if (drawingMode === 'fabric' && fabCanvas) fabCanvas.clear();
    }

    function insertPdfSvgToNotes() {
        if (drawingMode !== 'svg' || strokes.length === 0) return;
        let svgStr = generateSvgStringFromStrokes(strokes);
        $editingTask.description = ($editingTask.description || '') + "\n\n" + svgStr + "\n\n";
        saveEdit();
        renderPreview();
        clearHandwriting();
    }

    function svgDown(e) {
        if (isPanning) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        currentPoints = [[e.offsetX, e.offsetY, e.pressure || 0.5]];
    }

    function svgMove(e) {
        if (isPanning || e.buttons !== 1 || currentPoints.length === 0) return;
        currentPoints = [...currentPoints, [e.offsetX, e.offsetY, e.pressure || 0.5]];
    }

    function svgUp(e) {
        if (isPanning || currentPoints.length === 0) return;
        strokes = [...strokes, currentPoints];
        currentPoints = [];
    }

    // --- Notes Scratchpad Handlers ---
    function notesSvgDown(e) {
        e.currentTarget.setPointerCapture(e.pointerId);
        notesCurrentPoints = [[e.offsetX, e.offsetY, e.pressure || 0.5]];
    }

    function notesSvgMove(e) {
        if (e.buttons !== 1 || notesCurrentPoints.length === 0) return;
        notesCurrentPoints = [...notesCurrentPoints, [e.offsetX, e.offsetY, e.pressure || 0.5]];
    }

    function notesSvgUp(e) {
        if (notesCurrentPoints.length === 0) return;
        notesStrokes = [...notesStrokes, notesCurrentPoints];
        notesCurrentPoints = [];
    }

    function clearNotesScratchpad() {
        notesStrokes = [];
    }

    function generateSvgStringFromStrokes(targetStrokes) {
        if (targetStrokes.length === 0) return "";
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        targetStrokes.forEach(stroke => {
            stroke.forEach(pt => {
                if (pt[0] < minX) minX = pt[0];
                if (pt[1] < minY) minY = pt[1];
                if (pt[0] > maxX) maxX = pt[0];
                if (pt[1] > maxY) maxY = pt[1];
            });
        });

        // Add padding
        minX -= 20; minY -= 20; maxX += 20; maxY += 20;
        let width = maxX - minX;
        let height = maxY - minY;

        let paths = targetStrokes.map(stroke => {
            let offsetStroke = stroke.map(pt => [pt[0] - minX, pt[1] - minY, pt[2]]);
            let d = getSvgPathFromStroke(window.perfectFreehand.getStroke(offsetStroke, { size: 6, thinning: 0.5, smoothing: 0.5 }));
            return `<path d="${d}" fill="#3b82f6" />`;
        }).join("");

        return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">\n${paths}\n</svg>`;
    }

    function insertScratchpadToNotes() {
        if (notesStrokes.length === 0) return;
        let svgStr = generateSvgStringFromStrokes(notesStrokes);
        $editingTask.description = ($editingTask.description || '') + "\n\n" + svgStr + "\n\n";
        saveEdit();
        renderPreview();
        clearNotesScratchpad();
        notesMode = 'text'; // switch back to text mode
    }

    // Handle resize of notes pad container
    let ro;
    $: if (notesPadRef) {
        if (!ro) {
            ro = new ResizeObserver(entries => {
                for (let entry of entries) {
                    if (entry.target === notesPadRef) {
                        notesPadWidth = entry.contentRect.width;
                        notesPadHeight = entry.contentRect.height;
                    }
                }
            });
        }
        ro.observe(notesPadRef);
    } else if (ro) {
        ro.disconnect();
    }

    function getSvgPathFromStroke(stroke) {
        if (!stroke.length) return '';
        const d = stroke.reduce(
          (acc, [x0, y0], i, arr) => {
            const [x1, y1] = arr[(i + 1) % arr.length];
            acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
            return acc;
          },
          ['M', ...stroke[0], 'Q']
        );
        d.push('Z');
        return d.join(' ');
    }

    // --- PDF Loading ---
    async function loadPdf(url) {
        try {
            pdfDoc = await pdfjsLib.getDocument(url).promise;
            renderPage(1);
        } catch(e) { console.error("PDF Load Error", e); }
    }

    async function renderPage(num) {
        isRendering = true;
        pageNum = num;
        activePlaybackPage = num;

        if (!canvasRef) return;

        const page = await pdfDoc.getPage(num);
        const viewport = page.getViewport({ scale: 1.5 });
        canvasRef.height = viewport.height;
        canvasRef.width = viewport.width;

        pdfWidth = viewport.width;
        pdfHeight = viewport.height;

        await page.render({ canvasContext: canvasRef.getContext('2d'), viewport: viewport }).promise;
        isRendering = false;

        if (isRecording) {
            const timeElapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            slideTimeline.push({ time: timeElapsed, page: num });
            $editingTask.slide_tracking = JSON.stringify(slideTimeline);
        }

        if (drawingMode === 'fabric' && fabCanvas) {
            fabCanvas.setWidth(pdfWidth);
            fabCanvas.setHeight(pdfHeight);
        }
    }

    async function uploadFileToDrive(file, type) {
        const formData = new FormData();
        formData.append('file', file, file.name || `recording_${Date.now()}.webm`);

        const tempUrl = URL.createObjectURL(file);
        if (type === 'pdf') {
            $editingTask.pdf_url = tempUrl;
            await tick();
            loadPdf(tempUrl);
        } else if (type === 'audio') {
            $editingTask.audio_url = tempUrl;
        }

        try {
            const res = await fetch('/api/drive/upload', { method: 'POST', body: formData });
            const data = await res.json();

            if (data.fileId) {
                if (type === 'pdf') {
                    $editingTask.drive_pdf_id = data.fileId;
                    $editingTask.pdf_url = `/api/drive/download/${data.fileId}`;
                }
                if (type === 'audio') {
                    $editingTask.drive_audio_id = data.fileId;
                    $editingTask.audio_url = `/api/drive/download/${data.fileId}`;
                }
                saveEdit();
            }
        } catch (e) { console.error("Drive upload failed", e); }
    }

    function handlePdfUpload(e) {
        const file = e.target.files[0];
        if (file) uploadFileToDrive(file, 'pdf');
    }

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                uploadFileToDrive(audioBlob, 'audio');
            };

            recordingStartTime = Date.now();
            slideTimeline = [{ time: 0, page: pageNum }];
            mediaRecorder.start();
            isRecording = true;

            if (recognition) {
                if (!$editingTask.transcription) $editingTask.transcription = '';
                $editingTask.transcription += '\n--- Recording Started ---\n';
                recognition.start();
            }
        } catch (err) {
            console.error("Microphone access denied or failed", err);
            alert("Could not start recording. Please check microphone permissions.");
        }
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            isRecording = false;
            $editingTask.slide_tracking = JSON.stringify(slideTimeline);
            saveEdit();
            if (recognition) recognition.stop();
        }
    }

    function handleAudioTimeUpdate(e) {
        const currentTime = e.target.currentTime;
        if (slideTimeline.length > 0 && !isRecording && !isRendering) {
            let low = 0;
            let high = slideTimeline.length - 1;
            let targetedPage = slideTimeline[0].page;

            while (low <= high) {
                let mid = Math.floor((low + high) / 2);
                if (slideTimeline[mid].time <= currentTime) {
                    targetedPage = slideTimeline[mid].page;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }

            if (activePlaybackPage !== targetedPage) {
                renderPage(targetedPage);
            }
        }
    }

    function renderPreview() {
        const previewEl = document.getElementById('md-preview');
        if (!previewEl || !$editingTask) return;
        let txt = $editingTask.description || '';
        txt = txt.replace(/\$\$([\s\S]*?)\$\$/g, (m, eq) => '<div class="katex-block-wrapper">' + window.katex.renderToString(eq.trim(), { displayMode: true, throwOnError: false }) + '</div>');
        txt = txt.replace(/\$([^\$\n]+?)\$/g, (m, eq) => window.katex.renderToString(eq.trim(), { displayMode: false, throwOnError: false }));
        if (window.marked) previewEl.innerHTML = window.marked.parse(txt);
    }
</script>

{#if $editingTask}
<div class="study-workspace">
    <div class="study-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
        <input class="ws-title-input" type="text" bind:value={$editingTask.title} placeholder="Document Title" style="background:transparent; border:none; border-bottom:1px solid var(--border-color); color: var(--text-color); font-size:1.4rem; font-weight:bold; width:60%; padding:8px 0;" on:input={saveEdit} />
        <button class="btn secondary" on:click={closeEdit}>Exit Study Mode</button>
    </div>

    <div class="study-layout-container {$isHeaderCollapsed ? 'maximized' : ''}">
        <!-- LEFT SIDEBAR: Audio & Transcripts -->
        <div class="study-sidebar">
            <div class="pane-header">Audio & Transcript</div>

            <div class="audio-controls">
                {#if !isRecording}
                    <button class="btn action-btn record-btn" on:click={startRecording}>🔴 Record</button>
                {:else}
                    <button class="btn action-btn stop-btn" on:click={stopRecording}>⏹ Stop (Saves)</button>
                {/if}
            </div>
            {#if $editingTask.audio_url}
                <div style="margin-bottom: 15px;">
                    <audio controls class="audio-player" src={$editingTask.audio_url} on:timeupdate={handleAudioTimeUpdate}></audio>
                </div>
            {/if}

            <div class="transcript-box" id="transcript-scroll-box">
                <p class="section-label" style="font-size:0.75rem; margin-bottom:8px;">Live Transcription</p>
                <textarea class="transcription-box" bind:value={$editingTask.transcription} on:input={saveEdit} placeholder="Your live speech will appear here..."></textarea>
            </div>
        </div>

        <!-- MAIN WORKSPACE: PDF Viewer & Markdown Editor -->
        <div class="study-main-workspace">
            <div class="pdf-panel">
                <div class="panel-tools" style="display:flex; flex-direction:column; gap:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        {#if !$editingTask.pdf_url}
                            <label class="upload-btn">
                                Upload PDF to Drive
                                <input type="file" accept="application/pdf" style="display:none;" on:change={handlePdfUpload} />
                            </label>
                        {:else}
                            <div class="pdf-nav">
                                <button on:click={() => renderPage(pageNum-1)} disabled={pageNum<=1}>Prev Slide</button>
                                <span style="font-weight: bold; color: #a5b4fc;">Slide {pageNum}</span>
                                <button on:click={() => renderPage(pageNum+1)} disabled={!pdfDoc || pageNum >= pdfDoc.numPages}>Next Slide</button>
                            </div>
                        {/if}
                    </div>

                    {#if $editingTask.pdf_url}
                        <div class="hw-tools" style="display:flex; gap:10px; align-items:center; border-top: 1px solid var(--border-color); padding-top: 10px;">
                            <select bind:value={drawingMode} on:change={handleModeSwitch} style="background: var(--border-color); color: var(--text-color); border:1px solid var(--border-color); padding:6px; border-radius:4px; font-size:0.85rem;">
                                <option value="off">Mode: Read-Only</option>
                                <option value="svg">Mode: Perfect Freehand (Vector)</option>
                                <option value="fabric">Mode: Fabric.js (Canvas)</option>
                            </select>

                            {#if drawingMode !== 'off'}
                                <button class="btn {isPanning ? 'secondary' : 'primary'} small-btn" style="padding:6px;" on:click={() => isPanning = false}>✏️ Draw</button>
                                <button class="btn {isPanning ? 'primary' : 'secondary'} small-btn" style="padding:6px;" on:click={() => isPanning = true}>🖐 Pan Workspace</button>
                                <button class="btn secondary small-btn" style="padding:6px; margin-left:auto;" on:click={clearHandwriting}>🗑️ Clear Ink</button>
                                {#if drawingMode === 'svg'}
                                    <button class="btn primary small-btn" style="padding:6px; margin-left:10px;" on:click={insertPdfSvgToNotes}>➕ Insert to Notes</button>
                                {/if}
                            {/if}
                        </div>
                    {/if}
                </div>

                <div class="canvas-container" bind:this={pdfContainerRef}>
                    <div id="zoom-wrapper" style="position: relative; transform-origin: 0 0;">
                        <canvas bind:this={canvasRef} class="pdf-base-layer"></canvas>

                        {#if drawingMode === 'svg'}
                            <svg
                                class="drawing-layer svg-layer"
                                style="width: {pdfWidth}px; height: {pdfHeight}px; pointer-events: {isPanning ? 'none' : 'auto'};"
                                on:pointerdown={svgDown}
                                on:pointermove={svgMove}
                                on:pointerup={svgUp}
                                on:pointerleave={svgUp}
                            >
                                {#each strokes as stroke}
                                    <path d={getSvgPathFromStroke(window.perfectFreehand.getStroke(stroke, { size: 6, thinning: 0.5, smoothing: 0.5 }))} fill="#3b82f6" />
                                {/each}
                                {#if currentPoints.length > 0}
                                    <path d={getSvgPathFromStroke(window.perfectFreehand.getStroke(currentPoints, { size: 6, thinning: 0.5, smoothing: 0.5 }))} fill="#3b82f6" />
                                {/if}
                            </svg>
                        {/if}

                        {#if drawingMode === 'fabric'}
                            <div class="drawing-layer fabric-layer" style="width: {pdfWidth}px; height: {pdfHeight}px; pointer-events: {isPanning ? 'none' : 'auto'};">
                                <canvas id="fab-canvas"></canvas>
                            </div>
                        {/if}
                    </div>
                </div>
            </div>

            <div class="notes-block">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <p class="section-label" style="font-size:0.75rem; margin:0;">LaTeX / Markdown Notes</p>
                    <div style="display:flex; gap:10px;">
                        <button class="btn {notesMode === 'text' ? 'primary' : 'secondary'} small-btn" style="padding:4px 8px; font-size:0.75rem;" on:click={() => notesMode = 'text'}>Text/LaTeX</button>
                        <button class="btn {notesMode === 'scratchpad' ? 'primary' : 'secondary'} small-btn" style="padding:4px 8px; font-size:0.75rem;" on:click={() => notesMode = 'scratchpad'}>Scratchpad</button>
                    </div>
                </div>

                <div style="display:flex; gap:15px; flex:1; min-height:0;">
                    {#if notesMode === 'text'}
                        <textarea bind:value={$editingTask.description} on:input={() => { saveEdit(); renderPreview(); }} placeholder="Type your notes here..."></textarea>
                    {:else}
                        <div class="notes-scratchpad-container" bind:this={notesPadRef} style="flex:1; background: var(--input-bg); border: 1px solid var(--border-color); border-radius:6px; position:relative; touch-action:none; overflow:hidden;">
                            {#if notesPadWidth && notesPadHeight}
                                <svg
                                    style="width:{notesPadWidth}px; height:{notesPadHeight}px; cursor:crosshair; display:block;"
                                    on:pointerdown={notesSvgDown}
                                    on:pointermove={notesSvgMove}
                                    on:pointerup={notesSvgUp}
                                    on:pointerleave={notesSvgUp}
                                >
                                    {#each notesStrokes as stroke}
                                        <path d={getSvgPathFromStroke(window.perfectFreehand.getStroke(stroke, { size: 6, thinning: 0.5, smoothing: 0.5 }))} fill="#3b82f6" />
                                    {/each}
                                    {#if notesCurrentPoints.length > 0}
                                        <path d={getSvgPathFromStroke(window.perfectFreehand.getStroke(notesCurrentPoints, { size: 6, thinning: 0.5, smoothing: 0.5 }))} fill="#3b82f6" />
                                    {/if}
                                </svg>
                            {/if}
                            <div style="position:absolute; bottom:10px; right:10px; display:flex; gap:10px;">
                                <button class="btn secondary small-btn" style="padding:6px;" on:click={clearNotesScratchpad}>🗑️ Clear</button>
                                <button class="btn primary small-btn" style="padding:6px;" on:click={insertScratchpadToNotes}>➕ Insert to Notes</button>
                            </div>
                        </div>
                    {/if}
                    <div id="md-preview" class="markdown-body"></div>
                </div>
            </div>
        </div>
    </div>
</div>
{/if}

<style>
    .study-workspace { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .study-layout-container { display: flex; gap: 20px; width: 100%; flex: 1; transition: flex 0.3s ease; min-height: 0; }

    .study-sidebar { width: 280px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--sidebar-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; box-sizing: border-box; overflow: hidden; }
    .pane-header { font-size: 0.8rem; font-weight: bold; color: #666; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 6px; border-bottom: 1px solid var(--border-color); margin-bottom: 15px; }
    .audio-controls { display: flex; gap: 10px; margin-bottom: 15px; }
    .record-btn { background: var(--danger-bg); color: var(--text-color); }
    .record-btn:hover { background: #f43f5e; /* hover state */ }
    .stop-btn { background: var(--badge-bg); color: var(--text-color); }
    .stop-btn:hover { background: #64748b; /* hover state */ }
    .audio-player { width: 100%; height: 35px; border-radius: 4px; }

    .transcript-box { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .transcription-box { flex: 1; background: var(--input-bg); border: 1px solid #1e293b; color: #94a3b8; padding: 12px; border-radius: 6px; font-family: inherit; resize: none; width: 100%; box-sizing: border-box; line-height: 1.5; outline: none;}
    .transcription-box:focus { border-color: var(--btn-primary-bg); }

    .study-main-workspace { flex: 1; display: flex; flex-direction: column; gap: 15px; min-width: 0; overflow: hidden; }
    .pdf-panel { flex: 3; display: flex; flex-direction: column; background: var(--panel-bg); border-radius: 8px; border: 1px solid var(--border-color); overflow: hidden; min-height: 0; }
    .panel-tools { padding: 12px; background: var(--sidebar-bg); border-bottom: 1px solid var(--border-color); display: flex; justify-content: center;}
    .pdf-nav { display: flex; align-items: center; gap: 15px; }
    .pdf-nav button { background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 6px 15px; border-radius: 4px; font-weight: bold; cursor: pointer; }

    .canvas-container { flex: 1; overflow: hidden; display: flex; justify-content: center; align-items: center; padding: 15px; background: var(--input-bg); cursor: grab;}
    .canvas-container:active { cursor: grabbing; }
    .pdf-base-layer { display: block; background: var(--container-bg); box-shadow: 0 4px 20px rgba(0,0,0,0.8); border-radius: 4px; max-width: 100%; object-fit: contain; }

    .drawing-layer { position: absolute; top: 0; left: 0; touch-action: none; z-index: 10; }
    .svg-layer { z-index: 11; }
    .fabric-layer { z-index: 12; }

    .notes-block { flex: 2; display: flex; flex-direction: column; background: var(--sidebar-bg); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); min-height: 0; }
    .notes-block textarea { flex: 1; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 15px; border-radius: 6px; font-family: inherit; resize: none; line-height: 1.5; outline: none; }
    .notes-block textarea:focus { border-color: var(--btn-primary-bg); }
    .markdown-body { flex: 1; padding: 15px; background: var(--input-bg); border-radius: 6px; border: 1px solid var(--border-color); overflow-y: auto; line-height: 1.6; }
    .upload-btn { background: var(--btn-primary-bg); padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; color: var(--text-color); transition: 0.2s; }
</style>