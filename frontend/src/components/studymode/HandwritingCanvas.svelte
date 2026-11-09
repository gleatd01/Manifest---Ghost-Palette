<script>
    import { onMount } from 'svelte';
    import { getStroke } from 'perfect-freehand';

    export let canvasWidth = 800;
    export let canvasHeight = 1000;
    export let allStrokes = [];
    export let activeTool = 'pen';
    export let strokeColor = '#3b82f6';
    export let strokeSize = 5;
    export let activePageNum = 1;
    export let isPanEnabled = false;

    let canvasRef;
    let currentPoints = [];

    onMount(() => {
        renderCanvas();
    });

    // Reactive update on dimension change
    $: {
        if (canvasWidth || canvasHeight) {
            // We use setTimeout to ensure the DOM is updated before rendering
            setTimeout(renderCanvas, 0);
        }
    }

    function renderCanvas() {
        if (!canvasRef) return;
        canvasRef.width = canvasWidth;
        canvasRef.height = canvasHeight;
        const ctx = canvasRef.getContext('2d');
        // Clear instead of filling white to support PDF underneath
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
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
        return pType === 'pen' || tType === 'stylus' || (e.pressure !== undefined && e.pressure > 0 && e.pointerType !== 'mouse');
    }

    function svgDown(e) {
        const isPen = isPenOrStylus(e);
        if (isPanEnabled) return;

        // Finger touch and not pen, skip drawing if pan enabled or active tool is pan
        if (e.pointerType === 'touch' && !isPen && activeTool === 'pan') return;

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

        const newStroke = {
            id: 'stroke_' + Date.now(),
            points: currentPoints,
            color: strokeColor,
            size: activeTool === 'highlighter' ? strokeSize * 3 : strokeSize,
            isHighlighter: activeTool === 'highlighter',
            page: activePageNum,
            timestamp: 0 // Optional: integration with audio timing
        };

        allStrokes = [...allStrokes, newStroke];
        currentPoints = [];
    }

    function eraseStrokeAt(x, y) {
        const threshold = 15;
        allStrokes = allStrokes.filter(stroke => {
            if (stroke.page !== activePageNum) return true;
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

    $: pageStrokes = allStrokes.filter(s => (s.page || 1) === activePageNum);
</script>

<div class="canvas-wrapper">
    <canvas bind:this={canvasRef} class="base-canvas"></canvas>

    <svg
        class="svg-layer"
        style="width: {canvasWidth}px; height: {canvasHeight}px; pointer-events: {isPanEnabled ? 'none' : 'auto'}; cursor: {activeTool === 'eraser' ? 'cell' : 'crosshair'}; touch-action: {isPanEnabled ? 'auto' : 'none'};"
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

<style>
    .canvas-wrapper { position: relative; width: 100%; height: 100%; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    .base-canvas { display: block; width: 100%; height: 100%; }
    .svg-layer { position: absolute; top: 0; left: 0; z-index: 10; }
</style>
