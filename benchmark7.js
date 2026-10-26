import { performance } from 'perf_hooks';

// Mocks to simulate overhead
function getStroke(points, options) {
    return points;
}
function getSvgPathFromStroke(stroke) {
    return 'M 0 0 Z';
}

const targetStrokes = [];
for (let i = 0; i < 2000; i++) {
    const points = [];
    for (let j = 0; j < 50; j++) {
        points.push([Math.random() * 100, Math.random() * 100, Math.random()]);
    }
    targetStrokes.push({
        points,
        size: 5,
        color: '#3b82f6',
        isHighlighter: false
    });
}

function runOriginal() {
    let minX = 10, minY = 10;

    // THE TARGET CODE
    let paths = targetStrokes.map(stroke => {
        let offsetPoints = stroke.points.map(pt => [pt[0] - minX, pt[1] - minY, pt[2]]);
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        return `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
    }).join("");
    return paths;
}

function runReduceOnly() {
    let minX = 10, minY = 10;

    let paths = targetStrokes.reduce((acc, stroke) => {
        let offsetPoints = stroke.points.map(pt => [pt[0] - minX, pt[1] - minY, pt[2]]);
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        return acc + `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
    }, "");
    return paths;
}

function runForLoop() {
    let minX = 10, minY = 10;

    let paths = "";
    for (let i = 0; i < targetStrokes.length; i++) {
        let stroke = targetStrokes[i];
        let offsetPoints = stroke.points.map(pt => [pt[0] - minX, pt[1] - minY, pt[2]]);
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        paths += `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
    }
    return paths;
}


const ITERS = 100;
console.log("Warming up...");
for (let i = 0; i < 10; i++) {
    runOriginal();
    runReduceOnly();
    runForLoop();
}

console.log("Benchmarking Original...");
const startOriginal = performance.now();
for (let i = 0; i < ITERS; i++) {
    runOriginal();
}
const timeOriginal = performance.now() - startOriginal;

console.log("Benchmarking Reduce Only...");
const startReduceOnly = performance.now();
for (let i = 0; i < ITERS; i++) {
    runReduceOnly();
}
const timeReduceOnly = performance.now() - startReduceOnly;

console.log("Benchmarking For Loop...");
const startForLoop = performance.now();
for (let i = 0; i < ITERS; i++) {
    runForLoop();
}
const timeForLoop = performance.now() - startForLoop;



console.log(`Original: ${timeOriginal.toFixed(2)}ms`);
console.log(`Reduce Only: ${timeReduceOnly.toFixed(2)}ms`);
console.log(`For Loop: ${timeForLoop.toFixed(2)}ms`);

let diff = timeOriginal - timeReduceOnly;
let percent = (diff / timeOriginal) * 100;
console.log(`Improvement (Reduce): ${percent.toFixed(2)}% faster`);

diff = timeOriginal - timeForLoop;
percent = (diff / timeOriginal) * 100;
console.log(`Improvement (For Loop): ${percent.toFixed(2)}% faster`);
