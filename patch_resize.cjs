const fs = require('fs');
let code = fs.readFileSync('frontend/src/views/StudyMode.svelte', 'utf8');

code = code.replace(`    // Handle resize of notes pad container
    onMount(() => {
        // resize observer to set notes pad width/height
        const ro = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.target === notesPadRef) {
                    notesPadWidth = entry.contentRect.width;
                    notesPadHeight = entry.contentRect.height;
                }
            }
        });
        if (notesPadRef) ro.observe(notesPadRef);
        return () => { if (notesPadRef) ro.unobserve(notesPadRef); }
    });`, `    // Handle resize of notes pad container
    let ro;
    $: if (notesPadRef) {
        if (!ro) {
            ro = new ResizeObserver(entries => {
                for (let entry of entries) {
                    if (entry.target === notesPadRef) {
                        notesPadWidth = entry.contentRect.width;
                        notesPadHeight = entry.contentRect.height;
                    }
                }
            });
        }
        ro.observe(notesPadRef);
    } else if (ro) {
        ro.disconnect();
    }`);
fs.writeFileSync('frontend/src/views/StudyMode.svelte', code);
