<script>
    import { onMount, onDestroy, tick } from 'svelte';
    import { getStroke } from 'perfect-freehand';
    import { editingTask, tasks } from '../stores/appStore.js';

    // --- Document Blocks (Equation blocks, Text/Notes blocks, SVG Sketch blocks) ---
    let idCounter = 100;
    function uid(prefix = 'n') {
        idCounter += 1;
        return `${prefix}_${idCounter}`;
    }

    function createSlot(items = []) {
        return { id: uid('slot'), items };
    }

    function createSym(latex, display = null) {
        return { id: uid('sym'), type: 'sym', latex, display: display || latex };
    }

    function createFrac(numItems = [], denItems = []) {
        return {
            id: uid('frac'),
            type: 'frac',
            num: createSlot(numItems),
            den: createSlot(denItems)
        };
    }

    function createInt(lowerItems = [], upperItems = [], bodyItems = [], varItems = []) {
        return {
            id: uid('int'),
            type: 'int',
            lower: createSlot(lowerItems),
            upper: createSlot(upperItems),
            body: createSlot(bodyItems),
            dvar: createSlot(varItems)
        };
    }

    function createSup(baseItems = [], expItems = []) {
        return {
            id: uid('sup'),
            type: 'sup',
            base: createSlot(baseItems),
            exp: createSlot(expItems)
        };
    }

    function createSub(baseItems = [], subItems = []) {
        return {
            id: uid('sub'),
            type: 'sub',
            base: createSlot(baseItems),
            sub: createSlot(subItems)
        };
    }

    function createSqrt(bodyItems = []) {
        return {
            id: uid('sqrt'),
            type: 'sqrt',
            body: createSlot(bodyItems)
        };
    }

    // Initial demo document with an active equation ready to write in
    let initialRootSlot = createSlot([]);
    let docBlocks = [
        {
            id: uid('block_eq'),
            kind: 'equation',
            rootSlot: initialRootSlot
        }
    ];

    let activeBlockId = docBlocks[0].id;
    let activeSlotId = initialRootSlot.id;

    // --- Modes: 'math' (Auto-convert ink to LaTeX boxes) vs 'sketch' (Graph/Sketch SVG Override) ---
    let isSketchOverride = false;
    let strokeColor = '#3b82f6';
    let strokeSize = 4;

    // --- Live Ink Overlay State ---
    let workspaceRef;
    let svgRef;
    let activePathRef;
    let currentPoints = [];
    let pendingStrokes = []; // Multi-stroke buffer before recognition commit
    let commitTimer = null;
    let COMMIT_DELAY_MS = 650; // Wait 650ms after last stroke to recognize multi-stroke symbols (=, +, x, etc.)

    // Sketch Override strokes
    let sketchStrokes = [];

    // High-frequency pointer tracking
    let activePointerId = null;
    let cachedRect = null;
    let rafId = null;

    // Feedback / Recognition status
    let lastRecognizedLabel = 'Write directly on the LaTeX canvas with Apple Pencil!';
    let showLatexSource = false;
    let scribbleProxyInput = '';
    let scribbleInputRef;

    // --- Slot Tree Traversal & LaTeX Serialization ---
    function findSlotInSlot(slot, targetId) {
        if (!slot) return null;
        if (slot.id === targetId) return slot;
        for (const item of slot.items) {
            if (item.type === 'frac') {
                const f = findSlotInSlot(item.num, targetId) || findSlotInSlot(item.den, targetId);
                if (f) return f;
            } else if (item.type === 'int') {
                const f = findSlotInSlot(item.lower, targetId) || findSlotInSlot(item.upper, targetId) || findSlotInSlot(item.body, targetId) || findSlotInSlot(item.dvar, targetId);
                if (f) return f;
            } else if (item.type === 'sup') {
                const f = findSlotInSlot(item.base, targetId) || findSlotInSlot(item.exp, targetId);
                if (f) return f;
            } else if (item.type === 'sub') {
                const f = findSlotInSlot(item.base, targetId) || findSlotInSlot(item.sub, targetId);
                if (f) return f;
            } else if (item.type === 'sqrt') {
                const f = findSlotInSlot(item.body, targetId);
                if (f) return f;
            }
        }
        return null;
    }

    function getActiveSlot() {
        for (const b of docBlocks) {
            if (b.kind === 'equation') {
                const found = findSlotInSlot(b.rootSlot, activeSlotId);
                if (found) return { block: b, slot: found };
            }
        }
        // Fallback to last equation block's rootSlot
        const eqBlock = [...docBlocks].reverse().find(b => b.kind === 'equation');
        if (eqBlock) {
            activeBlockId = eqBlock.id;
            activeSlotId = eqBlock.rootSlot.id;
            return { block: eqBlock, slot: eqBlock.rootSlot };
        }
        return null;
    }

    function collectSlotOrder(slot, list = []) {
        if (!slot) return list;
        for (const item of slot.items) {
            if (item.type === 'frac') {
                collectSlotOrder(item.num, list);
                collectSlotOrder(item.den, list);
            } else if (item.type === 'int') {
                collectSlotOrder(item.lower, list);
                collectSlotOrder(item.upper, list);
                collectSlotOrder(item.body, list);
                collectSlotOrder(item.dvar, list);
            } else if (item.type === 'sup') {
                collectSlotOrder(item.base, list);
                collectSlotOrder(item.exp, list);
            } else if (item.type === 'sub') {
                collectSlotOrder(item.base, list);
                collectSlotOrder(item.sub, list);
            } else if (item.type === 'sqrt') {
                collectSlotOrder(item.body, list);
            }
        }
        list.push(slot);
        return list;
    }

    function jumpToNextSlot() {
        const current = getActiveSlot();
        if (!current) return;
        const order = collectSlotOrder(current.block.rootSlot, []);
        const idx = order.findIndex(s => s.id === activeSlotId);
        if (idx !== -1 && idx + 1 < order.length) {
            activeSlotId = order[idx + 1].id;
            docBlocks = [...docBlocks];
        } else {
            // At root slot: stay at root so next writing continues the equation
            activeSlotId = current.block.rootSlot.id;
            docBlocks = [...docBlocks];
        }
    }

    function selectSlot(blockId, slotId, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        activeBlockId = blockId;
        activeSlotId = slotId;
        docBlocks = [...docBlocks];
    }

    function slotToLatex(slot, showEmptyBox = false) {
        if (!slot || slot.items.length === 0) {
            return showEmptyBox ? '\\square' : '';
        }
        return slot.items.map(item => {
            if (item.type === 'sym') return item.latex;
            if (item.type === 'frac') {
                return `\\frac{${slotToLatex(item.num, true)}}{${slotToLatex(item.den, true)}}`;
            }
            if (item.type === 'int') {
                const low = slotToLatex(item.lower, false);
                const up = slotToLatex(item.upper, false);
                const body = slotToLatex(item.body, true);
                const dv = slotToLatex(item.dvar, false);
                let lims = '';
                if (low) lims += `_{${low}}`;
                if (up) lims += `^{${up}}`;
                const diffPart = dv ? `\\,d${dv}` : '';
                return `\\int${lims} ${body}${diffPart}`;
            }
            if (item.type === 'sup') {
                return `{${slotToLatex(item.base, true)}}^{${slotToLatex(item.exp, true)}}`;
            }
            if (item.type === 'sub') {
                return `{${slotToLatex(item.base, true)}}_{${slotToLatex(item.sub, true)}}`;
            }
            if (item.type === 'sqrt') {
                return `\\sqrt{${slotToLatex(item.body, true)}}`;
            }
            return '';
        }).join(' ');
    }

    function renderKatexPreview(latexStr) {
        if (typeof window !== 'undefined' && window.katex) {
            try {
                return window.katex.renderToString(latexStr || '\\square', {
                    displayMode: true,
                    throwOnError: false
                });
            } catch (e) {
                return latexStr;
            }
        }
        return latexStr;
    }

    // --- Structural Mutations on Active Slot ---
    function insertActionIntoActiveSlot(action) {
        const ctx = getActiveSlot();
        if (!ctx) return;
        const { slot } = ctx;

        if (action.kind === 'frac') {
            // If the current slot already has items immediately preceding, optionally move the last item into numerator or create empty upper/lower boxes
            const fracNode = createFrac([], []);
            slot.items.push(fracNode);
            // Auto-focus Upper Box (Numerator) first!
            activeSlotId = fracNode.num.id;
            lastRecognizedLabel = '➗ Created Fraction (Upper & Lower boxes) → Writing in Upper Box';
        } else if (action.kind === 'int') {
            const intNode = createInt([], [], [], []);
            slot.items.push(intNode);
            // Auto-focus Lower Limit or Integrand body
            activeSlotId = intNode.body.id;
            lastRecognizedLabel = '∫ Created Integral (Lower, Upper, Integrand & d□ boxes) → Writing in Integrand';
        } else if (action.kind === 'sup') {
            // Attach exponent box to the last symbol in the slot, or create a base+exponent box
            if (slot.items.length > 0 && slot.items[slot.items.length - 1].type === 'sym') {
                const lastSym = slot.items.pop();
                const supNode = createSup([lastSym], []);
                slot.items.push(supNode);
                activeSlotId = supNode.exp.id;
                lastRecognizedLabel = `^ Created Exponent box on ${lastSym.display} → Writing in Exponent`;
            } else {
                const supNode = createSup([createSym('e', 'e')], []);
                slot.items.push(supNode);
                activeSlotId = supNode.exp.id;
                lastRecognizedLabel = 'e^□ Created e to the power of □ → Writing in Exponent';
            }
        } else if (action.kind === 'exp_e') {
            const supNode = createSup([createSym('e', 'e')], []);
            slot.items.push(supNode);
            activeSlotId = supNode.exp.id;
            lastRecognizedLabel = 'e^□ Created e^{□} → Writing in Exponent Box';
        } else if (action.kind === 'sub') {
            if (slot.items.length > 0 && slot.items[slot.items.length - 1].type === 'sym') {
                const lastSym = slot.items.pop();
                const subNode = createSub([lastSym], []);
                slot.items.push(subNode);
                activeSlotId = subNode.sub.id;
                lastRecognizedLabel = `_ Created Subscript box on ${lastSym.display}`;
            } else {
                const subNode = createSub([], []);
                slot.items.push(subNode);
                activeSlotId = subNode.base.id;
                lastRecognizedLabel = '_ Created Subscript structure';
            }
        } else if (action.kind === 'sqrt') {
            const sqrtNode = createSqrt([]);
            slot.items.push(sqrtNode);
            activeSlotId = sqrtNode.body.id;
            lastRecognizedLabel = '√ Created Square Root box → Writing inside √';
        } else if (action.kind === 'sym') {
            slot.items.push(createSym(action.latex, action.display));
            lastRecognizedLabel = `✓ Converted ink to "${action.display}" (${action.latex})`;
        }

        docBlocks = [...docBlocks];
    }

    function backspaceActiveSlot() {
        const ctx = getActiveSlot();
        if (!ctx) return;
        if (ctx.slot.items.length > 0) {
            ctx.slot.items.pop();
            docBlocks = [...docBlocks];
        }
    }

    function addNewEquationBlock() {
        const newSlot = createSlot([]);
        const newBlock = {
            id: uid('block_eq'),
            kind: 'equation',
            rootSlot: newSlot
        };
        docBlocks = [...docBlocks, newBlock];
        activeBlockId = newBlock.id;
        activeSlotId = newSlot.id;
    }

    // --- On-Device Handwritten Math Gesture & Symbol Recognizer ---
    function analyzeStrokes(strokes) {
        if (!strokes || strokes.length === 0) return null;

        // Compute overall bounding box and path metrics
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let totalPathLen = 0;

        for (const s of strokes) {
            const pts = s.points;
            for (let i = 0; i < pts.length; i++) {
                const [x, y] = pts[i];
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
                if (i > 0) {
                    totalPathLen += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
                }
            }
        }

        const width = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);
        const aspect = width / height;

        // --- 2-STROKE SYMBOLS (=, +, *, x, j, π) ---
        if (strokes.length === 2) {
            const s1 = strokes[0].points;
            const s2 = strokes[1].points;
            const b1 = getBBox(s1);
            const b2 = getBBox(s2);

            // Check if stroke 2 is a dot above stroke 1 -> 'j' or 'i'
            const s2Diag = Math.hypot(b2.w, b2.h);
            if (s2Diag < 25 && b2.maxY < b1.minY + b1.h * 0.35 && b1.h > b1.w * 1.3) {
                return { kind: 'sym', latex: 'j', display: 'j' };
            }

            // Two horizontal parallel lines -> '='
            if (b1.w > b1.h * 2.0 && b2.w > b2.h * 2.0) {
                return { kind: 'sym', latex: '=', display: '=' };
            }

            // One horizontal + one vertical intersecting -> '+'
            const s1Horiz = b1.w > b1.h * 1.8;
            const s2Vert = b2.h > b2.w * 1.8;
            const s1Vert = b1.h > b1.w * 1.8;
            const s2Horiz = b2.w > b2.h * 1.8;
            if ((s1Horiz && s2Vert) || (s1Vert && s2Horiz)) {
                return { kind: 'sym', latex: '+', display: '+' };
            }

            // Two diagonal intersecting lines -> 'x' or '*'
            return { kind: 'sym', latex: 'x', display: 'x' };
        }

        // --- 3-STROKE SYMBOLS (*, π, ≡) ---
        if (strokes.length === 3) {
            const b0 = getBBox(strokes[0].points);
            if (b0.w > b0.h * 1.8 && strokes[1].points[0][1] >= b0.minY) {
                return { kind: 'sym', latex: '\\pi', display: 'π' };
            }
            return { kind: 'sym', latex: '\\cdot', display: '·' };
        }

        // --- 1-STROKE GESTURES & SYMBOLS ---
        const pts = strokes[0].points;
        const first = pts[0];
        const last = pts[pts.length - 1];
        const directDist = Math.hypot(last[0] - first[0], last[1] - first[1]);
        const straightness = directDist / Math.max(1, totalPathLen);
        const closedDist = directDist / Math.max(width, height);

        // 0. Dot / multiplication dot
        if (totalPathLen < 22 && width < 18 && height < 18) {
            return { kind: 'sym', latex: '\\cdot', display: '·' };
        }

        // 1. Horizontal Line (Fraction Bar OR Minus sign)
        // A wide horizontal line (width >= 95px) creates a Fraction (Upper & Lower box); a shorter one creates '-'
        if (aspect > 3.2 && straightness > 0.82) {
            if (width >= 90) {
                return { kind: 'frac' };
            }
            return { kind: 'sym', latex: '-', display: '−' };
        }

        // 2. Forward Slash '/' (Diagonal down-left or up-right) -> Fraction Upper & Lower boxes!
        if (straightness > 0.84 && aspect > 0.35 && aspect < 2.2) {
            const dx = last[0] - first[0];
            const dy = last[1] - first[1];
            // Slash goes from top-right to bottom-left OR bottom-left to top-right
            if ((dx < -15 && dy > 25) || (dx > 15 && dy < -25)) {
                return { kind: 'frac' };
            }
        }

        // 3. Tall Vertical Stroke: Integral '∫' vs '1' vs '(' vs ')'
        if (aspect < 0.55 && height > 45) {
            if (straightness > 0.91) {
                return { kind: 'sym', latex: '1', display: '1' };
            }
            // Check curvature for Integral ∫ (top hook curves right, bottom hook curves left, or S-shape inflection)
            // Compute signed horizontal deviations along top half vs bottom half
            let topDx = 0, botDx = 0;
            const midIdx = Math.floor(pts.length / 2);
            const midPt = pts[midIdx];
            for (let i = 0; i < midIdx; i++) topDx += (pts[i][0] - midPt[0]);
            for (let i = midIdx; i < pts.length; i++) botDx += (pts[i][0] - midPt[0]);

            // If top and bottom lean in opposite horizontal directions (S-curve) or tall curved stroke -> Integral!
            if (height >= 65 && (topDx * botDx < 0 || straightness < 0.88)) {
                return { kind: 'int' };
            }

            // Otherwise parenthesis '(' or ')'
            const midX = pts[midIdx][0];
            const endsAvgX = (first[0] + last[0]) / 2;
            if (midX < endsAvgX - 4) {
                return { kind: 'sym', latex: '(', display: '(' };
            } else {
                return { kind: 'sym', latex: ')', display: ')' };
            }
        }

        // 4. Square Root '√' (starts middle-left, dips down to bottom, rises up and goes right across the top)
        let minYIdx = 0, maxYIdx = 0;
        for (let i = 0; i < pts.length; i++) {
            if (pts[i][1] < pts[minYIdx][1]) minYIdx = i;
            if (pts[i][1] > pts[maxYIdx][1]) maxYIdx = i;
        }
        if (
            maxYIdx > 0 &&
            maxYIdx < pts.length * 0.55 &&
            last[0] > first[0] + width * 0.6 &&
            last[1] < first[1] - height * 0.15 &&
            width > 45 &&
            height > 30
        ) {
            return { kind: 'sqrt' };
        }

        // 5. Caret '^' (starts low, peaks at top middle, ends low on right) -> Exponent Box!
        if (
            minYIdx > pts.length * 0.2 &&
            minYIdx < pts.length * 0.8 &&
            first[1] > minY + height * 0.55 &&
            last[1] > minY + height * 0.55 &&
            last[0] > first[0] + width * 0.4
        ) {
            return { kind: 'sup' };
        }

        // 6. Closed loop or 'e' / '0' / '\theta'
        if (closedDist < 0.35 && totalPathLen > 1.8 * Math.max(width, height)) {
            // Check if it starts inside the middle (like lowercase 'e')
            const startRelY = (first[1] - minY) / height;
            const startRelX = (first[0] - minX) / width;
            if (startRelY > 0.28 && startRelY < 0.78 && startRelX < 0.65) {
                return { kind: 'sym', latex: 'e', display: 'e' };
            }
            return { kind: 'sym', latex: '0', display: '0' };
        }

        // 7. Handwritten 'e' (starts middle-left, goes right, loops up/around counter-clockwise and finishes bottom-right)
        const startRelY = (first[1] - minY) / height;
        if (startRelY > 0.25 && startRelY < 0.78 && totalPathLen > (width + height) * 1.35) {
            // Count local Y minima/maxima to distinguish 'e' from '\omega'
            let yTurns = 0;
            let prevDir = 0;
            for (let i = 2; i < pts.length; i += 2) {
                const dy = pts[i][1] - pts[i - 2][1];
                if (Math.abs(dy) > 2.5) {
                    const dir = dy > 0 ? 1 : -1;
                    if (prevDir !== 0 && dir !== prevDir) yTurns++;
                    prevDir = dir;
                }
            }
            if (yTurns >= 3 && aspect >= 1.15) {
                return { kind: 'sym', latex: '\\omega', display: 'ω' };
            }
            return { kind: 'sym', latex: 'e', display: 'e' };
        }

        // 8. Handwritten '\omega' / 'w' (starts top-left, dips down, peaks middle, dips down, ends top-right)
        if (first[1] < minY + height * 0.45 && last[1] < minY + height * 0.55 && last[0] > first[0] + width * 0.5 && totalPathLen > width * 2.1) {
            return { kind: 'sym', latex: '\\omega', display: 'ω' };
        }

        // 9. Handwritten '2' or '3' or 't'
        if (last[0] > first[0] && last[1] > minY + height * 0.75) {
            return { kind: 'sym', latex: '2', display: '2' };
        }

        // Default fallback symbol
        return { kind: 'sym', latex: 'x', display: 'x' };
    }

    function getBBox(pts) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of pts) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        return { minX, minY, maxX, maxY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    }

    // --- Commit Pending Handwritten Strokes into the Active LaTeX Box ---
    function commitPendingInk() {
        commitTimer = null;
        if (pendingStrokes.length === 0) return;

        const strokesToAnalyze = [...pendingStrokes];
        pendingStrokes = [];

        const action = analyzeStrokes(strokesToAnalyze);
        if (action) {
            insertActionIntoActiveSlot(action);
        }
    }

    // --- Sketch / Graph Override Mode -> Converts to Embedded SVG Block when Override Ends ---
    function toggleSketchOverride() {
        if (!isSketchOverride) {
            // Entering Sketch Override Mode
            if (commitTimer) {
                clearTimeout(commitTimer);
                commitPendingInk();
            }
            sketchStrokes = [];
            isSketchOverride = true;
            lastRecognizedLabel = '📈 Graph / Sketch Override ON: Draw freely, then tap "Finish Sketch → SVG"';
        } else {
            // Ending Sketch Override Mode -> Convert sketchStrokes into an inline SVG block!
            finishSketchToSvg();
        }
    }

    function finishSketchToSvg() {
        if (sketchStrokes.length > 0) {
            const svgHtml = generateCleanSvgFromStrokes(sketchStrokes);
            docBlocks = [
                ...docBlocks,
                {
                    id: uid('block_svg'),
                    kind: 'svg',
                    svgHtml
                }
            ];
            // Ensure there is an equation block after the SVG so the user can keep writing notes
            addNewEquationBlock();
            lastRecognizedLabel = '✅ Converted Graph/Sketch to crisp vector SVG block!';
        } else {
            lastRecognizedLabel = 'Exited Graph/Sketch Override mode.';
        }
        sketchStrokes = [];
        isSketchOverride = false;
    }

    function generateCleanSvgFromStrokes(targetStrokes) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        targetStrokes.forEach(s => {
            s.points.forEach(([x, y]) => {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            });
        });
        minX -= 16; minY -= 16; maxX += 16; maxY += 16;
        const w = Math.max(120, Math.round(maxX - minX));
        const h = Math.max(80, Math.round(maxY - minY));

        const paths = targetStrokes.map(s => {
            const shifted = s.points.map(([x, y, p]) => [x - minX, y - minY, p]);
            const d = computeStrokePath(shifted, s.size || 4);
            return `<path d="${d}" fill="${s.color || '#3b82f6'}" />`;
        }).join('\n');

        return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">\n${paths}\n</svg>`;
    }

    // --- High-Performance 240Hz Apple Pencil Ink Capture on the Direct Workspace ---
    function computeStrokePath(points, size = 4) {
        const outline = getStroke(points, {
            size,
            thinning: 0.45,
            smoothing: 0.5,
            streamline: 0.5,
            simulatePressure: false
        });
        if (!outline.length) return '';
        const d = outline.reduce(
            (acc, [x0, y0], i, arr) => {
                const [x1, y1] = arr[(i + 1) % arr.length];
                acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
                return acc;
            },
            ['M', ...outline[0], 'Q']
        );
        d.push('Z');
        return d.join(' ');
    }

    function getPointerPos(e) {
        if (!cachedRect && svgRef) {
            cachedRect = svgRef.getBoundingClientRect();
        }
        const x = e.clientX - cachedRect.left;
        const y = e.clientY - cachedRect.top;
        const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
        return [x, y, pressure];
    }

    function scheduleActivePathUpdate() {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            if (!activePathRef) return;
            if (currentPoints.length === 0) {
                activePathRef.setAttribute('d', '');
                return;
            }
            activePathRef.setAttribute('d', computeStrokePath(currentPoints, strokeSize));
        });
    }

    function handlePointerDown(e) {
        // Allow tapping buttons/slots without starting a stroke
        const target = e.target;
        if (target && target.closest && target.closest('.interactive-slot, .slot-action-bar, button, input')) {
            return;
        }

        if (commitTimer) {
            clearTimeout(commitTimer);
            commitTimer = null;
        }

        if (e.cancelable) e.preventDefault();
        activePointerId = e.pointerId;
        cachedRect = svgRef.getBoundingClientRect();

        try {
            if (e.pointerId !== undefined && svgRef.setPointerCapture) {
                svgRef.setPointerCapture(e.pointerId);
            }
        } catch (err) {}

        currentPoints = [getPointerPos(e)];
        if (activePathRef) {
            activePathRef.setAttribute('fill', isSketchOverride ? strokeColor : '#60a5fa');
        }
        scheduleActivePathUpdate();
    }

    function handlePointerMove(e) {
        if (activePointerId === null || e.pointerId !== activePointerId) return;
        if (currentPoints.length === 0) return;
        if (e.cancelable) e.preventDefault();

        const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        const events = coalesced.length > 0 ? coalesced : [e];
        for (let i = 0; i < events.length; i++) {
            currentPoints.push(getPointerPos(events[i]));
        }
        scheduleActivePathUpdate();
    }

    function handlePointerUp(e) {
        if (activePointerId === null || (e.pointerId !== undefined && e.pointerId !== activePointerId)) return;

        try {
            if (e.pointerId !== undefined && svgRef && svgRef.releasePointerCapture) {
                svgRef.releasePointerCapture(e.pointerId);
            }
        } catch (err) {}

        activePointerId = null;
        cachedRect = null;

        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (activePathRef) {
            activePathRef.setAttribute('d', '');
        }

        if (currentPoints.length === 0) return;
        const pts = currentPoints;
        currentPoints = [];

        // Ignore tiny accidental tap (< 6px movement and < 4 points)
        const bb = getBBox(pts);
        if (pts.length < 4 && bb.w < 6 && bb.h < 6) {
            return;
        }

        const strokeObj = {
            id: uid('ink'),
            points: pts,
            color: isSketchOverride ? strokeColor : '#60a5fa',
            size: strokeSize,
            cachedPath: computeStrokePath(pts, strokeSize)
        };

        if (isSketchOverride) {
            sketchStrokes = [...sketchStrokes, strokeObj];
        } else {
            pendingStrokes = [...pendingStrokes, strokeObj];
            commitTimer = setTimeout(commitPendingInk, COMMIT_DELAY_MS);
        }
    }

    // Parse typed or iPadOS Scribble text directly into the active LaTeX slot
    function handleScribbleTextCommit() {
        const raw = scribbleProxyInput.trim();
        if (!raw) return;
        scribbleProxyInput = '';

        for (let i = 0; i < raw.length; i++) {
            const ch = raw[i];
            if (ch === '/') {
                insertActionIntoActiveSlot({ kind: 'frac' });
            } else if (ch === '^') {
                insertActionIntoActiveSlot({ kind: 'sup' });
            } else if (ch === '_') {
                insertActionIntoActiveSlot({ kind: 'sub' });
            } else if (ch === 'w' || ch === 'ω') {
                insertActionIntoActiveSlot({ kind: 'sym', latex: '\\omega', display: 'ω' });
            } else if (ch === '*') {
                insertActionIntoActiveSlot({ kind: 'sym', latex: '\\cdot', display: '·' });
            } else if (ch !== ' ') {
                insertActionIntoActiveSlot({ kind: 'sym', latex: ch, display: ch });
            }
        }
    }

    function exportAllToMarkdown() {
        const parts = docBlocks.map(b => {
            if (b.kind === 'equation') {
                const ltx = slotToLatex(b.rootSlot, false);
                return ltx ? `$$\n${ltx}\n$$` : '';
            }
            if (b.kind === 'svg') {
                return b.svgHtml;
            }
            return '';
        }).filter(Boolean);
        return parts.join('\n\n');
    }

    async function saveToFirstTaskOrEditingTask() {
        const mdOutput = exportAllToMarkdown();
        if (!mdOutput) return;
        let targetTask = $editingTask || ($tasks && $tasks[0]);
        if (!targetTask) {
            alert("Create a task first or copy the LaTeX output below.");
            return;
        }
        targetTask.description = (targetTask.description ? targetTask.description + '\n\n' : '') + mdOutput;
        await fetch(`/api/tasks/${targetTask.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...targetTask,
                dueDate: targetTask.due_date,
                predecessors: targetTask.predecessors,
                assignees: targetTask.assignees,
                reminderTime: targetTask.reminder_time,
                reminderFrequency: targetTask.reminder_frequency
            })
        });
        lastRecognizedLabel = `💾 Appended LaTeX & SVG blocks to task "${targetTask.title}"!`;
    }

    function preventNativeTouch(e) {
        const target = e.target;
        if (target && target.closest && target.closest('.interactive-slot, .slot-action-bar, button, input')) {
            return;
        }
        if (e.cancelable) e.preventDefault();
    }

    onMount(() => {
        if (workspaceRef) {
            workspaceRef.addEventListener('touchstart', preventNativeTouch, { passive: false });
            workspaceRef.addEventListener('touchmove', preventNativeTouch, { passive: false });
        }
    });

    onDestroy(() => {
        if (commitTimer) clearTimeout(commitTimer);
        if (rafId) cancelAnimationFrame(rafId);
        if (workspaceRef) {
            workspaceRef.removeEventListener('touchstart', preventNativeTouch);
            workspaceRef.removeEventListener('touchmove', preventNativeTouch);
        }
    });
</script>

<div class="math-lab-page">
    <!-- Top Header & Mode Controls -->
    <div class="math-lab-header">
        <div>
            <h2>🧮 Live Handwritten LaTeX & Graph Override Lab</h2>
            <p class="status-banner">{lastRecognizedLabel}</p>
        </div>

        <div class="header-controls">
            <!-- GRAPH / SKETCH SVG OVERRIDE BUTTON -->
            <button
                class="btn override-btn {isSketchOverride ? 'active' : ''}"
                on:click={toggleSketchOverride}
            >
                {#if isSketchOverride}
                    ✅ Finish Sketch → Convert to SVG
                {:else}
                    📈 Graph / Sketch Override (SVG)
                {/if}
            </button>

            <button class="btn secondary small-btn" on:click={() => showLatexSource = !showLatexSource}>
                {showLatexSource ? 'Hide LaTeX Code' : '{ } View LaTeX'}
            </button>
            <button class="btn primary small-btn" on:click={saveToFirstTaskOrEditingTask}>
                ➕ Save to Task Notes
            </button>
        </div>
    </div>

    <!-- Quick Structural & Symbol Assist Bar (Works alongside direct Apple Pencil drawing) -->
    <div class="slot-action-bar">
        <div class="bar-section">
            <span class="bar-label">Structures:</span>
            <button class="struct-btn" on:click={() => insertActionIntoActiveSlot({ kind: 'int' })} title="Draw a tall S-curve or tap">
                ∫ Integral
            </button>
            <button class="struct-btn" on:click={() => insertActionIntoActiveSlot({ kind: 'frac' })} title="Draw '/' or a wide horizontal line '—' or tap">
                ➗ Fraction (Upper/Lower)
            </button>
            <button class="struct-btn" on:click={() => insertActionIntoActiveSlot({ kind: 'exp_e' })} title="e to the power of box">
                e<sup>□</sup>
            </button>
            <button class="struct-btn" on:click={() => insertActionIntoActiveSlot({ kind: 'sup' })} title="Draw '^' or tap for Exponent box">
                x<sup>□</sup> Power
            </button>
            <button class="struct-btn" on:click={() => insertActionIntoActiveSlot({ kind: 'sub' })} title="Subscript box">
                x<sub>□</sub> Sub
            </button>
            <button class="struct-btn" on:click={() => insertActionIntoActiveSlot({ kind: 'sqrt' })} title="Draw '√' or tap">
                √□ Root
            </button>
        </div>

        <div class="bar-section">
            <span class="bar-label">Symbols:</span>
            {#each [
                { latex: 'e', display: 'e' },
                { latex: '-', display: '−' },
                { latex: 'j', display: 'j' },
                { latex: '\\omega', display: 'ω' },
                { latex: 't', display: 't' },
                { latex: 'x', display: 'x' },
                { latex: '\\pi', display: 'π' },
                { latex: '\\theta', display: 'θ' },
                { latex: '+', display: '+' },
                { latex: '=', display: '=' },
                { latex: '\\infty', display: '∞' }
            ] as sym}
                <button class="sym-chip" on:click={() => insertActionIntoActiveSlot({ kind: 'sym', latex: sym.latex, display: sym.display })}>
                    {sym.display}
                </button>
            {/each}
        </div>

        <div class="bar-section" style="margin-left: auto;">
            <button class="nav-box-btn" on:click={jumpToNextSlot} title="Move focus to the next box after current term">
                Next Box (□) ▶
            </button>
            <button class="struct-btn" on:click={backspaceActiveSlot} title="Delete last item in active box">
                ⌫ Undo
            </button>
            <button class="struct-btn" on:click={addNewEquationBlock} title="Start a new equation line below">
                ↵ New Line
            </button>
        </div>
    </div>

    <!-- iPadOS Scribble / Direct Expression Quick-Input Bar -->
    <div class="scribble-bar">
        <span style="font-size:0.76rem; color:#94a3b8; white-space:nowrap;">✍️ Write directly on canvas below, or use iPad Scribble here:</span>
        <input
            bind:this={scribbleInputRef}
            type="text"
            bind:value={scribbleProxyInput}
            placeholder="Scribble or type e^-jw, /, etc. into active box..."
            on:keydown={(e) => e.key === 'Enter' && handleScribbleTextCommit()}
        />
        <button class="btn secondary small-btn" style="padding: 4px 10px; font-size: 0.78rem;" on:click={handleScribbleTextCommit}>
            Insert
        </button>

        {#if isSketchOverride}
            <div class="sketch-color-tools">
                {#each ['#3b82f6', '#ef4444', '#10b981', '#eab308', '#ffffff'] as c}
                    <button
                        class="color-dot"
                        style="background:{c}; border: {strokeColor === c ? '2px solid white' : '1px solid #64748b'};"
                        on:click={() => strokeColor = c}
                    ></button>
                {/each}
            </div>
        {/if}
    </div>

    <!-- UNIFIED LIVE LATEX + HANDWRITING CANVAS WINDOW -->
    <!-- You write directly anywhere in this window; strokes auto-convert into the highlighted active LaTeX box! -->
    <div
        class="live-latex-window {isSketchOverride ? 'sketch-mode' : ''}"
        bind:this={workspaceRef}
        on:pointerdown={handlePointerDown}
        on:pointermove={handlePointerMove}
        on:pointerup={handlePointerUp}
        on:pointercancel={handlePointerUp}
    >
        <!-- Guide watermark -->
        <div class="canvas-watermark">
            {#if isSketchOverride}
                📈 <strong>SKETCH OVERRIDE ACTIVE</strong> — Draw your graph or diagram anywhere, then tap "Finish Sketch → Convert to SVG"
            {:else}
                ✍️ <strong>WRITE DIRECTLY ANYWHERE HERE</strong> — Draw <strong>∫</strong> (tall S-curve), <strong>/</strong> or <strong>—</strong> (fraction boxes), <strong>^</strong> (power), <strong>e</strong>, <strong>-</strong>, <strong>j</strong>, <strong>ω</strong>. Tap any box <span class="mini-box-icon">□</span> to select it!
            {/if}
        </div>

        <!-- Rendered Interactive Equation Blocks & Converted SVG Sketch Blocks -->
        <div class="blocks-flow">
            {#each docBlocks as block (block.id)}
                {#if block.kind === 'equation'}
                    <div class="equation-block {activeBlockId === block.id ? 'active-block' : ''}">
                        <!-- Recursive Interactive Slot Renderer using custom DOM structure -->
                        <div class="eq-interactive-tree">
                            <!-- Root Slot -->
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <!-- svelte-ignore a11y-no-static-element-interactions -->
                            <div
                                class="interactive-slot root-slot {activeSlotId === block.rootSlot.id ? 'focused-slot' : ''}"
                                on:click={(e) => selectSlot(block.id, block.rootSlot.id, e)}
                            >
                                {#each block.rootSlot.items as item (item.id)}
                                    {#if item.type === 'sym'}
                                        <span class="math-sym">{item.display}</span>

                                    {:else if item.type === 'frac'}
                                        <div class="math-frac">
                                            <!-- Upper Box (Numerator) -->
                                            <div
                                                class="interactive-slot frac-box {activeSlotId === item.num.id ? 'focused-slot' : ''}"
                                                on:click={(e) => selectSlot(block.id, item.num.id, e)}
                                            >
                                                {#if item.num.items.length === 0}
                                                    <span class="empty-placeholder">□</span>
                                                {:else}
                                                    {#each item.num.items as subItem (subItem.id)}
                                                        {#if subItem.type === 'sym'}
                                                            <span class="math-sym">{subItem.display}</span>
                                                        {:else if subItem.type === 'sup'}
                                                            <span class="math-sup">
                                                                <span class="interactive-slot sup-base {activeSlotId === subItem.base.id ? 'focused-slot' : ''}" on:click={(e) => selectSlot(block.id, subItem.base.id, e)}>
                                                                    {#if subItem.base.items.length === 0}<span class="empty-placeholder">□</span>{:else}{#each subItem.base.items as bi}{bi.display || ''}{/each}{/if}
                                                                </span>
                                                                <span class="interactive-slot sup-exp {activeSlotId === subItem.exp.id ? 'focused-slot' : ''}" on:click={(e) => selectSlot(block.id, subItem.exp.id, e)}>
                                                                    {#if subItem.exp.items.length === 0}<span class="empty-placeholder">□</span>{:else}{#each subItem.exp.items as ei}{ei.display || ''}{/each}{/if}
                                                                </span>
                                                            </span>
                                                        {/if}
                                                    {/each}
                                                {/if}
                                            </div>
                                            <div class="frac-divider"></div>
                                            <!-- Lower Box (Denominator) -->
                                            <div
                                                class="interactive-slot frac-box {activeSlotId === item.den.id ? 'focused-slot' : ''}"
                                                on:click={(e) => selectSlot(block.id, item.den.id, e)}
                                            >
                                                {#if item.den.items.length === 0}
                                                    <span class="empty-placeholder">□</span>
                                                {:else}
                                                    {#each item.den.items as subItem (subItem.id)}
                                                        {#if subItem.type === 'sym'}
                                                            <span class="math-sym">{subItem.display}</span>
                                                        {:else if subItem.type === 'sup'}
                                                            <span class="math-sup">
                                                                <span class="interactive-slot sup-base {activeSlotId === subItem.base.id ? 'focused-slot' : ''}" on:click={(e) => selectSlot(block.id, subItem.base.id, e)}>
                                                                    {#if subItem.base.items.length === 0}<span class="empty-placeholder">□</span>{:else}{#each subItem.base.items as bi}{bi.display || ''}{/each}{/if}
                                                                </span>
                                                                <span class="interactive-slot sup-exp {activeSlotId === subItem.exp.id ? 'focused-slot' : ''}" on:click={(e) => selectSlot(block.id, subItem.exp.id, e)}>
                                                                    {#if subItem.exp.items.length === 0}<span class="empty-placeholder">□</span>{:else}{#each subItem.exp.items as ei}{ei.display || ''}{/each}{/if}
                                                                </span>
                                                            </span>
                                                        {/if}
                                                    {/each}
                                                {/if}
                                            </div>
                                        </div>

                                    {:else if item.type === 'int'}
                                        <div class="math-int-group">
                                            <div class="int-symbol-col">
                                                <!-- Upper Limit Box -->
                                                <div
                                                    class="interactive-slot int-limit-box {activeSlotId === item.upper.id ? 'focused-slot' : ''}"
                                                    on:click={(e) => selectSlot(block.id, item.upper.id, e)}
                                                    title="Integral Upper Limit"
                                                >
                                                    {#if item.upper.items.length === 0}
                                                        <span class="empty-placeholder">□</span>
                                                    {:else}
                                                        {#each item.upper.items as ui}{ui.display || ''}{/each}
                                                    {/if}
                                                </div>
                                                <span class="int-glyph">∫</span>
                                                <!-- Lower Limit Box -->
                                                <div
                                                    class="interactive-slot int-limit-box {activeSlotId === item.lower.id ? 'focused-slot' : ''}"
                                                    on:click={(e) => selectSlot(block.id, item.lower.id, e)}
                                                    title="Integral Lower Limit"
                                                >
                                                    {#if item.lower.items.length === 0}
                                                        <span class="empty-placeholder">□</span>
                                                    {:else}
                                                        {#each item.lower.items as li}{li.display || ''}{/each}
                                                    {/if}
                                                </div>
                                            </div>

                                            <!-- Integrand Body Box -->
                                            <div
                                                class="interactive-slot int-body-box {activeSlotId === item.body.id ? 'focused-slot' : ''}"
                                                on:click={(e) => selectSlot(block.id, item.body.id, e)}
                                                title="Integrand Expression"
                                            >
                                                {#if item.body.items.length === 0}
                                                    <span class="empty-placeholder">□</span>
                                                {:else}
                                                    {#each item.body.items as bi (bi.id)}
                                                        {#if bi.type === 'sym'}
                                                            <span class="math-sym">{bi.display}</span>
                                                        {:else if bi.type === 'sup'}
                                                            <span class="math-sup">
                                                                <span class="interactive-slot sup-base {activeSlotId === bi.base.id ? 'focused-slot' : ''}" on:click={(e) => selectSlot(block.id, bi.base.id, e)}>
                                                                    {#if bi.base.items.length === 0}<span class="empty-placeholder">□</span>{:else}{#each bi.base.items as bbi}{bbi.display || ''}{/each}{/if}
                                                                </span>
                                                                <span class="interactive-slot sup-exp {activeSlotId === bi.exp.id ? 'focused-slot' : ''}" on:click={(e) => selectSlot(block.id, bi.exp.id, e)}>
                                                                    {#if bi.exp.items.length === 0}<span class="empty-placeholder">□</span>{:else}{#each bi.exp.items as bei}{bei.display || ''}{/each}{/if}
                                                                </span>
                                                            </span>
                                                        {:else if bi.type === 'frac'}
                                                            <div class="math-frac">
                                                                <div class="interactive-slot frac-box {activeSlotId === bi.num.id ? 'focused-slot' : ''}" on:click={(e) => selectSlot(block.id, bi.num.id, e)}>
                                                                    {#if bi.num.items.length === 0}<span class="empty-placeholder">□</span>{:else}{#each bi.num.items as ni}{ni.display || ''}{/each}{/if}
                                                                </div>
                                                                <div class="frac-divider"></div>
                                                                <div class="interactive-slot frac-box {activeSlotId === bi.den.id ? 'focused-slot' : ''}" on:click={(e) => selectSlot(block.id, bi.den.id, e)}>
                                                                    {#if bi.den.items.length === 0}<span class="empty-placeholder">□</span>{:else}{#each bi.den.items as di}{di.display || ''}{/each}{/if}
                                                                </div>
                                                            </div>
                                                        {/if}
                                                    {/each}
                                                {/if}
                                            </div>

                                            <!-- Differential d□ Box -->
                                            <div class="int-diff-group">
                                                <span class="math-sym">d</span>
                                                <div
                                                    class="interactive-slot int-dvar-box {activeSlotId === item.dvar.id ? 'focused-slot' : ''}"
                                                    on:click={(e) => selectSlot(block.id, item.dvar.id, e)}
                                                    title="Differential Variable (e.g. t or ω)"
                                                >
                                                    {#if item.dvar.items.length === 0}
                                                        <span class="empty-placeholder">□</span>
                                                    {:else}
                                                        {#each item.dvar.items as dvi}{dvi.display || ''}{/each}
                                                    {/if}
                                                </div>
                                            </div>
                                        </div>

                                    {:else if item.type === 'sup'}
                                        <div class="math-sup">
                                            <div
                                                class="interactive-slot sup-base {activeSlotId === item.base.id ? 'focused-slot' : ''}"
                                                on:click={(e) => selectSlot(block.id, item.base.id, e)}
                                            >
                                                {#if item.base.items.length === 0}
                                                    <span class="empty-placeholder">□</span>
                                                {:else}
                                                    {#each item.base.items as bi}{bi.display || ''}{/each}
                                                {/if}
                                            </div>
                                            <div
                                                class="interactive-slot sup-exp {activeSlotId === item.exp.id ? 'focused-slot' : ''}"
                                                on:click={(e) => selectSlot(block.id, item.exp.id, e)}
                                                title="Exponent Box (e.g. -jω)"
                                            >
                                                {#if item.exp.items.length === 0}
                                                    <span class="empty-placeholder">□</span>
                                                {:else}
                                                    {#each item.exp.items as ei}{ei.display || ''}{/each}
                                                {/if}
                                            </div>
                                        </div>

                                    {:else if item.type === 'sub'}
                                        <div class="math-sub">
                                            <div
                                                class="interactive-slot sub-base {activeSlotId === item.base.id ? 'focused-slot' : ''}"
                                                on:click={(e) => selectSlot(block.id, item.base.id, e)}
                                            >
                                                {#if item.base.items.length === 0}
                                                    <span class="empty-placeholder">□</span>
                                                {:else}
                                                    {#each item.base.items as bi}{bi.display || ''}{/each}
                                                {/if}
                                            </div>
                                            <div
                                                class="interactive-slot sub-idx {activeSlotId === item.sub.id ? 'focused-slot' : ''}"
                                                on:click={(e) => selectSlot(block.id, item.sub.id, e)}
                                            >
                                                {#if item.sub.items.length === 0}
                                                    <span class="empty-placeholder">□</span>
                                                {:else}
                                                    {#each item.sub.items as si}{si.display || ''}{/each}
                                                {/if}
                                            </div>
                                        </div>

                                    {:else if item.type === 'sqrt'}
                                        <div class="math-sqrt">
                                            <span class="sqrt-radical">√</span>
                                            <div
                                                class="interactive-slot sqrt-body {activeSlotId === item.body.id ? 'focused-slot' : ''}"
                                                on:click={(e) => selectSlot(block.id, item.body.id, e)}
                                            >
                                                {#if item.body.items.length === 0}
                                                    <span class="empty-placeholder">□</span>
                                                {:else}
                                                    {#each item.body.items as sbi}{sbi.display || ''}{/each}
                                                {/if}
                                            </div>
                                        </div>
                                    {/if}
                                {/each}

                                <!-- Trailing Next Box cursor inside root slot -->
                                <span
                                    class="trailing-next-box {activeSlotId === block.rootSlot.id ? 'active-cursor' : ''}"
                                    on:click={(e) => selectSlot(block.id, block.rootSlot.id, e)}
                                    title="Tap to continue equation after current structure"
                                >
                                    □
                                </span>
                            </div>

                            <!-- Live Rendered KaTeX Typeset Preview on the right side of the block -->
                            <div class="katex-live-badge">
                                {@html renderKatexPreview(slotToLatex(block.rootSlot, true))}
                            </div>
                        </div>
                    </div>

                {:else if block.kind === 'svg'}
                    <div class="svg-sketch-block">
                        <div class="svg-block-label">📈 Embedded Graph / Sketch (SVG)</div>
                        {@html block.svgHtml}
                    </div>
                {/if}
            {/each}
        </div>

        <!-- TRANSPARENT LIVE INK OVERLAY (Captures strokes across the entire window & dissolves them into LaTeX!) -->
        <svg bind:this={svgRef} class="ink-overlay-svg">
            {#if isSketchOverride}
                {#each sketchStrokes as s (s.id)}
                    <path d={s.cachedPath} fill={s.color} />
                {/each}
            {:else}
                {#each pendingStrokes as s (s.id)}
                    <path d={s.cachedPath} fill="#60a5fa" opacity="0.85" />
                {/each}
            {/if}

            <path bind:this={activePathRef} d="" fill={isSketchOverride ? strokeColor : '#60a5fa'} />
        </svg>
    </div>

    {#if showLatexSource}
        <div class="latex-source-panel">
            <strong>Generated LaTeX / SVG Markdown:</strong>
            <pre>{exportAllToMarkdown() || '% Write an equation above...'}</pre>
        </div>
    {/if}
</div>

<style>
    .math-lab-page { display: flex; flex-direction: column; gap: 12px; color: var(--text-color); -webkit-user-select: none; user-select: none; }
    .math-lab-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
    .math-lab-header h2 { margin: 0; font-size: 1.25rem; }
    .status-banner { margin: 4px 0 0 0; font-size: 0.82rem; color: #34d399; font-weight: 600; }

    .header-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .override-btn { background: #1e293b; color: #fbbf24; border: 1px solid #f59e0b; padding: 8px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.85rem; }
    .override-btn.active { background: #f59e0b; color: #000; animation: pulseBorder 1.5s infinite; }

    @keyframes pulseBorder {
        0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5); }
        50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
    }

    .slot-action-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; background: var(--sidebar-bg); border: 1px solid var(--border-color); padding: 10px 12px; border-radius: 8px; }
    .bar-section { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .bar-label { font-size: 0.72rem; color: #94a3b8; text-transform: uppercase; font-weight: bold; margin-right: 2px; }

    .struct-btn { background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 6px 10px; border-radius: 6px; font-size: 0.82rem; font-weight: 600; cursor: pointer; touch-action: manipulation; }
    .struct-btn:hover { border-color: var(--btn-primary-bg); }

    .sym-chip { background: var(--input-bg); color: #a5b4fc; border: 1px solid var(--border-color); padding: 5px 10px; border-radius: 6px; font-size: 0.9rem; font-family: 'Times New Roman', Georgia, serif; font-style: italic; font-weight: bold; cursor: pointer; touch-action: manipulation; }
    .sym-chip:hover { background: var(--border-color); }

    .nav-box-btn { background: var(--btn-primary-bg); color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.82rem; font-weight: bold; cursor: pointer; touch-action: manipulation; }

    .scribble-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: var(--sidebar-bg); border: 1px solid var(--border-color); padding: 8px 12px; border-radius: 8px; }
    .scribble-bar input { flex: 1; min-width: 180px; background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 6px 10px; border-radius: 6px; font-size: 0.85rem; }
    .sketch-color-tools { display: flex; gap: 6px; align-items: center; }
    .color-dot { width: 22px; height: 22px; border-radius: 50%; cursor: pointer; padding: 0; }

    /* Unified Live LaTeX + Ink Canvas Window */
    .live-latex-window {
        position: relative;
        min-height: 460px;
        background: var(--input-bg);
        border: 2px solid var(--border-color);
        border-radius: 10px;
        padding: 20px;
        overflow: hidden;
        touch-action: none;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        cursor: crosshair;
    }
    .live-latex-window.sketch-mode {
        border-color: #f59e0b;
        background-image: radial-gradient(rgba(245, 158, 11, 0.15) 1px, transparent 1px);
        background-size: 20px 20px;
    }

    .canvas-watermark { font-size: 0.78rem; color: #64748b; margin-bottom: 16px; pointer-events: none; }
    .mini-box-icon { display: inline-block; border: 1px dashed #60a5fa; color: #60a5fa; padding: 0 4px; border-radius: 3px; font-weight: bold; }

    .blocks-flow { display: flex; flex-direction: column; gap: 16px; position: relative; z-index: 5; }

    .equation-block {
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 14px 18px;
    }
    .equation-block.active-block {
        border-color: rgba(99, 102, 241, 0.5);
    }

    .eq-interactive-tree { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 20px; }

    /* Interactive Slots (Boxes) */
    .interactive-slot {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 28px;
        min-height: 32px;
        padding: 4px 8px;
        border: 1.5px dashed rgba(148, 163, 184, 0.35);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
    }
    .interactive-slot.focused-slot {
        border: 2px solid #3b82f6;
        background: rgba(59, 130, 246, 0.14);
        box-shadow: 0 0 10px rgba(59, 130, 246, 0.25);
    }

    .empty-placeholder { color: #60a5fa; font-size: 1rem; opacity: 0.8; }
    .math-sym { font-family: 'Times New Roman', Georgia, serif; font-size: 1.55rem; font-style: italic; padding: 0 2px; }

    .trailing-next-box {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 28px;
        border: 1.5px dashed #475569;
        border-radius: 5px;
        color: #64748b;
        font-size: 0.95rem;
        margin-left: 6px;
        cursor: pointer;
    }
    .trailing-next-box.active-cursor {
        border: 2px solid #3b82f6;
        color: #60a5fa;
        background: rgba(59, 130, 246, 0.18);
    }

    /* Fraction Structure (Upper & Lower Boxes) */
    .math-frac { display: inline-flex; flex-direction: column; align-items: center; vertical-align: middle; margin: 0 4px; }
    .frac-box { min-width: 42px; justify-content: center; }
    .frac-divider { width: 100%; height: 2px; background: var(--text-color); margin: 4px 0; }

    /* Integral Structure (Upper, Lower, Body, dVar Boxes) */
    .math-int-group { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; margin: 0 4px; }
    .int-symbol-col { display: inline-flex; flex-direction: column; align-items: center; line-height: 1; }
    .int-glyph { font-size: 2.5rem; font-family: 'Times New Roman', serif; margin: -2px 0; }
    .int-limit-box { min-width: 24px; min-height: 22px; padding: 2px 5px; font-size: 0.85rem; justify-content: center; }
    .int-body-box { min-width: 46px; min-height: 36px; }
    .int-diff-group { display: inline-flex; align-items: center; gap: 2px; margin-left: 2px; }
    .int-dvar-box { min-width: 26px; min-height: 28px; padding: 2px 5px; justify-content: center; }

    /* Exponent / Superscript Structure */
    .math-sup { display: inline-flex; align-items: flex-start; margin: 0 2px; }
    .sup-base { min-width: 24px; }
    .sup-exp { min-width: 28px; min-height: 24px; padding: 2px 6px; font-size: 0.85rem; transform: translateY(-10px); margin-left: 2px; }

    /* Subscript Structure */
    .math-sub { display: inline-flex; align-items: flex-end; margin: 0 2px; }
    .sub-base { min-width: 24px; }
    .sub-idx { min-width: 26px; min-height: 22px; padding: 2px 5px; font-size: 0.82rem; transform: translateY(8px); margin-left: 2px; }

    /* Square Root Structure */
    .math-sqrt { display: inline-flex; align-items: center; margin: 0 4px; }
    .sqrt-radical { font-size: 1.8rem; margin-right: 2px; }
    .sqrt-body { border-top: 2px solid var(--text-color); padding-top: 4px; }

    .katex-live-badge {
        background: var(--sidebar-bg);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 6px 14px;
        min-width: 90px;
        text-align: center;
    }

    .svg-sketch-block {
        background: var(--sidebar-bg);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 12px;
        display: inline-flex;
        flex-direction: column;
        gap: 6px;
        align-self: flex-start;
    }
    .svg-block-label { font-size: 0.72rem; color: #fbbf24; font-weight: bold; text-transform: uppercase; }

    .ink-overlay-svg {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2;
        pointer-events: none;
    }

    .latex-source-panel {
        background: var(--sidebar-bg);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 12px;
        font-size: 0.82rem;
    }
    .latex-source-panel pre {
        margin: 8px 0 0 0;
        padding: 10px;
        background: var(--input-bg);
        border-radius: 6px;
        overflow-x: auto;
        color: #a5b4fc;
    }
</style>
