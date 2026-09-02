const { performance } = require('perf_hooks');

// Generate a mock timeline
const timelineSize = 10000;
const slideTimeline = [];
for (let i = 0; i < timelineSize; i++) {
    slideTimeline.push({ time: i * 5, page: i + 1 });
}

// Generate random search queries to simulate jumping around/playback
const numQueries = 100000;
const queries = [];
for (let i = 0; i < numQueries; i++) {
    queries.push(Math.random() * (timelineSize * 5));
}

function linearSearch(currentTime) {
    let targetedPage = slideTimeline[0].page;
    for (let point of slideTimeline) {
        if (currentTime >= point.time) {
            targetedPage = point.page;
        }
    }
    return targetedPage;
}

function binarySearch(currentTime) {
    let low = 0;
    let high = slideTimeline.length - 1;
    let resultPage = slideTimeline[0].page;

    while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        if (slideTimeline[mid].time <= currentTime) {
            resultPage = slideTimeline[mid].page;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return resultPage;
}

console.log(`Starting benchmark for ${numQueries} queries on an array of size ${timelineSize}...`);

const startLinear = performance.now();
let dummy1 = 0;
for (let i = 0; i < numQueries; i++) {
    dummy1 += linearSearch(queries[i]);
}
const endLinear = performance.now();
const linearTime = endLinear - startLinear;
console.log(`Linear Search Time: ${linearTime.toFixed(2)} ms`);

const startBinary = performance.now();
let dummy2 = 0;
for (let i = 0; i < numQueries; i++) {
    dummy2 += binarySearch(queries[i]);
}
const endBinary = performance.now();
const binaryTime = endBinary - startBinary;
console.log(`Binary Search Time: ${binaryTime.toFixed(2)} ms`);

console.log(`Improvement: ${(linearTime / binaryTime).toFixed(2)}x faster`);

// Verification step to ensure correctness
let isCorrect = true;
for (let i = 0; i < 1000; i++) {
    let q = Math.random() * (timelineSize * 5);
    if (linearSearch(q) !== binarySearch(q)) {
        isCorrect = false;
        console.log(`Mismatch at query ${q}: Linear=${linearSearch(q)}, Binary=${binarySearch(q)}`);
        break;
    }
}
console.log(`Correctness Check: ${isCorrect ? "PASSED" : "FAILED"}`);
