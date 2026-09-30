<script>
    import { onMount } from 'svelte';

    let activeTool = 'pen'; // 'pen', 'highlighter', 'eraser', 'pan'
    let strokeColor = '#3b82f6';
    let strokeSize = 5;

    let canvasRef;
    let currentPoints = [];
    let allStrokes = [];
    let canvasWidth = 800;
    let canvasHeight = 1000;
    let lastEventType = '';
    let logMessages = [];

    function log(msg) {
        logMessages = [msg, ...logMessages.slice(0, 15)];
    }

    onMount(() => {
        renderCanvas();
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

    function getPointerPos(e) {
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        const scaleX = canvasWidth / (rect.width || canvasWidth);
        const scaleY = canvasHeight / (rect.height || canvasHeight);
        const x = (clientX - rect.left) * scaleX;
        const y = (clientY - rect.top) * scaleY;
        const pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : 0.5;
        return [x, y, pressure];
    }

    function isPenOrStylus(e) {
        const pType = e.pointerType;
        const tType = e.touchType || (e.touches && e.touches[0] && e.touches[0].touchType);
        // On iPadOS WebKit, Apple Pencil pointerType can report 'pen' or 'touch' with stylus touchType or pressure > 0
        return pType === 'pen' || tType === 'stylus' || (e.pressure !== undefined && e.pressure > 0 && e.pointerType !== 'mouse');
    }

    function svgDown(e) {
        const isPen = isPenOrStylus(e);
        lastEventType = `Down: pType=${e.pointerType}, touchType=${e.touchType || (e.touches && e.touches[0] && e.touches[0].touchType)}, pressure=${e.pressure}`;
        log(lastEventType);

        if (activeTool === 'pan') return;
        // If it's a finger touch (and not pen/stylus), allow pan or skip drawing
        if (e.pointerType === 'touch' && !isPen) return;

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
        const isPen = isPenOrStylus(e);
        if (e.pointerType === 'touch' && !isPen && currentPoints.length === 0) return;

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
        log(`Up: stroke completed (${currentPoints.length} points)`);

        const newStroke = {
            id: 'stroke_' + Date.now(),
            points: currentPoints,
            color: strokeColor,
            size: activeTool === 'highlighter' ? strokeSize * 3 : strokeSize,
            isHighlighter: activeTool === 'highlighter'
        };

        allStrokes = [...allStrokes, newStroke];
        currentPoints = [];
    }

    function eraseStrokeAt(x, y) {
        const threshold = 15;
        allStrokes = allStrokes.filter(stroke => {
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
        Use this dedicated test page to verify Apple Pencil drawing, eraser, tool switching, and color selection without panzoom interference.
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
                class="svg-layer"
                style="width: {canvasWidth}px; height: {canvasHeight}px; touch-action: none; cursor: {activeTool === 'eraser' ? 'cell' : 'crosshair'};"
                on:pointerdown={svgDown}
                on:pointermove={svgMove}
                on:pointerup={svgUp}
                on:pointerleave={svgUp}
                on:pointercancel={svgUp}
            >
                {#each allStrokes as stroke}
                    <path
                        d={getSvgPathFromStroke(window.perfectFreehand ? window.perfectFreehand.getStroke(stroke.points, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }) : stroke.points)}
                        fill={stroke.color || '#3b82f6'}
                        opacity={stroke.isHighlighter ? 0.4 : 1.0}
                    />
                {/each}

                {#if currentPoints.length > 0}
                    <path
                        d={getSvgPathFromStroke(window.perfectFreehand ? window.perfectFreehand.getStroke(currentPoints, { size: activeTool === 'highlighter' ? strokeSize * 3 : strokeSize, thinning: 0.5, smoothing: 0.5 }) : currentPoints)}
                        fill={strokeColor}
                        opacity={activeTool === 'highlighter' ? 0.4 : 1.0}
                    />
                {/if}
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
    .test-container { display: flex; flex-direction: column; gap: 15px; width: 100%; color: var(--text-color); box-sizing: border-box; }
    .test-toolbar { display: flex; flex-wrap: wrap; gap: 15px; align-items: center; background: var(--sidebar-bg); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); touch-action: manipulation; }
    .tools-group, .color-group, .size-group { display: flex; gap: 8px; align-items: center; }
    .tool-btn { background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 8px 14px; border-radius: 6px; font-size: 0.9rem; cursor: pointer; transition: 0.15s; touch-action: manipulation; }
    .tool-btn.active { background: var(--btn-primary-bg); font-weight: bold; border-color: var(--btn-primary-bg); }
    .canvas-box { display: flex; justify-content: center; background: var(--input-bg); padding: 20px; border-radius: 8px; border: 1px solid var(--border-color); overflow: auto; }
    .canvas-wrapper { position: relative; width: 800px; height: 1000px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
    .base-canvas { display: block; border-radius: 4px; }
    .svg-layer { position: absolute; top: 0; left: 0; z-index: 10; touch-action: none; }
    .debug-log { background: var(--input-bg); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); font-family: monospace; font-size: 0.8rem; }
    .log-entries { margin-top: 5px; max-height: 100px; overflow-y: auto; color: #a5b4fc; }
</style>