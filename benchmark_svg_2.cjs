const { performance } = require('perf_hooks');

// Mock getStroke and getSvgPathFromStroke
function getStroke(points, options) {
    return points; // mock
}

function getSvgPathFromStroke(stroke) {
    if (!stroke.length) return '';
    return 'M0,0 Z'; // mock for speed test of the loop itself
}

function originalFunc(targetStrokes) {
    let minX = 0, minY = 0;

    let paths = targetStrokes.map(stroke => {
        let offsetPoints = stroke.points.map(pt => [pt[0] - minX, pt[1] - minY, pt[2]]);
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        return `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
    }).join("");
    return paths;
}

function reduceFunc(targetStrokes) {
    let minX = 0, minY = 0;

    let paths = targetStrokes.reduce((acc, stroke) => {
        let offsetPoints = stroke.points.map(pt => [pt[0] - minX, pt[1] - minY, pt[2]]);
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        return acc + `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
    }, "");
    return paths;
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
    originalFunc(strokes);
    reduceFunc(strokes);
}

const ITERATIONS = 100;

let start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    originalFunc(strokes);
}
let originalTime = performance.now() - start;

start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    reduceFunc(strokes);
}
let reduceTime = performance.now() - start;


console.log(`Original: ${originalTime.toFixed(2)} ms`);
console.log(`Reduce: ${reduceTime.toFixed(2)} ms`);
