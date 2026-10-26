const { performance } = require('perf_hooks');

function getStroke(points, options) { return points; }
function getSvgPathFromStroke(stroke) { return 'M0,0 Z'; }

function mapJoin(targetStrokes) {
    let minX = 0, minY = 0;
    return targetStrokes.map(stroke => {
        let offsetPoints = stroke.points.map(pt => [pt[0] - minX, pt[1] - minY, pt[2]]);
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        return `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
    }).join("");
}

function reduceConcat(targetStrokes) {
    let minX = 0, minY = 0;
    return targetStrokes.reduce((acc, stroke) => {
        let offsetPoints = stroke.points.map(pt => [pt[0] - minX, pt[1] - minY, pt[2]]);
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        return acc + `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
    }, "");
}

function reduceConcatNoInnerMap(targetStrokes) {
    let minX = 0, minY = 0;
    return targetStrokes.reduce((acc, stroke) => {
        const pts = stroke.points;
        const len = pts.length;
        const offsetPoints = new Array(len);
        for(let i=0; i<len; i++) {
            offsetPoints[i] = [pts[i][0] - minX, pts[i][1] - minY, pts[i][2]];
        }
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        return acc + `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
    }, "");
}

function forLoopJoin(targetStrokes) {
    let minX = 0, minY = 0;
    let paths = [];
    for (let i = 0; i < targetStrokes.length; i++) {
        let stroke = targetStrokes[i];
        let offsetPoints = stroke.points.map(pt => [pt[0] - minX, pt[1] - minY, pt[2]]);
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        paths.push(`<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`);
    }
    return paths.join("");
}

function forLoopReduce(targetStrokes) {
    let minX = 0, minY = 0;
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

function highlyOptimized(targetStrokes) {
    let minX = 0, minY = 0;
    const numStrokes = targetStrokes.length;
    let paths = ""; // Could also be an array, let's see. Let's make it an array and join.
    let pathsArr = new Array(numStrokes);
    for (let i = 0; i < numStrokes; i++) {
        const stroke = targetStrokes[i];
        const pts = stroke.points;
        const len = pts.length;
        const offsetPoints = new Array(len);
        for(let j=0; j<len; j++) {
            const pt = pts[j];
            offsetPoints[j] = [pt[0] - minX, pt[1] - minY, pt[2]];
        }
        let d = getSvgPathFromStroke(getStroke(offsetPoints, { size: stroke.size || 5, thinning: 0.5, smoothing: 0.5 }));
        const opacity = stroke.isHighlighter ? 0.4 : 1.0;
        pathsArr[i] = `<path d="${d}" fill="${stroke.color || '#3b82f6'}" opacity="${opacity}" />`;
    }
    return pathsArr.join("");
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
    mapJoin(strokes);
    reduceConcat(strokes);
    reduceConcatNoInnerMap(strokes);
    forLoopJoin(strokes);
    forLoopReduce(strokes);
    highlyOptimized(strokes);
}

const ITERATIONS = 100;

let start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    mapJoin(strokes);
}
console.log(`mapJoin: ${(performance.now() - start).toFixed(2)} ms`);

start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    reduceConcat(strokes);
}
console.log(`reduceConcat: ${(performance.now() - start).toFixed(2)} ms`);

start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    reduceConcatNoInnerMap(strokes);
}
console.log(`reduceConcatNoInnerMap: ${(performance.now() - start).toFixed(2)} ms`);

start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    forLoopJoin(strokes);
}
console.log(`forLoopJoin: ${(performance.now() - start).toFixed(2)} ms`);

start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    forLoopReduce(strokes);
}
console.log(`forLoopReduce: ${(performance.now() - start).toFixed(2)} ms`);

start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    highlyOptimized(strokes);
}
console.log(`highlyOptimized: ${(performance.now() - start).toFixed(2)} ms`);
