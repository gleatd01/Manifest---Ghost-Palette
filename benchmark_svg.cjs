const { performance } = require('perf_hooks');

// Mock getStroke and getSvgPathFromStroke
function getStroke(points, options) {
    return points; // mock
}

function getSvgPathFromStroke(stroke) {
    if (!stroke.length) return '';
    return 'M0,0 Z'; // mock for speed test of the loop itself
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

// Optimized version
function generateSvgStringFromStrokesOptimized(targetStrokes) {
    if (targetStrokes.length === 0) return "";
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    // We can also optimize the bounding box calculation loop!
    for (let i = 0; i < targetStrokes.length; i++) {
        let pts = targetStrokes[i].points;
        for (let j = 0; j < pts.length; j++) {
            let pt = pts[j];
            if (pt[0] < minX) minX = pt[0];
            if (pt[1] < minY) minY = pt[1];
            if (pt[0] > maxX) maxX = pt[0];
            if (pt[1] > maxY) maxY = pt[1];
        }
    }

    minX -= 20; minY -= 20; maxX += 20; maxY += 20;
    let width = Math.max(100, maxX - minX);
    let height = Math.max(100, maxY - minY);

    let paths = "";
    for (let i = 0; i < targetStrokes.length; i++) {
        let stroke = targetStrokes[i];
        let pts = stroke.points;
        let offsetPoints = new Array(pts.length);
        for (let j = 0; j < pts.length; j++) {
            let pt = pts[j];
            offsetPoints[j] = [pt[0] - minX, pt[1] - minY, pt[2]];
        }
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        paths += `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
    }

    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">\n${paths}\n</svg>`;
}

function generateSvgStringFromStrokesReduce(targetStrokes) {
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
        let offsetPoints = stroke.points.map(pt => [pt[0] - minX, pt[1] - minY, pt[2]]);
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        return acc + `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
    }, "");

    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">\n${paths}\n</svg>`;
}

// Generate large fake dataset
const strokes = [];
for (let i = 0; i < 1000; i++) {
    const points = [];
    for (let j = 0; j < 50; j++) {
        points.push([Math.random() * 1000, Math.random() * 1000, Math.random()]);
    }
    strokes.push({ points, size: 5, color: '#000', isHighlighter: false });
}

// Warm up
for (let i = 0; i < 10; i++) {
    generateSvgStringFromStrokes(strokes);
    generateSvgStringFromStrokesOptimized(strokes);
    generateSvgStringFromStrokesReduce(strokes);
}

const ITERATIONS = 100;

let start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    generateSvgStringFromStrokes(strokes);
}
let originalTime = performance.now() - start;

start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    generateSvgStringFromStrokesReduce(strokes);
}
let reduceTime = performance.now() - start;

start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    generateSvgStringFromStrokesOptimized(strokes);
}
let optimizedTime = performance.now() - start;

console.log(`Original: ${originalTime.toFixed(2)} ms`);
console.log(`Reduce: ${reduceTime.toFixed(2)} ms`);
console.log(`Optimized (for loop): ${optimizedTime.toFixed(2)} ms`);
