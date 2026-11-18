<script>
    import { onMount, onDestroy, tick } from 'svelte';
    import { editingTask, isStudyMode, isHeaderCollapsed, tasks } from '../stores/appStore.js';
    import { getStroke } from 'perfect-freehand';
    import * as pdfjsLib from 'pdfjs-dist';

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // --- Study Mode Local State ---
    let activeTab = 'handwriting'; // 'handwriting' or 'markdown'
    let activeTool = 'pen'; // 'pen', 'highlighter', 'eraser', 'pan'
    let smartPan = true; // Default ON for iPad: Finger touch pans, Apple Pencil writes
    let strokeColor = '#3b82f6';
    let strokeSize = 5;
    let extraPageHeight = 0; // Extra blank space added below slide/canvas

    let pzInstance = null;
    let currentPoints = [];
    let allStrokes = []; // Stored persistently in $editingTask.handwriting_data

    // High-performance active drawing state (bypasses Svelte reactive re-renders at 240Hz)
    let svgRef;
    let activePathRef;
    let activePointerId = null;
    let cachedRect = null;
    let cachedScaleX = 1;
    let cachedScaleY = 1;
    let rafId = null;
    let eraserDirty = false;
    let saveTimeout = null;

    // PDF variables
    let pdfContainerRef;
    let canvasRef;
    let audioRef;
    let pdfDoc = null;
    let pageNum = 1;
    let isRendering = false;
    let pdfWidth = 800;
    let pdfHeight = 1000;

    // Media & Audio Settings / Diagnostics variables
    let isAudioSidebarCollapsed = false;
    let showAudioSettings = false;
    let audioRecordMode = 'combined'; // 'combined', 'speech-only', 'recorder-only'
    let mediaRecorder = null;
    let mediaStream = null;
    let audioChunks = [];
    let isRecording = false;
    let isSpeechRunning = false;
    let recognition = null;
    let interimTranscript = '';
    let speechStatusMsg = '';
    let recordedMime = '';
    let recordedSize = 0;
    let chunkCount = 0;
    let audioDiagLogs = [];
    let audioCapabilities = {
        speech: false,
        mediaRecorder: false,
        supportedMimes: []
    };
    let recordingStartTime = 0;
    let slideTimeline = [];
    let activePlaybackPage = 1;
    let currentAudioTime = 0;
    let activeStrokeId = null;
    let saveQueue = Promise.resolve();

    function addAudioLog(type, msg) {
        const ts = new Date().toLocaleTimeString();
        audioDiagLogs = [{ ts, type, msg }, ...audioDiagLogs.slice(0, 39)];
    }

    function detectAudioCapabilities() {
        audioCapabilities.speech = ('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window);
        audioCapabilities.mediaRecorder = 'MediaRecorder' in window;
        const mimeCandidates = [
            'audio/mp4',
            'audio/mp4;codecs=mp4a.40.2',
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus'
        ];
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
            audioCapabilities.supportedMimes = mimeCandidates.filter(m => MediaRecorder.isTypeSupported(m));
        }
        addAudioLog('INFO', `Capabilities: Speech=${audioCapabilities.speech}, Recorder=${audioCapabilities.mediaRecorder}, Mimes=[${audioCapabilities.supportedMimes.join(', ')}]`);
    }

    $: pageStrokes = allStrokes.filter(s => (s.page || 1) === pageNum);

    function computeStrokePath(points, size) {
        return getSvgPathFromStroke(getStroke(points, {
            size: size || 5,
            thinning: 0.5,
            smoothing: 0.5,
            streamline: 0.5,
            simulatePressure: false
        }));
    }

    function computeStrokeBBox(points, pad = 18) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < points.length; i++) {
            const x = points[i][0];
            const y = points[i][1];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    }

    function hydrateStrokes(rawStrokes) {
        return (rawStrokes || []).map(s => {
            const pts = s.points || [];
            return {
                ...s,
                cachedPath: s.cachedPath || computeStrokePath(pts, s.size || 5),
                bbox: s.bbox || computeStrokeBBox(pts, (s.size || 5) + 15)
            };
        });
    }

    function preventNativeTouchCancel(e) {
        // Prevent iPadOS Safari Scribble / system touch gesture takeover when drawing with Apple Pencil
        const isTouchStylus = e.touches && e.touches[0] && (e.touches[0].touchType === 'stylus' || e.touches[0].force > 0);
        if (isTouchStylus) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (!smartPan && activeTool !== 'pan') {
            if (e.cancelable) e.preventDefault();
        }
    }

    // Initialization logic for Study Mode
    onMount(async () => {
        if ($editingTask.slide_tracking) {
            try { slideTimeline = JSON.parse($editingTask.slide_tracking); } catch(e) { slideTimeline = []; }
        } else {
            slideTimeline = [];
        }

        if ($editingTask.handwriting_data) {
            try {
                allStrokes = hydrateStrokes(JSON.parse($editingTask.handwriting_data));
            } catch(e) { allStrokes = []; }
        } else {
            allStrokes = [];
        }

        if ($editingTask.pdf_url) {
            await tick();
            loadPdf($editingTask.pdf_url);
        } else {
            pdfWidth = 800;
            pdfHeight = 1000;
            await tick();
            renderBlankCanvas();
            initPanzoom();
        }

        if (svgRef) {
            svgRef.addEventListener('touchstart', preventNativeTouchCancel, { passive: false });
            svgRef.addEventListener('touchmove', preventNativeTouchCancel, { passive: false });
        }

        detectAudioCapabilities();
        initSpeechRecognition();
        renderPreview();
    });

    onDestroy(() => {
        if (rafId) cancelAnimationFrame(rafId);
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            flushSaveEdit();
        }
        if (svgRef) {
            svgRef.removeEventListener('touchstart', preventNativeTouchCancel);
            svgRef.removeEventListener('touchmove', preventNativeTouchCancel);
        }
        if (pzInstance && pzInstance.dispose) {
            pzInstance.dispose();
        }
    });

    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            speechStatusMsg = 'Browser speech recognition unavailable';
            addAudioLog('ERROR', 'SpeechRecognition API unavailable in this browser');
            return;
        }
        recognition = new SpeechRecognition();
        recognition.lang = navigator.language || 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onstart = () => {
            isSpeechRunning = true;
            addAudioLog('SPEECH', 'SpeechRecognition started (onstart)');
        };
        recognition.onaudiostart = () => addAudioLog('SPEECH', 'Microphone capture active (onaudiostart)');
        recognition.onspeechstart = () => addAudioLog('SPEECH', 'Speech detected (onspeechstart)');

        recognition.onresult = (event) => {
            let interim = '';
            let addedFinal = false;
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcriptPiece = event.results[i][0].transcript;
                const conf = (event.results[i][0].confidence * 100).toFixed(0);
                if (event.results[i].isFinal) {
                    $editingTask.transcription = ($editingTask.transcription || '') + transcriptPiece.trim() + ' ';
                    addedFinal = true;
                    addAudioLog('RESULT', `Final [${conf}%]: "${transcriptPiece.trim()}"`);
                } else {
                    interim += transcriptPiece;
                }
            }
            interimTranscript = interim;
            if (addedFinal) saveEdit();
        };

        recognition.onerror = (event) => {
            console.warn("SpeechRecognition warning/error:", event.error);
            addAudioLog('ERROR', `Speech error: ${event.error}`);
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                speechStatusMsg = 'Speech blocked (check Siri/Dictation or try Speech-Only mode)';
            } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
                speechStatusMsg = `Speech note: ${event.error}`;
            }
        };

        recognition.onend = () => {
            isSpeechRunning = false;
            interimTranscript = '';
            addAudioLog('SPEECH', 'SpeechRecognition ended (onend)');
            // Auto-restart on iPadOS/Safari where continuous recognition stops after each pause
            if (isRecording && (audioRecordMode === 'combined' || audioRecordMode === 'speech-only')) {
                setTimeout(() => {
                    if (isRecording && recognition) {
                        try {
                            recognition.start();
                            addAudioLog('INFO', 'Auto-restarted SpeechRecognition');
                        } catch (e) {
                            addAudioLog('ERROR', `Auto-restart failed: ${e.message}`);
                        }
                    }
                }, 250);
            }
        };
    }

    async function closeEdit() {
        if (isRecording) stopRecording();
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            await flushSaveEdit();
        }
        isStudyMode.set(false);
        isHeaderCollapsed.set(false);
        editingTask.set(null);
    }

    /**
     * Debounced persistence so rapid Apple Pencil strokes don't spam HTTP PUTs or trigger store reloads mid-word.
     */
    function saveEdit(immediate = false) {
        if (saveTimeout) clearTimeout(saveTimeout);
        if (immediate) {
            return flushSaveEdit();
        }
        saveTimeout = setTimeout(() => {
            flushSaveEdit();
        }, 650);
    }

    async function flushSaveEdit() {
        saveTimeout = null;
        if (!$editingTask) return;
        const taskSnapshot = $editingTask;
        // Strip runtime-only cachedPath/bbox before saving to DB to keep payload small
        const serializableStrokes = allStrokes.map(({ cachedPath, bbox, ...rest }) => rest);
        taskSnapshot.handwriting_data = JSON.stringify(serializableStrokes);

        // Update local tasks store in-place without triggering a full GET /api/tasks roundtrip
        tasks.update(list => list.map(t => t.id === taskSnapshot.id ? { ...t, ...taskSnapshot } : t));

        saveQueue = saveQueue.catch(() => {}).then(async () => {
            await fetch(`/api/tasks/${taskSnapshot.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...taskSnapshot,
                    dueDate: taskSnapshot.due_date,
                    predecessors: taskSnapshot.predecessors,
                    assignees: taskSnapshot.assignees,
                    reminderTime: taskSnapshot.reminder_time,
                    reminderFrequency: taskSnapshot.reminder_frequency
                })
            });
        });
        return saveQueue;
    }

    // --- INFINITE CANVAS & HANDWRITING LOGIC ---
    function isStylusOrPen(e) {
        const pType = e.pointerType;
        const tType = e.touchType || (e.touches && e.touches[0] && e.touches[0].touchType);
        return pType === 'pen' || tType === 'stylus' || (e.pressure !== undefined && e.pressure > 0 && pType !== 'mouse' && pType !== 'touch');
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
                if (activeTool === 'pan') return false;
                if (e.pointerType === 'touch') return false; // Finger touch pans
                return true; // Mouse draws
            },
            onTouch: function(e) {
                const isTouchStylus = e.touches && e.touches[0] && e.touches[0].touchType === 'stylus';
                if (isTouchStylus) return false; // Do not let panzoom capture Apple Pencil touch events
                if (!smartPan && activeTool !== 'pan') return false;
                return true;
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
        saveEdit(true);
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

    function cacheCoordinateSystem(svgEl) {
        cachedRect = svgEl.getBoundingClientRect();
        const totalHeight = pdfHeight + extraPageHeight;
        cachedScaleX = pdfWidth / (cachedRect.width || pdfWidth);
        cachedScaleY = totalHeight / (cachedRect.height || totalHeight);
    }

    function getPointerPosFromCached(e) {
        if (!cachedRect && svgRef) cacheCoordinateSystem(svgRef);
        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        const x = (clientX - cachedRect.left) * cachedScaleX;
        const y = (clientY - cachedRect.top) * cachedScaleY;
        const pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : 0.5;
        return [x, y, pressure];
    }

    function scheduleActiveStrokeRender() {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            if (!activePathRef) return;
            if (currentPoints.length === 0) {
                activePathRef.setAttribute('d', '');
                return;
            }
            const activeSize = activeTool === 'highlighter' ? strokeSize * 3 : strokeSize;
            const d = computeStrokePath(currentPoints, activeSize);
            activePathRef.setAttribute('d', d);
        });
    }

    function svgDown(e) {
        const isPen = isStylusOrPen(e);
        if (activeTool === 'pan' && !smartPan) return;
        if (activeTool === 'pan' && !isPen) return;
        // Finger touch always pans/zooms when Smart Touch Pan is enabled
        if (smartPan && e.pointerType === 'touch' && !isPen) return;

        // Temporarily pause panzoom while pen is actively down so no stray gesture interferes
        if (pzInstance && isPen) {
            pzInstance.pause();
        }

        if (e.cancelable) e.preventDefault();
        e.stopPropagation();

        activePointerId = e.pointerId;
        cacheCoordinateSystem(e.currentTarget);

        try {
            if (e.pointerId !== undefined && e.currentTarget.setPointerCapture) {
                e.currentTarget.setPointerCapture(e.pointerId);
            }
        } catch(err) {}

        const pt = getPointerPosFromCached(e);

        if (activeTool === 'eraser') {
            eraserDirty = false;
            eraseStrokeAt(pt[0], pt[1]);
            return;
        }

        currentPoints = [pt];
        if (activePathRef) {
            activePathRef.setAttribute('fill', strokeColor);
            activePathRef.setAttribute('opacity', activeTool === 'highlighter' ? '0.4' : '1.0');
        }
        scheduleActiveStrokeRender();
    }

    function svgMove(e) {
        if (activePointerId !== null && e.pointerId !== activePointerId) return;

        const isPen = isStylusOrPen(e);
        if (smartPan && e.pointerType === 'touch' && !isPen && currentPoints.length === 0) return;

        if (activeTool === 'eraser') {
            if (e.buttons === 1 || isPen || activePointerId === e.pointerId) {
                const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
                const sampleEvents = events.length > 0 ? events : [e];
                for (let i = 0; i < sampleEvents.length; i++) {
                    const pt = getPointerPosFromCached(sampleEvents[i]);
                    eraseStrokeAt(pt[0], pt[1]);
                }
            }
            return;
        }

        if (currentPoints.length === 0) return;
        if (e.cancelable) e.preventDefault();

        // Capture all coalesced Apple Pencil samples (up to 240Hz on iPad Pro) without dropping curves
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        const sampleEvents = events.length > 0 ? events : [e];
        for (let i = 0; i < sampleEvents.length; i++) {
            currentPoints.push(getPointerPosFromCached(sampleEvents[i]));
        }

        scheduleActiveStrokeRender();
    }

    function svgUp(e) {
        if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;

        try {
            if (e.pointerId !== undefined && e.currentTarget && e.currentTarget.releasePointerCapture) {
                if (e.currentTarget.hasPointerCapture && e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }
            }
        } catch (err) {}

        activePointerId = null;
        cachedRect = null;
        updatePanzoomState();

        if (activeTool === 'eraser') {
            if (eraserDirty) {
                eraserDirty = false;
                saveEdit();
            }
            return;
        }

        if (currentPoints.length === 0) return;

        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (activePathRef) {
            activePathRef.setAttribute('d', '');
        }

        const ts = getAudioTimestamp();
        const strokeActualSize = activeTool === 'highlighter' ? strokeSize * 3 : strokeSize;
        const pointsCopy = currentPoints;
        currentPoints = [];

        const newStroke = {
            id: 'stroke_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            page: pageNum,
            timestamp: ts,
            points: pointsCopy,
            color: strokeColor,
            size: strokeActualSize,
            isHighlighter: activeTool === 'highlighter',
            cachedPath: computeStrokePath(pointsCopy, strokeActualSize),
            bbox: computeStrokeBBox(pointsCopy, strokeActualSize + 15)
        };

        allStrokes = [...allStrokes, newStroke];
        saveEdit();
    }

    function eraseStrokeAt(x, y) {
        const threshold = 16;
        let removed = false;
        const nextStrokes = allStrokes.filter(stroke => {
            if ((stroke.page || 1) !== pageNum) return true;
            // Fast bounding-box rejection before checking point distances
            if (stroke.bbox) {
                if (x < stroke.bbox.minX || x > stroke.bbox.maxX || y < stroke.bbox.minY || y > stroke.bbox.maxY) {
                    return true;
                }
            }
            const pts = stroke.points;
            for (let i = 0; i < pts.length; i++) {
                const dist = Math.hypot(pts[i][0] - x, pts[i][1] - y);
                if (dist < threshold) {
                    removed = true;
                    return false;
                }
            }
            return true;
        });

        if (removed) {
            allStrokes = nextStrokes;
            eraserDirty = true;
        }
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

        let paths = targetStrokes.reduce((acc, stroke) => {
            const pts = stroke.points;
            const len = pts.length;
            const offsetPoints = new Array(len);
            for (let i = 0; i < len; i++) {
                offsetPoints[i] = [pts[i][0] - minX, pts[i][1] - minY, pts[i][2]];
            }
            let d = computeStrokePath(offsetPoints, stroke.size || 5);
            const opacity = stroke.isHighlighter ? 0.4 : 1.0;
            return acc + `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
        }, "");

        return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">\n${paths}\n</svg>`;
    }

    function insertPdfSvgToNotes() {
        if (pageStrokes.length === 0) return;
        const ts = getAudioTimestamp();
        let svgStr = generateSvgStringFromStrokes(pageStrokes);
        const timeBadge = `\n\n> ⏱️ **Audio Timestamp [${formatTime(ts)}] - Slide ${pageNum}**\n\n` + svgStr + "\n\n";
        $editingTask.description = ($editingTask.description || '') + timeBadge;
        saveEdit(true);
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

    function getSupportedAudioMime() {
        if (typeof MediaRecorder === 'undefined') return { mimeType: '', ext: 'webm' };
        const candidates = [
            { mimeType: 'audio/mp4', ext: 'm4a' },
            { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
            { mimeType: 'audio/webm', ext: 'webm' },
            { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' }
        ];
        if (MediaRecorder.isTypeSupported) {
            for (const c of candidates) {
                if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
            }
        }
        return { mimeType: '', ext: 'm4a' };
    }

    async function uploadFileToDrive(file, type, ext = 'webm') {
        const formData = new FormData();
        formData.append('file', file, file.name || `recording_${Date.now()}.${ext}`);

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
                saveEdit(true);
            }
        } catch (e) { console.error("Drive upload failed", e); }
    }

    function handlePdfUpload(e) {
        const file = e.target.files[0];
        if (file) uploadFileToDrive(file, 'pdf');
    }

    async function startRecording() {
        speechStatusMsg = '';
        interimTranscript = '';
        isRecording = true;
        recordingStartTime = Date.now();
        slideTimeline = [{ time: 0, page: pageNum }];
        addAudioLog('INFO', `Starting recording (mode: ${audioRecordMode})`);

        // 1. Start SpeechRecognition FIRST directly inside the user click gesture (required by iPadOS WebKit)
        if (audioRecordMode === 'combined' || audioRecordMode === 'speech-only') {
            if (!recognition) initSpeechRecognition();
            if (recognition) {
                try {
                    if (!$editingTask.transcription) $editingTask.transcription = '';
                    $editingTask.transcription += '\n--- Recording Started ---\n';
                    recognition.start();
                    speechStatusMsg = 'Listening for speech...';
                    addAudioLog('SPEECH', 'Called recognition.start() synchronously in tap handler');
                } catch (recErr) {
                    console.warn("SpeechRecognition start warning:", recErr);
                    addAudioLog('ERROR', `recognition.start() threw: ${recErr.message}`);
                }
            }
        }

        // 2. Request microphone stream and start MediaRecorder with iPadOS-compatible MIME type
        if (audioRecordMode === 'combined' || audioRecordMode === 'recorder-only') {
            try {
                addAudioLog('RECORDER', 'Requesting getUserMedia({ audio: true })...');
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const { mimeType, ext } = getSupportedAudioMime();
                mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
                recordedMime = mediaRecorder.mimeType || mimeType || 'default';
                audioChunks = [];
                chunkCount = 0;
                recordedSize = 0;

                mediaRecorder.ondataavailable = e => {
                    if (e.data && e.data.size > 0) {
                        audioChunks.push(e.data);
                        chunkCount = audioChunks.length;
                        recordedSize += e.data.size;
                    }
                };
                mediaRecorder.onerror = e => {
                    addAudioLog('ERROR', `MediaRecorder error: ${e.error?.message || e.type}`);
                };
                mediaRecorder.onstop = async () => {
                    const actualType = (mediaRecorder && mediaRecorder.mimeType) || mimeType || 'audio/mp4';
                    const audioBlob = new Blob(audioChunks, { type: actualType });
                    addAudioLog('RECORDER', `Stopped. Saving Blob (${audioBlob.size} bytes, ${actualType})`);
                    uploadFileToDrive(audioBlob, 'audio', ext);
                    if (mediaStream) {
                        mediaStream.getTracks().forEach(t => t.stop());
                        mediaStream = null;
                    }
                };

                mediaRecorder.start(1000);
                addAudioLog('RECORDER', `MediaRecorder started (MIME: ${recordedMime})`);
            } catch (err) {
                console.error("Microphone access denied or failed", err);
                speechStatusMsg = `Mic error: ${err.message || err.name}`;
                addAudioLog('ERROR', `getUserMedia failed: ${err.name} - ${err.message}`);
                if (audioRecordMode === 'recorder-only') {
                    isRecording = false;
                }
                alert("Could not start audio recorder. Please check microphone permissions.");
            }
        }
    }

    function stopRecording() {
        addAudioLog('INFO', 'Stopping recording...');
        isRecording = false;
        interimTranscript = '';
        speechStatusMsg = '';
        if (recognition) {
            try { recognition.stop(); } catch (e) {}
        }
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.stop(); } catch (e) {}
        } else if (mediaStream) {
            mediaStream.getTracks().forEach(t => t.stop());
            mediaStream = null;
        }
        $editingTask.slide_tracking = JSON.stringify(slideTimeline);
        saveEdit(true);
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
    <div class="study-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px; flex:1;">
            <button
                class="btn secondary small-btn"
                style="padding: 6px 10px; font-size: 0.8rem; white-space: nowrap;"
                on:click={() => isAudioSidebarCollapsed = !isAudioSidebarCollapsed}
                title={isAudioSidebarCollapsed ? 'Show Audio & Transcript Panel' : 'Hide Audio Panel to maximize Notes'}
            >
                {isAudioSidebarCollapsed ? '▶ 🎙️ Show Audio' : '◀ Hide Audio'}
            </button>
            {#if isAudioSidebarCollapsed}
                {#if !isRecording}
                    <button class="btn action-btn record-btn" style="padding: 6px 12px; font-size: 0.8rem;" on:click={startRecording}>🔴 Record</button>
                {:else}
                    <button class="btn action-btn stop-btn" style="padding: 6px 12px; font-size: 0.8rem;" on:click={stopRecording}>⏹ Stop</button>
                {/if}
                {#if interimTranscript}
                    <span style="font-size:0.78rem; color:#60a5fa; font-style:italic; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🎤 {interimTranscript}</span>
                {/if}
            {/if}
            <input class="ws-title-input" type="text" bind:value={$editingTask.title} placeholder="Document Title" style="background:transparent; border:none; border-bottom:1px solid var(--border-color); color: var(--text-color); font-size:1.3rem; font-weight:bold; flex:1; padding:6px 0;" on:input={() => saveEdit()} />
        </div>
        <button class="btn secondary" on:click={closeEdit}>Exit Study Mode</button>
    </div>

    <div class="study-layout-container {$isHeaderCollapsed ? 'maximized' : ''}">
        <!-- LEFT SIDEBAR: Collapsible Audio, Settings/Diagnostics, Transcripts & Handwritten Timeline -->
        {#if !isAudioSidebarCollapsed}
        <div class="study-sidebar">
            <div class="pane-header" style="display:flex; justify-content:space-between; align-items:center;">
                <span>Audio & Transcript</span>
                <button
                    class="collapse-icon-btn"
                    on:click={() => isAudioSidebarCollapsed = true}
                    title="Collapse Audio Sidebar to maximize Notes"
                >
                    ◀ Collapse
                </button>
            </div>

            <div class="audio-controls" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                {#if !isRecording}
                    <button class="btn action-btn record-btn" style="flex:1;" on:click={startRecording}>🔴 Record</button>
                {:else}
                    <button class="btn action-btn stop-btn" style="flex:1;" on:click={stopRecording}>⏹ Stop (Saves)</button>
                {/if}
                <button
                    class="btn secondary small-btn {showAudioSettings ? 'active-settings-btn' : ''}"
                    style="padding: 6px 10px; font-size: 0.78rem;"
                    on:click={() => showAudioSettings = !showAudioSettings}
                    title="Toggle Audio Settings & Diagnostics"
                >
                    ⚙️ {showAudioSettings ? 'Hide' : 'Settings'}
                </button>
            </div>

            <!-- COLLAPSIBLE AUDIO SETTINGS & DIAGNOSTICS MENU -->
            {#if showAudioSettings}
                <div class="audio-settings-menu">
                    <div class="settings-row">
                        <label for="audio-mode-select" style="font-size:0.72rem; color:#94a3b8; font-weight:bold;">Recording Mode:</label>
                        <select id="audio-mode-select" bind:value={audioRecordMode} disabled={isRecording} class="audio-mode-select">
                            <option value="combined">Combined (Speech + Audio File)</option>
                            <option value="speech-only">Speech Transcription Only</option>
                            <option value="recorder-only">Audio File Only (No Speech)</option>
                        </select>
                    </div>

                    <div class="diag-mini-grid">
                        <div class="diag-pill">
                            <span>Speech API:</span>
                            <strong class={audioCapabilities.speech ? 'ok' : 'err'}>{audioCapabilities.speech ? (isSpeechRunning ? '🟢 Active' : 'Ready') : 'No'}</strong>
                        </div>
                        <div class="diag-pill">
                            <span>MIME:</span>
                            <strong class="ok">{recordedMime || audioCapabilities.supportedMimes[0] || 'auto'}</strong>
                        </div>
                        <div class="diag-pill">
                            <span>Audio Chunks:</span>
                            <strong>{chunkCount} ({(recordedSize / 1024).toFixed(1)} KB)</strong>
                        </div>
                    </div>

                    <div class="diag-log-header">
                        <span>🛠️ Live Audio Event Log</span>
                        <button class="clear-log-btn" on:click={() => audioDiagLogs = []}>Clear</button>
                    </div>
                    <div class="diag-log-list">
                        {#if audioDiagLogs.length === 0}
                            <div style="color:#64748b;">Tap Record to see live speech/mic events...</div>
                        {:else}
                            {#each audioDiagLogs as item}
                                <div class="diag-log-row {item.type.toLowerCase()}">
                                    <span class="diag-ts">[{item.ts}]</span>
                                    <span class="diag-tag">{item.type}</span>
                                    <span>{item.msg}</span>
                                </div>
                            {/each}
                        {/if}
                    </div>
                </div>
            {/if}

            {#if $editingTask.audio_url}
                <div style="margin-bottom: 12px;">
                    <audio bind:this={audioRef} controls class="audio-player" src={$editingTask.audio_url} on:timeupdate={handleAudioTimeUpdate}></audio>
                </div>
            {/if}

            <div class="transcript-box" id="transcript-scroll-box" style="margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <p class="section-label" style="font-size:0.75rem; margin:0;">Live Transcription</p>
                    {#if speechStatusMsg}
                        <span style="font-size:0.68rem; color:#34d399;">{speechStatusMsg}</span>
                    {/if}
                </div>
                <textarea class="transcription-box" bind:value={$editingTask.transcription} on:input={() => saveEdit()} placeholder="Your live speech will appear here..."></textarea>
                {#if interimTranscript}
                    <div style="font-size:0.75rem; color:#60a5fa; padding:4px 6px; font-style:italic;">🎤 {interimTranscript}</div>
                {/if}
            </div>

            <div class="timeline-box" style="flex:1; display:flex; flex-direction:column; min-height:0; border-top: 1px solid var(--border-color); padding-top: 10px;">
                <p class="section-label" style="font-size:0.75rem; margin-bottom:6px;">Timestamped Notes & Strokes</p>
                <div id="timeline-scroll-box" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
                    {#if allStrokes.length === 0}
                        <p style="font-size:0.75rem; color:#64748b;">No handwritten strokes recorded yet. Write on the canvas with Apple Pencil or pen!</p>
                    {:else}
                        {#each allStrokes as stroke (stroke.id)}
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
        {/if}

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
                                <button class="btn secondary small-btn" style="padding:4px 8px; font-size:0.8rem;" on:click={addBlankSpace}>➕ Extend Page</button>
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
                                bind:this={svgRef}
                                class="drawing-layer svg-layer"
                                style="width: {pdfWidth}px; height: {pdfHeight + extraPageHeight}px; pointer-events: {(!smartPan && activeTool === 'pan') ? 'none' : 'auto'}; cursor: {activeTool === 'eraser' ? 'cell' : 'crosshair'}; touch-action: {activeTool === 'pan' ? 'auto' : 'none'};"
                                on:pointerdown={svgDown}
                                on:pointermove={svgMove}
                                on:pointerup={svgUp}
                                on:pointercancel={svgUp}
                            >
                                {#each pageStrokes as stroke (stroke.id)}
                                    <path
                                        d={stroke.cachedPath || computeStrokePath(stroke.points, stroke.size || 5)}
                                        fill={stroke.color || '#3b82f6'}
                                        opacity={stroke.isHighlighter ? 0.4 : 1.0}
                                    />
                                {/each}

                                <!-- Active in-progress stroke updated via requestAnimationFrame without full Svelte re-renders -->
                                <path
                                    bind:this={activePathRef}
                                    d=""
                                    fill={strokeColor}
                                    opacity={activeTool === 'highlighter' ? 0.4 : 1.0}
                                />
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
    .study-layout-container { display: flex; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; gap: 20px; width: 100%; flex: 1; transition: flex 0.3s ease; min-height: 0; }

    .study-sidebar { width: 310px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--sidebar-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; box-sizing: border-box; overflow: hidden; }
    .pane-header { font-size: 0.8rem; font-weight: bold; color: #666; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 6px; border-bottom: 1px solid var(--border-color); margin-bottom: 12px; }
    .collapse-icon-btn { background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 8px; font-size: 0.7rem; cursor: pointer; text-transform: none; letter-spacing: 0; }
    .collapse-icon-btn:hover { background: var(--border-color); }
    .active-settings-btn { border-color: var(--btn-primary-bg) !important; color: #60a5fa !important; }

    .audio-settings-menu { background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; }
    .settings-row { display: flex; flex-direction: column; gap: 4px; }
    .audio-mode-select { background: var(--sidebar-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 6px 8px; border-radius: 4px; font-size: 0.76rem; width: 100%; }
    .diag-mini-grid { display: flex; flex-wrap: wrap; gap: 6px; }
    .diag-pill { background: var(--sidebar-bg); border: 1px solid var(--border-color); border-radius: 4px; padding: 3px 6px; font-size: 0.68rem; display: flex; gap: 4px; align-items: center; }
    .diag-pill .ok { color: #34d399; }
    .diag-pill .err { color: #f87171; }
    .diag-log-header { display: flex; justify-content: space-between; align-items: center; font-size: 0.7rem; font-weight: bold; color: #94a3b8; padding-top: 4px; border-top: 1px solid var(--border-color); }
    .clear-log-btn { background: none; border: none; color: #60a5fa; font-size: 0.68rem; cursor: pointer; padding: 0; }
    .diag-log-list { max-height: 110px; overflow-y: auto; font-family: monospace; font-size: 0.68rem; display: flex; flex-direction: column; gap: 3px; background: var(--sidebar-bg); padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); }
    .diag-log-row { display: flex; gap: 5px; line-height: 1.3; word-break: break-word; }
    .diag-ts { color: #64748b; flex-shrink: 0; }
    .diag-tag { font-weight: bold; flex-shrink: 0; }
    .diag-log-row.error { color: #f87171; }
    .diag-log-row.result { color: #34d399; }
    .diag-log-row.speech { color: #60a5fa; }
    .diag-log-row.recorder { color: #fbbf24; }

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

    .canvas-container { flex: 1; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; overflow: hidden; display: flex; justify-content: center; align-items: center; padding: 15px; background: var(--input-bg); cursor: grab;}
    .canvas-container:active { cursor: grabbing; }
    .pdf-base-layer { display: block; background: #ffffff; box-shadow: 0 4px 20px rgba(0,0,0,0.5); border-radius: 4px; max-width: 100%; object-fit: contain; }

    .drawing-layer { position: absolute; top: 0; left: 0; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; z-index: 10; }
    .svg-layer { z-index: 11; }

    .notes-block { flex: 1; display: flex; flex-direction: column; background: var(--sidebar-bg); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); min-height: 0; }
    .notes-block textarea { flex: 1; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 15px; border-radius: 6px; font-family: inherit; resize: none; line-height: 1.5; outline: none; }
    .notes-block textarea:focus { border-color: var(--btn-primary-bg); }
    .markdown-body { flex: 1; padding: 15px; background: var(--input-bg); border-radius: 6px; border: 1px solid var(--border-color); overflow-y: auto; line-height: 1.6; }
    .upload-btn { background: var(--btn-primary-bg); padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; color: var(--text-color); transition: 0.2s; }
</style>
