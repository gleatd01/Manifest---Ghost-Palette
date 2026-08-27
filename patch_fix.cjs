const fs = require('fs');
let code = fs.readFileSync('frontend/src/views/StudyMode.svelte', 'utf8');
code = code.replace(`    function clearHandwriting() {
        if (drawingMode === 'svg') strokes = [];
        if (drawingMode === 'fabric' && fabCanvas) fabCanvas.clear();
    }`, `    function clearHandwriting() {
        if (drawingMode === 'svg') strokes = [];
        if (drawingMode === 'fabric' && fabCanvas) fabCanvas.clear();
    }

    function insertPdfSvgToNotes() {
        if (drawingMode !== 'svg' || strokes.length === 0) return;
        let svgStr = generateSvgStringFromStrokes(strokes);
        $editingTask.description = ($editingTask.description || '') + "\\n\\n" + svgStr + "\\n\\n";
        saveEdit();
        renderPreview();
        clearHandwriting();
    }`);
fs.writeFileSync('frontend/src/views/StudyMode.svelte', code);
