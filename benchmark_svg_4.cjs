const { performance } = require('perf_hooks');

function getStroke(points, options) { return points; }
function getSvgPathFromStroke(stroke) { return 'M0,0 Z'; }

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
    reduceConcat(strokes);
    reduceConcatNoInnerMap(strokes);
}

const ITERATIONS = 100;

let start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    reduceConcat(strokes);
}
console.log(`reduceConcat: ${(performance.now() - start).toFixed(2)} ms`);

start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    reduceConcatNoInnerMap(strokes);
}
console.log(`reduceConcatNoInnerMap: ${(performance.now() - start).toFixed(2)} ms`);
