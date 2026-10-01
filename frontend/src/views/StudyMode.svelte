<script>
    import { onMount, tick } from 'svelte';
    import { editingTask, isStudyMode, isHeaderCollapsed, loadTasks } from '../stores/appStore.js';
    import { getStroke } from 'perfect-freehand';
    import * as pdfjsLib from 'pdfjs-dist';

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // --- Study Mode Local State ---
    let activeTab = 'handwriting'; // 'handwriting' or 'markdown'
    let activeTool = 'pen'; // 'pen', 'highlighter', 'eraser', 'pan'
    let smartPan = false; // Toggle between Smart Touch Pan and Manual Strict Pan Mode
    let strokeColor = '#3b82f6';
    let strokeSize = 5;
    let extraPageHeight = 0; // Extra blank space added below slide/canvas

    let pzInstance = null;
    let currentPoints = [];
    let allStrokes = []; // Stored persistently in $editingTask.handwriting_data

    // PDF variables
    let pdfContainerRef;
    let canvasRef;
    let audioRef;
    let pdfDoc = null;
    let pageNum = 1;
    let isRendering = false;
    let pdfWidth = 800;
    let pdfHeight = 1000;

    // Media variables
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recognition = null;
    let recordingStartTime = 0;
    let slideTimeline = [];
    let activePlaybackPage = 1;
    let currentAudioTime = 0;
    let activeStrokeId = null;
    let saveQueue = Promise.resolve();

    $: pageStrokes = allStrokes.filter(s => (s.page || 1) === pageNum);

    // Initialization logic for Study Mode
    onMount(async () => {
        if ($editingTask.slide_tracking) {
            try { slideTimeline = JSON.parse($editingTask.slide_tracking); } catch(e) { slideTimeline = []; }
        } else {
            slideTimeline = [];
        }

        if ($editingTask.handwriting_data) {
            try { allStrokes = JSON.parse($editingTask.handwriting_data); } catch(e) { allStrokes = []; }
        } else {
            allStrokes = [];
        }

        if ($editingTask.pdf_url) {
            await tick();
            loadPdf($editingTask.pdf_url);
        } else {
            // Setup blank paper default dimensions
            pdfWidth = 800;
            pdfHeight = 1000;
            await tick();
            renderBlankCanvas();
            initPanzoom();
        }

        initSpeechRecognition();
        renderPreview();
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
        editingTask.set(null);
    }

    /**
     * Persists the current editingTask state to the server.
     */
    async function saveEdit() {
        saveQueue = saveQueue.catch(() => {}).then(async () => {
            $editingTask.handwriting_data = JSON.stringify(allStrokes);
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
            await loadTasks();
        });
        return saveQueue;
    }

    // --- INFINITE CANVAS & HANDWRITING LOGIC ---
    function isStylusOrPen(e) {
        const pType = e.pointerType;
        const tType = e.touchType || (e.touches && e.touches[0] && e.touches[0].touchType);
        return pType === 'pen' || tType === 'stylus' || (e.pressure !== undefined && e.pressure > 0 && e.pointerType !== 'mouse');
    }

    function updatePanzoomState() {
        if (!pzInstance) return;
        if (smartPan) {
            pzInstance.resume();
        } else {
            if (activeTool === 'pan') {
                pzInstance.resume();
            } else {
                pzInstance.pause();
            }
        }
    }

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
                // Return true to CANCEL panzoom (allowing drawing/interaction)
                // Return false to ALLOW panzoom (allowing panning/zooming)

                if (!smartPan) {
                    if (activeTool === 'pan') return false;
                    return true;
                }

                const isPen = isStylusOrPen(e);
                if (isPen) return true; // Pen bypasses panzoom to draw ink
                if (activeTool === 'pan') return false; // Pan tool allows panzoom
                if (e.pointerType === 'touch') return false; // Finger touch allows panzoom
                return true; // Prevent panzoom for mouse drawing
            }
        });
        updatePanzoomState();
    }

    function addBlankSpace() {
        extraPageHeight += 300;
        if (!pdfDoc) {
            renderBlankCanvas();
        } else {
            renderPage(pageNum);
        }
    }

    function renderBlankCanvas() {
        if (!canvasRef) return;
        const totalHeight = pdfHeight + extraPageHeight;
        canvasRef.width = pdfWidth;
        canvasRef.height = totalHeight;
        const ctx = canvasRef.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pdfWidth, totalHeight);

        // Draw light horizontal notebook guidelines
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        for (let y = 40; y < totalHeight; y += 30) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(pdfWidth, y);
            ctx.stroke();
        }
    }

    function clearHandwriting() {
        allStrokes = allStrokes.filter(s => (s.page || 1) !== pageNum);
        saveEdit();
    }

    function getAudioTimestamp() {
        if (audioRef && !audioRef.paused && audioRef.currentTime > 0) {
            return Math.floor(audioRef.currentTime);
        }
        if (audioRef && audioRef.currentTime > 0) {
            return Math.floor(audioRef.currentTime);
        }
        if (isRecording) {
            return Math.floor((Date.now() - recordingStartTime) / 1000);
        }
        return 0;
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function getPointerPos(e) {
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        // Calculate relative coordinates in SVG user space safely for Safari / iOS WebKit
        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        const scaleX = pdfWidth / (rect.width || pdfWidth);
        const totalHeight = pdfHeight + extraPageHeight;
        const scaleY = totalHeight / (rect.height || totalHeight);
        const x = (clientX - rect.left) * scaleX;
        const y = (clientY - rect.top) * scaleY;
        const pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : 0.5;
        return [x, y, pressure];
    }

    function svgDown(e) {
        const isPen = isStylusOrPen(e);
        if (activeTool === 'pan' && !smartPan) return;
        // Finger touch always pans/zooms unless drawing with stylus/pen
        if (smartPan && e.pointerType === 'touch' && !isPen) return;

        if (e.preventDefault) e.preventDefault();
        try {
            if (e.pointerId !== undefined && e.currentTarget.setPointerCapture) {
                e.currentTarget.setPointerCapture(e.pointerId);
            }
        } catch(err) {}

        const pt = getPointerPos(e);

        if (activeTool === 'eraser') {
            eraseStrokeAt(pt[0], pt[1]);
            return;
        }

        currentPoints = [pt];
    }

    function svgMove(e) {
        const isPen = isStylusOrPen(e);
        if (smartPan && e.pointerType === 'touch' && !isPen && currentPoints.length === 0) return;

        if (activeTool === 'eraser') {
            if (e.buttons === 1 || isPen) {
                const pt = getPointerPos(e);
                eraseStrokeAt(pt[0], pt[1]);
            }
            return;
        }

        if (currentPoints.length === 0) return;
        if (e.preventDefault) e.preventDefault();

        const pt = getPointerPos(e);
        currentPoints = [...currentPoints, pt];
    }

    function svgUp(e) {
        if (currentPoints.length === 0) return;

        const ts = getAudioTimestamp();
        const newStroke = {
            id: 'stroke_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            page: pageNum,
            timestamp: ts,
            points: currentPoints,
            color: activeTool === 'highlighter' ? strokeColor : strokeColor,
            size: activeTool === 'highlighter' ? strokeSize * 3 : strokeSize,
            isHighlighter: activeTool === 'highlighter'
        };

        allStrokes = [...allStrokes, newStroke];
        currentPoints = [];
        saveEdit();
    }

    function eraseStrokeAt(x, y) {
        const threshold = 15;
        allStrokes = allStrokes.filter(stroke => {
            if ((stroke.page || 1) !== pageNum) return true;
            for (let pt of stroke.points) {
                const dist = Math.hypot(pt[0] - x, pt[1] - y);
                if (dist < threshold) return false; // Delete stroke
            }
            return true;
        });
        saveEdit();
    }

    function generateSvgStringFromStrokes(targetStrokes) {
        if (targetStrokes.length === 0) return "";
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        targetStrokes.forEach(stroke => {
            stroke.points.forEach(pt => {
                if (pt[0] < minX) minX = pt[0];
                if (pt[1] < minY) minY = pt[1];
                if (pt[0] > maxX) maxX = pt[0];
                if (pt[1] > maxY) maxY = pt[1];
            });
        });

        minX -= 20; minY -= 20; maxX += 20; maxY += 20;
        let width = Math.max(100, maxX - minX);
        let height = Math.max(100, maxY - minY);

        let paths = targetStrokes.map(stroke => {
            let offsetPoints = stroke.points.map(pt => [pt[0] - minX, pt[1] - minY, pt[2]]);
            let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
            const opacity = stroke.isHighlighter ? 0.4 : 1.0;
            return `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
        }).join("");

        return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">\n${paths}\n</svg>`;
    }

    function insertPdfSvgToNotes() {
        if (pageStrokes.length === 0) return;
        const ts = getAudioTimestamp();
        let svgStr = generateSvgStringFromStrokes(pageStrokes);
        const timeBadge = `\n\n> ⏱️ **Audio Timestamp [${formatTime(ts)}] - Slide ${pageNum}**\n\n` + svgStr + "\n\n";
        $editingTask.description = ($editingTask.description || '') + timeBadge;
        saveEdit();
        renderPreview();
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
            initPanzoom();
        } catch(e) { console.error("PDF Load Error", e); }
    }

    async function renderPage(num) {
        isRendering = true;
        pageNum = num;
        activePlaybackPage = num;

        if (!canvasRef) return;

        if (pdfDoc) {
            const page = await pdfDoc.getPage(num);
            const viewport = page.getViewport({ scale: 1.5 });
            const totalHeight = viewport.height + extraPageHeight;

            canvasRef.height = totalHeight;
            canvasRef.width = viewport.width;

            pdfWidth = viewport.width;
            pdfHeight = totalHeight;

            const ctx = canvasRef.getContext('2d');
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;

            if (extraPageHeight > 0) {
                ctx.fillStyle = '#f8fafc';
                ctx.fillRect(0, viewport.height, viewport.width, extraPageHeight);
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 1;
                for (let y = viewport.height + 30; y < totalHeight; y += 30) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(viewport.width, y);
                    ctx.stroke();
                }
            }
        } else {
            renderBlankCanvas();
        }

        isRendering = false;

        if (isRecording) {
            const timeElapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            slideTimeline.push({ time: timeElapsed, page: num });
            $editingTask.slide_tracking = JSON.stringify(slideTimeline);
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
        currentAudioTime = Math.floor(currentTime);

        // Slide auto-sync
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

        // Auto-scroll timeline items / notes corresponding to audio time
        const matchingStroke = allStrokes.find(s => Math.abs((s.timestamp || 0) - currentTime) < 2);
        if (matchingStroke) {
            activeStrokeId = matchingStroke.id;
            const el = document.getElementById(`stroke-item-${matchingStroke.id}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    function seekToTime(ts, targetPage) {
        if (targetPage && targetPage !== pageNum) {
            renderPage(targetPage);
        }
        if (audioRef) {
            audioRef.currentTime = ts;
            audioRef.play();
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
        <!-- LEFT SIDEBAR: Audio, Transcripts & Handwritten Timeline -->
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
                    <audio bind:this={audioRef} controls class="audio-player" src={$editingTask.audio_url} on:timeupdate={handleAudioTimeUpdate}></audio>
                </div>
            {/if}

            <div class="transcript-box" id="transcript-scroll-box" style="margin-bottom:15px;">
                <p class="section-label" style="font-size:0.75rem; margin-bottom:6px;">Live Transcription</p>
                <textarea class="transcription-box" bind:value={$editingTask.transcription} on:input={saveEdit} placeholder="Your live speech will appear here..."></textarea>
            </div>

            <div class="timeline-box" style="flex:1; display:flex; flex-direction:column; min-height:0; border-top: 1px solid var(--border-color); padding-top: 10px;">
                <p class="section-label" style="font-size:0.75rem; margin-bottom:6px;">Timestamped Notes & Strokes</p>
                <div id="timeline-scroll-box" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
                    {#if allStrokes.length === 0}
                        <p style="font-size:0.75rem; color:#64748b;">No handwritten strokes recorded yet. Write on the canvas with Apple Pencil or pen!</p>
                    {:else}
                        {#each allStrokes as stroke}
                            <button
                                id="stroke-item-{stroke.id}"
                                class="timeline-item {activeStrokeId === stroke.id ? 'active' : ''}"
                                style="display:flex; justify-content:space-between; align-items:center; background: var(--input-bg); border: 1px solid var(--border-color); padding: 6px 10px; border-radius: 4px; font-size: 0.75rem; color: var(--text-color); text-align:left; cursor:pointer;"
                                on:click={() => seekToTime(stroke.timestamp || 0, stroke.page || 1)}
                            >
                                <span>⏱️ <strong>{formatTime(stroke.timestamp || 0)}</strong> (Slide {stroke.page || 1})</span>
                                <span style="width:12px; height:12px; border-radius:50%; background:{stroke.color || '#3b82f6'}; display:inline-block;"></span>
                            </button>
                        {/each}
                    {/if}
                </div>
            </div>
        </div>

        <!-- MAIN WORKSPACE: PDF & Canvas Handwriting Workspace & Notes Tabs -->
        <div class="study-main-workspace">
            <!-- TAB NAVIGATION -->
            <div class="tab-nav">
                <button
                    class="tab-btn {activeTab === 'handwriting' ? 'active' : ''}"
                    on:click={() => activeTab = 'handwriting'}
                >
                    ✍️ Handwritten Notes
                </button>
                <button
                    class="tab-btn {activeTab === 'markdown' ? 'active' : ''}"
                    on:click={() => {
                        activeTab = 'markdown';
                        tick().then(renderPreview);
                    }}
                >
                    📝 LaTeX / Markdown Notes
                </button>
            </div>

            <!-- TAB CONTENT: Handwritten Notes -->
            <div class="tab-content {activeTab === 'handwriting' ? 'active' : ''}">
                <div class="pdf-panel">
                    <!-- Toolbar for PDF / Handwriting Canvas -->
                    <div class="panel-tools" style="display:flex; flex-direction:column; gap:8px; padding:10px; background:var(--sidebar-bg); border-bottom:1px solid var(--border-color);">
                        <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                            {#if !$editingTask.pdf_url}
                                <div style="display:flex; gap:10px; align-items:center;">
                                    <span style="font-weight:bold; font-size:0.9rem; color:var(--text-color);">📝 Blank Paper Canvas</span>
                                    <label class="upload-btn" style="padding:4px 10px; font-size:0.8rem;">
                                        Upload PDF
                                        <input type="file" accept="application/pdf" style="display:none;" on:change={handlePdfUpload} />
                                    </label>
                                </div>
                            {:else}
                                <div class="pdf-nav">
                                    <button on:click={() => renderPage(pageNum-1)} disabled={pageNum<=1}>Prev Slide</button>
                                    <span style="font-weight: bold; color: #a5b4fc;">Slide {pageNum} {pdfDoc ? `/ ${pdfDoc.numPages}` : ''}</span>
                                    <button on:click={() => renderPage(pageNum+1)} disabled={!pdfDoc || pageNum >= pdfDoc.numPages}>Next Slide</button>
                                </div>
                            {/if}

                            <div style="display:flex; gap:8px; align-items:center;">
                                <button class="btn secondary small-btn" style="padding:4px 8px; font-size:0.8rem;" on:click={clearHandwriting}>🗑️ Clear Ink</button>
                                <button class="btn primary small-btn" style="padding:4px 8px; font-size:0.8rem;" on:click={insertPdfSvgToNotes}>➕ Insert Ink to Notes</button>
                            </div>
                        </div>

                        <!-- Stylus & Drawing Controls Toolbar -->
                        <div class="hw-tools" style="display:flex; gap:12px; align-items:center; border-top: 1px solid var(--border-color); padding-top: 8px; touch-action: manipulation; z-index: 20; position: relative;">
                            <div style="display:flex; gap:4px;">
                                <button class="tool-btn {activeTool === 'pen' ? 'active' : ''}" on:click={() => { activeTool = 'pen'; updatePanzoomState(); }} title="Pen (Apple Pencil)">🖊️ Pen</button>
                                <button class="tool-btn {activeTool === 'highlighter' ? 'active' : ''}" on:click={() => { activeTool = 'highlighter'; updatePanzoomState(); }} title="Highlighter">🖍️ Highlight</button>
                                <button class="tool-btn {activeTool === 'eraser' ? 'active' : ''}" on:click={() => { activeTool = 'eraser'; updatePanzoomState(); }} title="Eraser">🧹 Eraser</button>
                                <button class="tool-btn {activeTool === 'pan' ? 'active' : ''}" on:click={() => { activeTool = 'pan'; updatePanzoomState(); }} title="Pan / Zoom Workspace">🖐 Pan/Zoom</button>
                            </div>

                            <div class="smart-toggle">
                                <label style="display:flex; align-items:center; gap:5px; font-size:0.8rem; cursor:pointer;" title="If ON: Touch automatically pans while Pen draws. If OFF: Strict mode (use Pan tool to move, Pen tool to draw)">
                                    <input type="checkbox" bind:checked={smartPan} on:change={updatePanzoomState} />
                                    <span>🧠 Smart Touch Pan</span>
                                </label>
                            </div>

                            {#if activeTool !== 'eraser' && activeTool !== 'pan'}
                                <div style="display:flex; gap:6px; align-items:center; margin-left:10px;">
                                    <span style="font-size:0.75rem;">Color:</span>
                                    {#each ['#3b82f6', '#ef4444', '#10b981', '#eab308', '#ffffff', '#000000'] as color}
                                        <button
                                            style="width:20px; height:20px; border-radius:50%; background:{color}; border: {strokeColor === color ? '2px solid white' : '1px solid #64748b'}; cursor:pointer; padding:0; touch-action: manipulation;"
                                            aria-label={`Set ink color ${color}`}
                                            on:click={() => strokeColor = color}
                                        ></button>
                                    {/each}
                                </div>

                                <div style="display:flex; gap:6px; align-items:center; margin-left:10px;">
                                    <span style="font-size:0.75rem;">Size:</span>
                                    <input type="range" min="2" max="20" bind:value={strokeSize} style="width:70px;" />
                                </div>
                            {/if}

                            <span style="font-size:0.7rem; color:#94a3b8; margin-left:auto;">💡 Tip: Finger touch pans & zooms, Apple Pencil writes automatically!</span>
                        </div>
                    </div>

                    <!-- Canvas Workspace -->
                    <div class="canvas-container" bind:this={pdfContainerRef}>
                        <div id="zoom-wrapper" style="position: relative; transform-origin: 0 0;">
                            <canvas bind:this={canvasRef} class="pdf-base-layer"></canvas>

                            <!-- Vector Handwriting Layer -->
                            <svg
                                class="drawing-layer svg-layer"
                                style="width: {pdfWidth}px; height: {pdfHeight + extraPageHeight}px; pointer-events: {(!smartPan && activeTool === 'pan') ? 'none' : 'auto'}; cursor: {activeTool === 'eraser' ? 'cell' : 'crosshair'}; touch-action: {activeTool === 'pan' ? 'auto' : 'none'};"
                                on:pointerdown={svgDown}
                                on:pointermove={svgMove}
                                on:pointerup={svgUp}
                                on:pointerleave={svgUp}
                                on:pointercancel={svgUp}
                            >
                                {#each pageStrokes as stroke}
                                    <path
                                        d={getSvgPathFromStroke(getStroke(stroke.points, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }))}
                                        fill={stroke.color || '#3b82f6'}
                                        opacity={stroke.isHighlighter ? 0.4 : 1.0}
                                    />
                                {/each}

                                {#if currentPoints.length > 0}
                                    <path
                                        d={getSvgPathFromStroke(getStroke(currentPoints, { size: activeTool === 'highlighter' ? strokeSize * 3 : strokeSize, thinning: 0.5, smoothing: 0.5 }))}
                                        fill={strokeColor}
                                        opacity={activeTool === 'highlighter' ? 0.4 : 1.0}
                                    />
                                {/if}
                            </svg>
                        </div>
                    </div>
                </div>
            </div>

            <!-- TAB CONTENT: LaTeX / Markdown Notes -->
            <div class="tab-content {activeTab === 'markdown' ? 'active' : ''}">
                <div class="notes-block">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <p class="section-label" style="font-size:0.75rem; margin:0;">LaTeX / Markdown Notes</p>
                    </div>

                    <div style="display:flex; gap:15px; flex:1; min-height:0;">
                        <textarea bind:value={$editingTask.description} on:input={() => { saveEdit(); renderPreview(); }} placeholder="Type your notes here..."></textarea>
                        <div id="md-preview" class="markdown-body"></div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
{/if}

<style>
    .study-workspace { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .study-layout-container { display: flex; -webkit-user-select: none; user-select: none; gap: 20px; width: 100%; flex: 1; transition: flex 0.3s ease; min-height: 0; }

    .study-sidebar { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--sidebar-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; box-sizing: border-box; overflow: hidden; }
    .pane-header { font-size: 0.8rem; font-weight: bold; color: #666; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 6px; border-bottom: 1px solid var(--border-color); margin-bottom: 12px; }
    .audio-controls { display: flex; gap: 10px; margin-bottom: 12px; }
    .record-btn { background: var(--danger-bg); color: var(--text-color); }
    .record-btn:hover { background: #f43f5e; }
    .stop-btn { background: var(--badge-bg); color: var(--text-color); }
    .stop-btn:hover { background: #64748b; }
    .audio-player { width: 100%; height: 35px; border-radius: 4px; }

    .transcript-box { height: 120px; display: flex; flex-direction: column; min-height: 0; }
    .transcription-box { flex: 1; background: var(--input-bg); border: 1px solid var(--border-color); color: #94a3b8; padding: 10px; border-radius: 6px; font-family: inherit; resize: none; width: 100%; box-sizing: border-box; line-height: 1.4; outline: none; font-size: 0.8rem; }
    .transcription-box:focus { border-color: var(--btn-primary-bg); }

    .timeline-item { transition: all 0.2s ease; }
    .timeline-item:hover { background: var(--border-color) !important; }
    .timeline-item.active { border-color: var(--btn-primary-bg) !important; background: var(--border-color) !important; font-weight: bold; }

    .study-main-workspace { flex: 1; display: flex; flex-direction: column; gap: 15px; min-width: 0; overflow: hidden; }
    .tab-nav { display: flex; gap: 10px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; }
    .tab-btn { background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: all 0.2s ease; font-size: 0.9rem; }
    .tab-btn:hover { background: var(--border-color); }
    .tab-btn.active { background: var(--btn-primary-bg); border-color: var(--btn-primary-bg); color: var(--text-color); }

    .tab-content { display: none; flex: 1; flex-direction: column; min-height: 0; }
    .tab-content.active { display: flex; }

    .pdf-panel { flex: 1; display: flex; flex-direction: column; background: var(--panel-bg); border-radius: 8px; border: 1px solid var(--border-color); overflow: hidden; min-height: 0; }
    .pdf-nav { display: flex; align-items: center; gap: 15px; }
    .pdf-nav button { background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 4px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size:0.8rem; }

    .tool-btn { background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 6px 12px; border-radius: 4px; font-size: 0.85rem; cursor: pointer; transition: 0.15s; touch-action: manipulation; }
    .tool-btn.active { background: var(--btn-primary-bg); font-weight: bold; border-color: var(--btn-primary-bg); }

    .canvas-container { flex: 1; -webkit-user-select: none; user-select: none; overflow: hidden; display: flex; justify-content: center; align-items: center; padding: 15px; background: var(--input-bg); cursor: grab;}
    .canvas-container:active { cursor: grabbing; }
    .pdf-base-layer { display: block; background: #ffffff; box-shadow: 0 4px 20px rgba(0,0,0,0.5); border-radius: 4px; max-width: 100%; object-fit: contain; }

    .drawing-layer { position: absolute; top: 0; left: 0; touch-action: none; z-index: 10; }
    .svg-layer { z-index: 11; }

    .notes-block { flex: 1; display: flex; flex-direction: column; background: var(--sidebar-bg); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); min-height: 0; }
    .notes-block textarea { flex: 1; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 15px; border-radius: 6px; font-family: inherit; resize: none; line-height: 1.5; outline: none; }
    .notes-block textarea:focus { border-color: var(--btn-primary-bg); }
    .markdown-body { flex: 1; padding: 15px; background: var(--input-bg); border-radius: 6px; border: 1px solid var(--border-color); overflow-y: auto; line-height: 1.6; }
    .upload-btn { background: var(--btn-primary-bg); padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; color: var(--text-color); transition: 0.2s; }
</style>