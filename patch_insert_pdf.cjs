const fs = require('fs');
let code = fs.readFileSync('frontend/src/views/StudyMode.svelte', 'utf8');

if (!code.includes('insertPdfSvgToNotes')) {
    console.log("Could not find insertPdfSvgToNotes, modifying...");
    let search = `    function clearHandwriting() {
        if (drawingMode === 'svg') strokes = [];
        if (drawingMode === 'fabric' && fabCanvas) fabCanvas.clear();
    }`;
    let replace = search + `\n\n    function insertPdfSvgToNotes() {
        if (drawingMode !== 'svg' || strokes.length === 0) return;
        let svgStr = generateSvgStringFromStrokes(strokes);
        $editingTask.description = ($editingTask.description || '') + "\\n\\n" + svgStr + "\\n\\n";
        saveEdit();
        renderPreview();
        clearHandwriting();
    }`;
    code = code.replace(search, replace);
    fs.writeFileSync('frontend/src/views/StudyMode.svelte', code);
    console.log("Done");
} else {
    console.log("insertPdfSvgToNotes already exists!");
}
