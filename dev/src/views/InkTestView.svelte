<script>
    import { onMount, onDestroy } from 'svelte';
    import { getStroke } from 'perfect-freehand';

    let activeTool = 'pen'; // 'pen', 'highlighter', 'eraser'
    let strokeColor = '#3b82f6';
    let strokeSize = 5;

    let canvasRef;
    let svgRef;
    let activePathRef;
    let currentPoints = [];
    let allStrokes = [];
    let canvasWidth = 800;
    let canvasHeight = 1000;
    let lastEventType = '';
    let logMessages = [];

    let activePointerId = null;
    let cachedRect = null;
    let cachedScaleX = 1;
    let cachedScaleY = 1;
    let rafId = null;

    function log(msg) {
        logMessages = [msg, ...logMessages.slice(0, 15)];
    }

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

    function preventNativeTouchCancel(e) {
        if (e.cancelable) e.preventDefault();
    }

    onMount(() => {
        renderCanvas();
        if (svgRef) {
            svgRef.addEventListener('touchstart', preventNativeTouchCancel, { passive: false });
            svgRef.addEventListener('touchmove', preventNativeTouchCancel, { passive: false });
        }
    });

    onDestroy(() => {
        if (rafId) cancelAnimationFrame(rafId);
        if (svgRef) {
            svgRef.removeEventListener('touchstart', preventNativeTouchCancel);
            svgRef.removeEventListener('touchmove', preventNativeTouchCancel);
        }
    });

    function renderCanvas() {
        if (!canvasRef) return;
        canvasRef.width = canvasWidth;
        canvasRef.height = canvasHeight;
        const ctx = canvasRef.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Guidelines
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        for (let y = 40; y < canvasHeight; y += 30) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvasWidth, y);
            ctx.stroke();
        }
    }

    function cacheCoordinateSystem(svgEl) {
        cachedRect = svgEl.getBoundingClientRect();
        cachedScaleX = canvasWidth / (cachedRect.width || canvasWidth);
        cachedScaleY = canvasHeight / (cachedRect.height || canvasHeight);
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

    function isPenOrStylus(e) {
        const pType = e.pointerType;
        const tType = e.touchType || (e.touches && e.touches[0] && e.touches[0].touchType);
        return pType === 'pen' || tType === 'stylus' || (e.pressure !== undefined && e.pressure > 0 && pType !== 'mouse' && pType !== 'touch');
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
        const isPen = isPenOrStylus(e);
        lastEventType = `Down: pType=${e.pointerType}, touchType=${e.touchType || (e.touches && e.touches[0] && e.touches[0].touchType)}, pressure=${e.pressure?.toFixed?.(2) ?? e.pressure}`;
        log(lastEventType);

        if (activeTool === 'pan') return;
        if (e.pointerType === 'touch' && !isPen) return;

        if (e.cancelable) e.preventDefault();
        activePointerId = e.pointerId;
        cacheCoordinateSystem(e.currentTarget);

        try {
            if (e.pointerId !== undefined && e.currentTarget.setPointerCapture) {
                e.currentTarget.setPointerCapture(e.pointerId);
            }
        } catch(err) {}

        const pt = getPointerPosFromCached(e);

        if (activeTool === 'eraser') {
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

        const isPen = isPenOrStylus(e);
        if (e.pointerType === 'touch' && !isPen && currentPoints.length === 0) return;

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

        if (currentPoints.length === 0) return;

        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (activePathRef) {
            activePathRef.setAttribute('d', '');
        }

        log(`Up: stroke completed (${currentPoints.length} points)`);

        const strokeActualSize = activeTool === 'highlighter' ? strokeSize * 3 : strokeSize;
        const pointsCopy = currentPoints;
        currentPoints = [];

        const newStroke = {
            id: 'stroke_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            points: pointsCopy,
            color: strokeColor,
            size: strokeActualSize,
            isHighlighter: activeTool === 'highlighter',
            cachedPath: computeStrokePath(pointsCopy, strokeActualSize),
            bbox: computeStrokeBBox(pointsCopy, strokeActualSize + 15)
        };

        allStrokes = [...allStrokes, newStroke];
    }

    function eraseStrokeAt(x, y) {
        const threshold = 16;
        allStrokes = allStrokes.filter(stroke => {
            if (stroke.bbox) {
                if (x < stroke.bbox.minX || x > stroke.bbox.maxX || y < stroke.bbox.minY || y > stroke.bbox.maxY) {
                    return true;
                }
            }
            for (let pt of stroke.points) {
                const dist = Math.hypot(pt[0] - x, pt[1] - y);
                if (dist < threshold) return false;
            }
            return true;
        });
    }

    function getSvgPathFromStroke(stroke) {
        if (!stroke || !stroke.length) return '';
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

    function clearCanvas() {
        allStrokes = [];
        log("Canvas cleared");
    }
</script>

<div class="test-container">
    <h2>✍️ iPadOS & Apple Pencil Standalone Ink Test</h2>
    <p style="font-size: 0.85rem; color: #94a3b8;">
        Use this dedicated test page to verify 240Hz coalesced Apple Pencil drawing, zero-lag RAF rendering, eraser, tool switching, and color selection.
    </p>

    <!-- Toolbar -->
    <div class="test-toolbar">
        <div class="tools-group">
            <button class="tool-btn {activeTool === 'pen' ? 'active' : ''}" on:click={() => { activeTool = 'pen'; log("Tool: Pen"); }}>🖊️ Pen</button>
            <button class="tool-btn {activeTool === 'highlighter' ? 'active' : ''}" on:click={() => { activeTool = 'highlighter'; log("Tool: Highlighter"); }}>🖍️ Highlight</button>
            <button class="tool-btn {activeTool === 'eraser' ? 'active' : ''}" on:click={() => { activeTool = 'eraser'; log("Tool: Eraser"); }}>🧹 Eraser</button>
        </div>

        {#if activeTool !== 'eraser'}
            <div class="color-group">
                <span>Color:</span>
                {#each ['#3b82f6', '#ef4444', '#10b981', '#eab308', '#ffffff', '#000000'] as color}
                    <button
                        style="width:24px; height:24px; border-radius:50%; background:{color}; border: {strokeColor === color ? '2px solid white' : '1px solid #64748b'}; cursor:pointer; touch-action: manipulation;"
                        aria-label={`Color ${color}`}
                        on:click={() => { strokeColor = color; log(`Color set to ${color}`); }}
                    ></button>
                {/each}
            </div>

            <div class="size-group">
                <span>Size:</span>
                <input type="range" min="2" max="20" bind:value={strokeSize} style="width:90px;" />
            </div>
        {/if}

        <button class="btn secondary" style="margin-left: auto;" on:click={clearCanvas}>🗑️ Clear Ink</button>
    </div>

    <!-- Main Canvas Area -->
    <div class="canvas-box">
        <div class="canvas-wrapper">
            <canvas bind:this={canvasRef} class="base-canvas"></canvas>

            <svg
                bind:this={svgRef}
                class="svg-layer"
                style="width: {canvasWidth}px; height: {canvasHeight}px; touch-action: none; cursor: {activeTool === 'eraser' ? 'cell' : 'crosshair'};"
                on:pointerdown={svgDown}
                on:pointermove={svgMove}
                on:pointerup={svgUp}
                on:pointercancel={svgUp}
            >
                {#each allStrokes as stroke (stroke.id)}
                    <path
                        d={stroke.cachedPath || computeStrokePath(stroke.points, stroke.size || 5)}
                        fill={stroke.color || '#3b82f6'}
                        opacity={stroke.isHighlighter ? 0.4 : 1.0}
                    />
                {/each}

                <path
                    bind:this={activePathRef}
                    d=""
                    fill={strokeColor}
                    opacity={activeTool === 'highlighter' ? 0.4 : 1.0}
                />
            </svg>
        </div>
    </div>

    <!-- Debug Log -->
    <div class="debug-log">
        <strong>Event Log:</strong> {lastEventType}
        <div class="log-entries">
            {#each logMessages as msg}
                <div>{msg}</div>
            {/each}
        </div>
    </div>
</div>

<style>
    .test-container { display: flex; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; flex-direction: column; gap: 15px; width: 100%; color: var(--text-color); box-sizing: border-box; }
    .test-toolbar { display: flex; flex-wrap: wrap; gap: 15px; align-items: center; background: var(--sidebar-bg); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); touch-action: manipulation; }
    .tools-group, .color-group, .size-group { display: flex; gap: 8px; align-items: center; }
    .tool-btn { background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 8px 14px; border-radius: 6px; font-size: 0.9rem; cursor: pointer; transition: 0.15s; touch-action: manipulation; }
    .tool-btn.active { background: var(--btn-primary-bg); font-weight: bold; border-color: var(--btn-primary-bg); }
    .canvas-box { display: flex; justify-content: center; background: var(--input-bg); padding: 20px; border-radius: 8px; border: 1px solid var(--border-color); overflow: auto; }
    .canvas-wrapper { position: relative; width: 800px; height: 1000px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
    .base-canvas { display: block; border-radius: 4px; }
    .svg-layer { position: absolute; top: 0; left: 0; z-index: 10; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    .debug-log { background: var(--input-bg); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); font-family: monospace; font-size: 0.8rem; }
    .log-entries { margin-top: 5px; max-height: 100px; overflow-y: auto; color: #a5b4fc; }
</style>
