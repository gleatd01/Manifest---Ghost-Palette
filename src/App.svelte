<script>
    import { onMount, tick } from 'svelte';
    import { io } from 'socket.io-client';
    import * as pdfjsLib from 'pdfjs-dist';

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // Catch the build-arg value injected by Vite at compile time
    const appVersion = __APP_VERSION__;

    let user = null;
    let tasks = [];
    let allUsers = []; 
    let currentView = 'list';
    let editingTask = null;
    let isStudyMode = false;
    let isHeaderCollapsed = false;
    
    let showAssignees = false;
    let showDependencies = false;
    let showReminder = false;
    let selectedDep = null;
    let selectedAssignee = null;
    
    // PDF & Viewer variables
    let pdfContainerRef;
    let canvasRef;
    let pdfDoc = null;
    let pageNum = 1;
    let isRendering = false;
    let pdfWidth = 0;
    let pdfHeight = 0;

    // --- V30.4 HANDWRITING & INFINITE WORKSPACE VARIABLES ---
    let drawingMode = 'off'; // 'off', 'svg', 'fabric'
    let isPanning = false; 
    let pzInstance = null;
    
    // Fabric state
    let fabCanvas = null;

    // Perfect Freehand (SVG) state
    let currentPoints = [];
    let strokes = [];

    // --- Media Variables ---
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recognition = null;
    let recordingStartTime = 0;
    let slideTimeline = []; 
    let activePlaybackPage = 1;

    let calendarMode = 'month';
    let currentDate = new Date();
    $: currentMonth = currentDate.getMonth();
    $: currentYear = currentDate.getFullYear();
    $: daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    $: firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
    $: currentWeekStart = new Date(currentYear, currentMonth, currentDate.getDate() - currentDate.getDay());
    $: weekDays = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate() + i, 12);
        const dateStr = d.toISOString().split('T')[0];
        const dayTasks = tasks.filter(t => !t.completed && t.due_date && t.due_date.startsWith(dateStr));
        return { dayNum: d.getDate(), dateStr, tasks: dayTasks, dateObj: d };
    });

    $: activeTasks = tasks.filter(t => !t.completed);
    $: agendaTasks = [...activeTasks].sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
    });

    let apiKeys = [];
    let newKeyName = '';
    let generatedCleartextKey = '';
    let showKeyModal = false;

    $: if (currentView === 'settings' && user) fetchApiKeys();

    onMount(async () => {
        // SERVICE WORKER REGISTRATION BLOCK
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js');
                console.log("Service Worker registered successfully:", registration);
                
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    console.log("New version detected. Reloading app...");
                    window.location.reload();
                });
            } catch (err) {
                console.error("Service worker registration failed:", err);
            }
        }

        await checkUser();
        if (user) {
            loadTasks();
            loadUsers();
            initSpeechRecognition();
        }
    });

    async function checkUser() { 
        const res = await fetch('/api/user'); 
        if (res.ok) {
            user = await res.json(); 
            try {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                fetch('/api/user/timezone', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ timezone: tz })
                }).catch(e => console.log("Timezone sync backgrounded"));
            } catch(e){}
        }
    }
    
    async function loadTasks() { const res = await fetch('/api/tasks'); if (res.ok) tasks = await res.json(); }
    async function loadUsers() { const res = await fetch('/api/users'); if (res.ok) allUsers = await res.json(); }

    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        editingTask.transcription = (editingTask.transcription || '') + event.results[i][0].transcript + ' ';
                        saveEdit();
                    }
                }
            };
        }
    }

    async function fetchApiKeys() {
        const res = await fetch('/api/settings/keys');
        if (res.ok) apiKeys = await res.json();
    }
    async function generateKey() {
        if (!newKeyName.trim()) return;
        const res = await fetch('/api/settings/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyName: newKeyName }) });
        if (res.ok) { const data = await res.json(); generatedCleartextKey = data.key; showKeyModal = true; newKeyName = ''; fetchApiKeys(); }
    }
    async function revokeKey(id) {
        if (!confirm("Wipe this system token?")) return;
        const res = await fetch(`/api/settings/keys/${id}`, { method: 'DELETE' });
        if (res.ok) fetchApiKeys();
    }

    let newTaskTitle = '';
    async function addTask() {
        if (!newTaskTitle.trim()) return;
        await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTaskTitle }) });
        newTaskTitle = '';
    }

    function isBlocked(task) {
        if (!task.predecessors || task.predecessors.length === 0) return false;
        let parsed = typeof task.predecessors === 'string' ? JSON.parse(task.predecessors) : task.predecessors;
        return parsed.some(pid => {
            const p = tasks.find(t => t.id === pid);
            return p && !p.completed;
        });
    }

    function getTaskName(id) {
        const t = tasks.find(t => t.id === id);
        return t ? t.title : 'Unknown Task';
    }
    
    function getUserName(id) {
        const u = allUsers.find(u => u.id === id);
        return u ? u.username : 'Unknown User';
    }

    async function toggleComplete(task) {
        if (isBlocked(task)) return;
        task.completed = !task.completed;
        tasks = [...tasks];
        
        let p = typeof task.predecessors === 'string' ? JSON.parse(task.predecessors) : (task.predecessors || []);
        let a = typeof task.assignees === 'string' ? JSON.parse(task.assignees) : (task.assignees || []);

        await fetch(`/api/tasks/${task.id}`, { 
            method: 'PUT', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({
                ...task,
                dueDate: task.due_date,
                predecessors: p,
                assignees: a,
                reminderTime: task.reminder_time,
                reminderFrequency: task.reminder_frequency
            }) 
        });
    }

    function openEdit(task) {
        editingTask = { 
            ...task,
            due_date: task.due_date ? task.due_date.split('T')[0] : '',
            predecessors: typeof task.predecessors === 'string' ? JSON.parse(task.predecessors) : (task.predecessors || []),
            assignees: typeof task.assignees === 'string' ? JSON.parse(task.assignees) : (task.assignees || []),
            reminder_time: task.reminder_time || '',
            reminder_frequency: task.reminder_frequency || 'daily'
        };
        showReminder = !!task.reminder_time;
        selectedDep = null;
        selectedAssignee = null;
        showAssignees = false;
        showDependencies = false;

        isStudyMode = false;
        isHeaderCollapsed = false;
    }

    function addDep() {
        if (selectedDep && !editingTask.predecessors.includes(selectedDep)) {
            editingTask.predecessors = [...editingTask.predecessors, selectedDep];
            selectedDep = null;
        }
    }
    function removeDep(id) { editingTask.predecessors = editingTask.predecessors.filter(pid => pid !== id); }
    
    function addAssignee() {
        if (selectedAssignee && !editingTask.assignees.includes(selectedAssignee)) {
            editingTask.assignees = [...editingTask.assignees, selectedAssignee];
            selectedAssignee = null;
        }
    }
    function removeAssignee(id) { editingTask.assignees = editingTask.assignees.filter(uid => uid !== id); }

    async function saveEdit() {
        await fetch(`/api/tasks/${editingTask.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...editingTask,
                dueDate: editingTask.due_date,
                predecessors: editingTask.predecessors,
                assignees: editingTask.assignees,
                reminderTime: showReminder && editingTask.reminder_time ? editingTask.reminder_time : null,
                reminderFrequency: showReminder && editingTask.reminder_frequency ? editingTask.reminder_frequency : null
            })
        });
        loadTasks();
    }

    function closeEdit() {
        if(isRecording) stopRecording();
        editingTask = null;
        isStudyMode = false;
        pdfDoc = null;
        isHeaderCollapsed = false;
        drawingMode = 'off';
        strokes = [];
    }

    function changeDate(dir) {
        if (calendarMode === 'month') currentDate = new Date(currentYear, currentMonth + dir, 1);
        else currentDate = new Date(currentYear, currentMonth, currentDate.getDate() + (dir * 7));
    }

    // --- V30.4 INFINITE CANVAS & HANDWRITING LOGIC ---
    function initPanzoom() {
        if (pzInstance) return; 
        const wrapper = document.getElementById('zoom-wrapper');
        if (!wrapper) return;

        pzInstance = window.panzoom(wrapper, {
            bounds: true,
            boundsPadding: 0.1,
            maxZoom: 5,
            minZoom: 0.5,
            beforeMouseDown: function(e) {
                if (drawingMode !== 'off' && !isPanning) {
                    return true; 
                }
                return false; 
            }
        });
    }

    async function handleModeSwitch() {
        await tick();
        
        if (drawingMode !== 'off') {
            initPanzoom();
        }

        if (drawingMode === 'fabric') {
            if (fabCanvas) fabCanvas.dispose();
            fabCanvas = new window.fabric.Canvas('fab-canvas', {
                isDrawingMode: true,
                width: pdfWidth,
                height: pdfHeight
            });
            fabCanvas.freeDrawingBrush.color = '#3b82f6';
            fabCanvas.freeDrawingBrush.width = 3;
        } else {
            if (fabCanvas) { fabCanvas.dispose(); fabCanvas = null; }
        }
    }

    function clearHandwriting() {
        if (drawingMode === 'svg') strokes = [];
        if (drawingMode === 'fabric' && fabCanvas) fabCanvas.clear();
    }

    function svgDown(e) {
        if (isPanning) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        currentPoints = [[e.offsetX, e.offsetY, e.pressure || 0.5]];
    }
    
    function svgMove(e) {
        if (isPanning || e.buttons !== 1 || currentPoints.length === 0) return;
        currentPoints = [...currentPoints, [e.offsetX, e.offsetY, e.pressure || 0.5]];
    }
    
    function svgUp(e) {
        if (isPanning || currentPoints.length === 0) return;
        strokes = [...strokes, currentPoints];
        currentPoints = [];
    }

    function getSvgPathFromStroke(stroke) {
        if (!stroke.length) return '';
        const d = stroke.reduce(
          (acc, [x0, y0], i, arr) => {
            const [x1, y1] = arr[(i + 1) % arr.length];
            acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
            return acc;
          },
          ['M', ...stroke[0], 'Q']
        );
        d.push('Z');
        return d.join(' ');
    }

    // --- PDF Loading ---
    async function openStudyMode() {
        isStudyMode = true;
        isHeaderCollapsed = true;
        drawingMode = 'off';
        isPanning = false;

        if (editingTask.slide_tracking) {
            slideTimeline = JSON.parse(editingTask.slide_tracking);
        } else {
            slideTimeline = [];
        }
        
        if (editingTask.pdf_url) {
            await tick(); 
            loadPdf(editingTask.pdf_url);
        }
    }

    async function loadPdf(url) {
        try {
            pdfDoc = await pdfjsLib.getDocument(url).promise;
            renderPage(1);
        } catch(e) { console.error("PDF Load Error", e); }
    }

    async function renderPage(num) {
        isRendering = true;
        pageNum = num;
        activePlaybackPage = num;
        
        if (!canvasRef) return; 

        const page = await pdfDoc.getPage(num);
        const viewport = page.getViewport({ scale: 1.5 });
        canvasRef.height = viewport.height;
        canvasRef.width = viewport.width;
        
        pdfWidth = viewport.width;
        pdfHeight = viewport.height;
        
        await page.render({ canvasContext: canvasRef.getContext('2d'), viewport: viewport }).promise;
        isRendering = false;

        if (isRecording) {
            const timeElapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
            slideTimeline.push({ time: timeElapsed, page: num });
            editingTask.slide_tracking = JSON.stringify(slideTimeline);
        }

        if (drawingMode === 'fabric' && fabCanvas) {
            fabCanvas.setWidth(pdfWidth);
            fabCanvas.setHeight(pdfHeight);
        }
    }

    async function uploadFileToDrive(file, type) {
        const formData = new FormData();
        formData.append('file', file, file.name || `recording_${Date.now()}.webm`);
        
        const tempUrl = URL.createObjectURL(file);
        if (type === 'pdf') {
            editingTask.pdf_url = tempUrl;
            await tick(); 
            loadPdf(tempUrl);
        } else if (type === 'audio') {
            editingTask.audio_url = tempUrl;
        }

        try {
            const res = await fetch('/api/drive/upload', { method: 'POST', body: formData });
            const data = await res.json();
            
            if (data.fileId) {
                if (type === 'pdf') {
                    editingTask.drive_pdf_id = data.fileId;
                    editingTask.pdf_url = `/api/drive/download/${data.fileId}`;
                }
                if (type === 'audio') {
                    editingTask.drive_audio_id = data.fileId;
                    editingTask.audio_url = `/api/drive/download/${data.fileId}`;
                }
                saveEdit();
            }
        } catch (e) { console.error("Drive upload failed", e); }
    }

    function handlePdfUpload(e) {
        const file = e.target.files[0];
        if (file) uploadFileToDrive(file, 'pdf');
    }

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                uploadFileToDrive(audioBlob, 'audio');
            };

            recordingStartTime = Date.now();
            slideTimeline = [{ time: 0, page: pageNum }];
            mediaRecorder.start();
            isRecording = true;
            
            if (recognition) {
                if (!editingTask.transcription) editingTask.transcription = '';
                editingTask.transcription += '\n--- Recording Started ---\n';
                recognition.start();
            }
        } catch (err) {
            console.error("Microphone access denied or failed", err);
            alert("Could not start recording. Please check microphone permissions.");
        }
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            isRecording = false;
            editingTask.slide_tracking = JSON.stringify(slideTimeline);
            saveEdit();
            if (recognition) recognition.stop();
        }
    }

    function handleAudioTimeUpdate(e) {
        const currentTime = e.target.currentTime;
        if (slideTimeline.length > 0 && !isRecording && !isRendering) {
            let targetedPage = slideTimeline[0].page;
            for (let point of slideTimeline) {
                if (currentTime >= point.time) {
                    targetedPage = point.page;
                }
            }
            if (activePlaybackPage !== targetedPage) {
                renderPage(targetedPage);
            }
        }
    }

    function renderPreview() {
        const previewEl = document.getElementById('md-preview');
        if (!previewEl || !editingTask) return;
        let txt = editingTask.description || '';
        txt = txt.replace(/\$\$([\s\S]*?)\$\$/g, (m, eq) => '<div class="katex-block-wrapper">' + window.katex.renderToString(eq.trim(), { displayMode: true, throwOnError: false }) + '</div>');
        txt = txt.replace(/\$([^\$\n]+?)\$/g, (m, eq) => window.katex.renderToString(eq.trim(), { displayMode: false, throwOnError: false }));
        if (window.marked) previewEl.innerHTML = window.marked.parse(txt);
    }
</script>

<main>
    <div class="container {isStudyMode ? 'study-expanded' : ''}">
        <div class="header {isHeaderCollapsed ? 'collapsed' : ''}">
            <div class="header-title-area">
                <h1>
                    Manifest 
                    {#if !isHeaderCollapsed}
                        <span>- v30 Studio</span>
                    {/if}
                    <span class="app-build-stamp">{appVersion}</span>
                </h1>
            </div>
            {#if user} 
                <div class="header-actions">
                    <button class="btn secondary small-btn" style="padding: 4px 8px; font-size: 0.75rem;" on:click={() => isHeaderCollapsed = !isHeaderCollapsed} title="Toggle Header">
                        {isHeaderCollapsed ? '⛶ Expand' : '🗕 Collapse'}
                    </button>
                    {#if !isHeaderCollapsed}
                        <button class="logout-btn" on:click={() => window.location.href='/auth/logout'}>Logout</button>
                    {/if}
                </div>
            {/if}
        </div>

        {#if user && !isStudyMode}
            <div class="view-tabs">
                <button class:active={currentView === 'list'} on:click={() => currentView = 'list'}>Task List</button>
                <button class:active={currentView === 'calendar'} on:click={() => currentView = 'calendar'}>Calendar</button>
                <button class:active={currentView === 'agenda'} on:click={() => currentView = 'agenda'}>Agenda</button>
                <button class:active={currentView === 'gantt'} on:click={() => currentView = 'gantt'}>Gantt</button>
                <button class:active={currentView === 'settings'} on:click={() => currentView = 'settings'}>Settings</button>
            </div>
        {/if}

        {#if !user}
            <div class="login-box">
                <p>Welcome! V30 requires Google Drive access to save your audio recordings and PDFs securely into the Manifest Ghost folder.</p>
                <a href="/auth/google" class="btn google-btn">Login with Google</a>
            </div>
        {:else if !isStudyMode && !editingTask}
            
            {#if currentView === 'list'}
                <div class="task-input">
                    <input type="text" bind:value={newTaskTitle} placeholder="New task..." />
                    <button class="add-btn" on:click={addTask}>+</button>
                </div>
                <ul class="task-list">
                    {#each activeTasks as task}
                        <li class="task-item {isBlocked(task) ? 'blocked' : ''}">
                            <input type="checkbox" disabled={isBlocked(task)} checked={task.completed} on:change={() => toggleComplete(task)} />
                            <div class="task-content" on:click={() => openEdit(task)}>
                                <span class="task-title">{task.title}</span>
                                {#if isBlocked(task)}<span class="badge warning" title="Waiting on predecessor">🔒 Blocked</span>{/if}
                            </div>
                        </li>
                    {/each}
                </ul>

            {:else if currentView === 'calendar'}
                <div class="calendar">
                    <div class="cal-controls">
                        <div class="cal-view-toggles">
                            <button class:active={calendarMode==='month'} on:click={() => calendarMode='month'}>Month</button>
                            <button class:active={calendarMode==='week'} on:click={() => calendarMode='week'}>Week</button>
                        </div>
                        <div class="cal-nav">
                            <button on:click={() => changeDate(-1)}>◀ Prev</button>
                            <div class="cal-header-title">
                                <h3>
                                    {#if calendarMode === 'month'}
                                        {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                                    {:else}
                                        Week of {currentWeekStart.toLocaleDateString()}
                                    {/if}
                                </h3>
                            </div>
                            <button on:click={() => changeDate(1)}>Next ▶</button>
                        </div>
                    </div>
                    
                    {#if calendarMode === 'month'}
                        <div class="cal-grid">
                            {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as day}<div class="cal-header-cell">{day}</div>{/each}
                            {#each Array(firstDayOfMonth) as _}<div class="cal-cell empty"></div>{/each}
                            {#each Array(daysInMonth) as _, i}
                                <div class="cal-cell">
                                    <div class="day-num">{i + 1}</div>
                                    {#each activeTasks.filter(t => t.due_date && new Date(t.due_date).getDate() === (i+1) && new Date(t.due_date).getMonth() === currentMonth) as t}
                                        <div class="mini-task {isBlocked(t) ? 'blocked' : ''}" on:click={() => openEdit(t)}>{t.title}</div>
                                    {/each}
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <div class="cal-grid week-grid">
                            {#each weekDays as wd}
                                <div class="cal-cell">
                                    <div class="day-header">{wd.dateObj.toLocaleString('default', {weekday: 'short'})} {wd.dayNum}</div>
                                    {#each wd.tasks as t}
                                        <div class="mini-task {isBlocked(t) ? 'blocked' : ''}" on:click={() => openEdit(t)}>{t.title}</div>
                                    {/each}
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>

            {:else if currentView === 'agenda'}
                <div class="agenda-view">
                    <h2>Agenda Timeline</h2>
                    {#if agendaTasks.length === 0} <p class="empty" style="color:#666; font-style:italic;">No tasks on the agenda.</p> {/if}
                    {#each agendaTasks as task}
                        <div class="agenda-item {task.completed ? 'completed' : ''} {isBlocked(task) ? 'blocked' : ''}" on:click={() => openEdit(task)}>
                            <div class="agenda-date">
                                {#if task.due_date}
                                    <span class="day">{new Date(task.due_date).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
                                    <span class="date">{new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
                                {:else}
                                    <span class="no-date">Anytime</span>
                                {/if}
                            </div>
                            <div class="agenda-content"> 
                                <span class="task-title">{task.title}</span> 
                                <div class="agenda-badges">
                                    {#if isBlocked(task)}<span class="badge warning">🔒 Blocked</span>{/if}
                                    {#if task.reminder_time}<span class="badge">⏰ {task.reminder_time}</span>{/if}
                                </div>
                            </div>
                        </div>
                    {/each}
                </div>

            {:else if currentView === 'gantt'}
                <div class="gantt-view">
                    <h2>Project Timeline</h2>
                    {#if activeTasks.length === 0} <p>No tasks to map.</p> {/if}
                    {#each activeTasks as task}
                        <div class="gantt-row {isBlocked(task) ? 'blocked' : ''}">
                            <div class="gantt-label">
                                {#if isBlocked(task)}🔒 {/if}{task.title}
                            </div>
                            <div class="gantt-bar"></div>
                        </div>
                    {/each}
                </div>

            {:else if currentView === 'settings'}
                <div class="settings-card">
                    <h2>Account & Billing</h2>
                    <p>Plan: <strong>{user?.plan_type ? user.plan_type.toUpperCase() : 'FREE'}</strong></p>
                    {#if user?.plan_type !== 'pro'}
                        <button class="btn primary" on:click={async () => { const res = await fetch('/api/checkout', {method:'POST'}); const d = await res.json(); if(d.url) window.location.href = d.url; }}>Upgrade to Pro Server Tier</button>
                    {/if}
                </div>

                <div class="settings-card" style="margin-top: 20px;">
                    <h2>API Integrations (Power Automate)</h2>
                    <div class="task-input">
                        <input type="text" bind:value={newKeyName} placeholder="Key description..." style="padding:10px; background:#111; border:1px solid #333; color:white; border-radius:4px; flex:1;" />
                        <button class="btn primary" on:click={generateKey}>Generate</button>
                    </div>
                    {#if apiKeys.length > 0}
                        <ul class="task-list" style="margin-top:15px;">
                            {#each apiKeys as k}
                                <li class="task-item" style="justify-content: space-between; padding: 10px;">
                                    <div>{k.key_name} <span style="color:#666; font-size:0.8rem; margin-left:10px;">{new Date(k.created_at).toLocaleDateString()}</span></div>
                                    <button class="btn secondary" style="background:#5c1a1a; color:#ff8a8a; border: 1px solid #822222; font-size:0.8rem;" on:click={() => revokeKey(k.id)}>Revoke</button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </div>
            {/if}
        {/if}

        {#if editingTask && !isStudyMode}
            <div class="modal-overlay">
                <div class="modal">
                    <h2>Edit Task</h2>
                    <input class="full-width" type="text" bind:value={editingTask.title} style="padding:10px; background:#111; border:1px solid #333; color:white; margin-bottom:15px; border-radius:4px;"/>
                    
                    <div class="modal-row" style="justify-content: space-between; margin-bottom: 10px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <label style="color:#aaa; font-size:0.9rem;">Due Date:</label>
                            <input type="date" bind:value={editingTask.due_date} style="background:#111; border:1px solid #333; color:white; border-radius:4px; padding:5px;"/>
                        </div>
                        <button class="btn secondary small-btn" on:click={() => showReminder = !showReminder} title="Set Recurring Reminder">
                            ⏰ {showReminder ? 'Remove Reminder' : 'Add Reminder'}
                        </button>
                    </div>

                    {#if showReminder}
                        <div class="reminder-box">
                            <label>Remind me at:</label>
                            <input type="time" bind:value={editingTask.reminder_time} />
                            <select bind:value={editingTask.reminder_frequency} style="margin-left: 10px; width: auto; background:#111; border:1px solid #333; color:white; padding:5px;">
                                <option value="daily">Every Day</option>
                                <option value="weekdays">Every Weekday (Mon-Fri)</option>
                                <option value="weekends">Every Weekend (Sat-Sun)</option>
                            </select>
                        </div>
                    {/if}

                    <div class="modal-section">
                        <button class="section-toggle" on:click={() => showAssignees = !showAssignees}>
                            <span>Assigned To (Shared Users)</span>
                            <span class="chevron">{showAssignees ? '▼' : '▶'}</span>
                        </button>
                        {#if showAssignees}
                            <div class="section-content">
                                <div class="dep-list">
                                    {#if editingTask.assignees.length === 0}
                                        <span style="color: #666; font-size: 0.85rem; font-style: italic;">Private (Only you)</span>
                                    {/if}
                                    {#each editingTask.assignees as uid}
                                        <span class="dep-badge shared-badge">
                                            {getUserName(uid)} 
                                            <button class="remove-dep" on:click={() => removeAssignee(uid)}>x</button>
                                        </span>
                                    {/each}
                                </div>
                                <div class="add-dep">
                                    <select bind:value={selectedAssignee} style="flex:1; background:#111; border:1px solid #333; color:white; padding:5px;">
                                        <option value={null}>-- Select user to share with --</option>
                                        {#each allUsers.filter(u => u.id !== editingTask.user_id && !editingTask.assignees.includes(u.id)) as u}
                                            <option value={u.id}>{u.username}</option>
                                        {/each}
                                    </select>
                                    <button class="btn secondary" on:click={addAssignee}>Add</button>
                                </div>
                            </div>
                        {/if}
                    </div>

                    <div class="modal-section" style="margin-bottom: 15px;">
                        <button class="section-toggle" on:click={() => showDependencies = !showDependencies}>
                            <span>Depends on (Predecessors)</span>
                            <span class="chevron">{showDependencies ? '▼' : '▶'}</span>
                        </button>
                        {#if showDependencies}
                            <div class="section-content">
                                <div class="dep-list">
                                    {#if editingTask.predecessors.length === 0}
                                        <span style="color: #666; font-size: 0.85rem; font-style: italic;">No dependencies.</span>
                                    {/if}
                                    {#each editingTask.predecessors as pid}
                                        <span class="dep-badge">
                                            {getTaskName(pid)} 
                                            <button class="remove-dep" on:click={() => removeDep(pid)}>x</button>
                                        </span>
                                    {/each}
                                </div>
                                <div class="add-dep">
                                    <select bind:value={selectedDep} style="flex:1; background:#111; border:1px solid #333; color:white; padding:5px;">
                                        <option value={null}>-- Select a prerequisite task --</option>
                                        {#each tasks.filter(t => t.id !== editingTask.id && !editingTask.predecessors.includes(t.id)) as t}
                                            <option value={t.id}>{t.title} {t.completed ? '(Done)' : ''}</option>
                                        {/each}
                                    </select>
                                    <button class="btn secondary" on:click={addDep}>Add</button>
                                </div>
                            </div>
                        {/if}
                    </div>

                    <div class="study-launch-banner">
                        <p>Want to write LaTeX notes alongside an Audio Transcription?</p>
                        <button class="btn primary full-width" on:click={openStudyMode}>📚 Open Study Mode (Attach PDF & Audio)</button>
                    </div>

                    <div class="modal-actions">
                        <button class="btn secondary" on:click={closeEdit}>Cancel</button>
                        <button class="btn primary" on:click={() => {saveEdit(); closeEdit();}}>Save</button>
                    </div>
                </div>
            </div>
        {/if}

        {#if showKeyModal}
            <div class="modal-overlay" style="z-index: 200;">
                <div class="modal" style="border-color: #f59e0b;">
                    <h2 style="color: #f59e0b;">Secret Key Generated</h2>
                    <div style="background:#000; padding:15px; color:#10b981; font-family:monospace; word-break:break-all; border-radius:4px; margin: 15px 0;">{generatedCleartextKey}</div>
                    <button class="btn primary full-width" on:click={() => {showKeyModal = false; generatedCleartextKey = '';}}>I Have Copied The Key</button>
                </div>
            </div>
        {/if}

        {#if isStudyMode}
            <div class="study-workspace">
                <div class="study-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <input class="ws-title-input" type="text" bind:value={editingTask.title} placeholder="Document Title" style="background:transparent; border:none; border-bottom:1px solid #333; color:white; font-size:1.4rem; font-weight:bold; width:60%; padding:8px 0;" on:input={saveEdit} />
                    <button class="btn secondary" on:click={closeEdit}>Exit Study Mode</button>
                </div>

                <div class="study-layout-container {isHeaderCollapsed ? 'maximized' : ''}">
                    <div class="study-sidebar">
                        <div class="pane-header">Audio & Transcript</div>
                        
                        <div class="audio-controls">
                            {#if !isRecording}
                                <button class="btn action-btn record-btn" on:click={startRecording}>🔴 Record</button>
                            {:else}
                                <button class="btn action-btn stop-btn" on:click={stopRecording}>⏹ Stop (Saves)</button>
                            {/if}
                        </div>
                        {#if editingTask.audio_url}
                            <div style="margin-bottom: 15px;">
                                <audio controls class="audio-player" src={editingTask.audio_url} on:timeupdate={handleAudioTimeUpdate}></audio>
                            </div>
                        {/if}
                        
                        <div class="transcript-box" id="transcript-scroll-box">
                            <p class="section-label" style="font-size:0.75rem; margin-bottom:8px;">Live Transcription</p>
                            <textarea class="transcription-box" bind:value={editingTask.transcription} on:input={saveEdit} placeholder="Your live speech will appear here..."></textarea>
                        </div>
                    </div>

                    <div class="study-main-workspace">
                        <div class="pdf-panel">
                            <div class="panel-tools" style="display:flex; flex-direction:column; gap:10px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                                    {#if !editingTask.pdf_url}
                                        <label class="upload-btn">
                                            Upload PDF to Drive
                                            <input type="file" accept="application/pdf" style="display:none;" on:change={handlePdfUpload} />
                                        </label>
                                    {:else}
                                        <div class="pdf-nav">
                                            <button on:click={() => renderPage(pageNum-1)} disabled={pageNum<=1}>Prev Slide</button>
                                            <span style="font-weight: bold; color: #a5b4fc;">Slide {pageNum}</span>
                                            <button on:click={() => renderPage(pageNum+1)} disabled={!pdfDoc || pageNum >= pdfDoc.numPages}>Next Slide</button>
                                        </div>
                                    {/if}
                                </div>
                                
                                {#if editingTask.pdf_url}
                                    <div class="hw-tools" style="display:flex; gap:10px; align-items:center; border-top: 1px solid #333; padding-top: 10px;">
                                        <select bind:value={drawingMode} on:change={handleModeSwitch} style="background:#222; color:white; border:1px solid #444; padding:6px; border-radius:4px; font-size:0.85rem;">
                                            <option value="off">Mode: Read-Only</option>
                                            <option value="svg">Mode: Perfect Freehand (Vector)</option>
                                            <option value="fabric">Mode: Fabric.js (Canvas)</option>
                                        </select>

                                        {#if drawingMode !== 'off'}
                                            <button class="btn {isPanning ? 'secondary' : 'primary'} small-btn" style="padding:6px;" on:click={() => isPanning = false}>✏️ Draw</button>
                                            <button class="btn {isPanning ? 'primary' : 'secondary'} small-btn" style="padding:6px;" on:click={() => isPanning = true}>🖐 Pan Workspace</button>
                                            <button class="btn secondary small-btn" style="padding:6px; margin-left:auto;" on:click={clearHandwriting}>🗑️ Clear Ink</button>
                                        {/if}
                                    </div>
                                {/if}
                            </div>
                            
                            <div class="canvas-container" bind:this={pdfContainerRef}>
                                <div id="zoom-wrapper" style="position: relative; transform-origin: 0 0;">
                                    <canvas bind:this={canvasRef} class="pdf-base-layer"></canvas>
                                    
                                    {#if drawingMode === 'svg'}
                                        <svg 
                                            class="drawing-layer svg-layer"
                                            style="width: {pdfWidth}px; height: {pdfHeight}px; pointer-events: {isPanning ? 'none' : 'auto'};"
                                            on:pointerdown={svgDown}
                                            on:pointermove={svgMove}
                                            on:pointerup={svgUp}
                                            on:pointerleave={svgUp}
                                        >
                                            {#each strokes as stroke}
                                                <path d={getSvgPathFromStroke(window.perfectFreehand.getStroke(stroke, { size: 6, thinning: 0.5, smoothing: 0.5 }))} fill="#3b82f6" />
                                            {/each}
                                            {#if currentPoints.length > 0}
                                                <path d={getSvgPathFromStroke(window.perfectFreehand.getStroke(currentPoints, { size: 6, thinning: 0.5, smoothing: 0.5 }))} fill="#3b82f6" />
                                            {/if}
                                        </svg>
                                    {/if}

                                    {#if drawingMode === 'fabric'}
                                        <div class="drawing-layer fabric-layer" style="width: {pdfWidth}px; height: {pdfHeight}px; pointer-events: {isPanning ? 'none' : 'auto'};">
                                            <canvas id="fab-canvas"></canvas>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        </div>

                        <div class="notes-block">
                            <p class="section-label" style="font-size:0.75rem;">LaTeX / Markdown Notes</p>
                            <div style="display:flex; gap:15px; flex:1; min-height:0;">
                                <textarea bind:value={editingTask.description} on:input={() => { saveEdit(); renderPreview(); }} placeholder="Type your notes here..."></textarea>
                                <div id="md-preview" class="markdown-body"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        {/if}
    </div>
</main>

<style>
    :global(body) { background: #0c0c0c; color: #e2e8f0; font-family: system-ui, sans-serif; margin: 0; padding: 0; }
    main { padding: 20px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 900px; background: #141414; padding: 25px; border-radius: 10px; border: 1px solid #222; }
    .study-expanded { max-width: 1500px; height: 95vh; display: flex; flex-direction: column; overflow: hidden; }
    
    .header { transition: all 0.3s ease; overflow: hidden; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #232323; padding-bottom: 15px; margin-bottom: 20px; }
    .header.collapsed { padding-bottom: 5px; margin-bottom: 10px; border-bottom: 1px solid #222; }
    .header.collapsed h1 { font-size: 1.1rem; color: #888; margin: 0; }
    .header-title-area h1 { margin: 0; font-size: 1.5rem; display: flex; align-items: center; }
    .header-title-area h1 span { color: #777; font-weight: normal; font-size: 1.2rem; }
    .header.collapsed h1 span { font-size: 1rem; }
    .header-actions { display: flex; align-items: center; gap: 15px; }
    
    /* SUBDUED VERSION STAMP STYLE */
    .app-build-stamp {
        font-size: 0.6rem;
        font-family: monospace;
        color: #555;
        background: #1a1a1a;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 10px;
        font-weight: normal;
        letter-spacing: 0.5px;
        border: 1px solid #2a2a2a;
        user-select: none;
    }
    .header.collapsed .app-build-stamp {
        font-size: 0.55rem;
        padding: 1px 4px;
        margin-left: 6px;
    }

    .view-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid #222; padding-bottom: 12px; }
    .view-tabs button { background: none; border: none; color: #777; padding: 8px 16px; cursor: pointer; font-weight: 600; }
    .view-tabs button.active { background: #222; color: #fff; border-radius: 4px; }
    
    .btn { padding: 10px 15px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; transition: 0.2s; }
    .btn.primary { background: #646cff; color: white; }
    .btn.secondary { background: #333; color: white; }
    .btn.secondary:hover { background: #444; }
    .full-width { width: 100%; box-sizing: border-box; }
    
    .login-box { text-align: center; padding: 40px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; }
    .google-btn { display: inline-block; background: #4285f4; color: white; text-decoration: none; padding: 10px 20px; border-radius: 4px; font-weight: 500; margin-top: 15px; }
    .logout-btn { background: #333; color: #ccc; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; }

    .task-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .task-input input { flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #333; color: white; border-radius: 4px; }
    .add-btn { background: #646cff; color: white; border: none; padding: 0 20px; font-size: 1.5rem; border-radius: 4px; }
    .task-list { list-style: none; padding: 0; margin: 0; }
    .task-item { display: flex; align-items: center; gap: 15px; background: #1a1a1a; padding: 15px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #222; cursor: pointer; }
    .task-item.blocked { opacity: 0.5; }

    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100; overflow-y: auto;}
    .modal { background: #1a1a1a; padding: 25px; border-radius: 8px; width: 450px; border: 1px solid #333; margin: auto;}
    .study-launch-banner { background: #1f1f3a; padding: 15px; border-radius: 6px; margin: 20px 0; border: 1px solid #2a2a5a; text-align: center; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

    .badge { background: #555; color: #ddd; font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; white-space: nowrap; margin-left:10px; }
    .badge.warning { background: #8a6a00; font-weight: bold; }
    .reminder-box { display: flex; align-items: center; background: #2a2a2a; padding: 10px 15px; border-radius: 6px; border-left: 3px solid #f1c40f; margin-bottom: 15px; }
    .reminder-box label { font-size: 0.9rem; margin-right: 10px; color:#aaa;}
    .modal-section { background: #111; padding: 12px; border-radius: 6px; border: 1px solid #222; margin-top: 10px;}
    .section-toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; background: transparent; border: none; color: #aaa; font-size: 0.9rem; font-weight: bold; padding: 0; cursor: pointer;}
    .section-content { margin-top: 10px; border-top: 1px solid #222; padding-top: 10px; display: flex; flex-direction: column; gap: 10px; }
    .chevron { font-size: 0.8rem; color: #666; }
    .dep-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .dep-badge { background: #333; border: 1px solid #555; padding: 5px 10px; border-radius: 6px; font-size: 0.85rem; display: flex; align-items: center; gap: 8px; color: #ddd; }
    .shared-badge { background: #1b4332; border-color: #2d6a4f; }
    .remove-dep { background: transparent; border: none; color: #ff5555; cursor: pointer; font-weight: bold; padding: 0 4px; font-size: 1rem; }
    .add-dep { display: flex; gap: 8px; }

    .cal-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
    .cal-view-toggles button { background: #111; color: #888; border: 1px solid #333; padding: 5px 15px; border-radius: 4px; cursor: pointer;}
    .cal-view-toggles button.active { background: #646cff; color: white; border-color: #646cff; }
    .cal-nav { display: flex; align-items: center; gap: 15px; }
    .cal-nav button { background: #333; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; }
    .cal-header-title { min-width: 180px; text-align: center; }
    
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
    .cal-header-cell { text-align: center; font-weight: bold; color: #888; padding-bottom: 10px; }
    .cal-cell { background: #1a1a1a; min-height: 80px; padding: 5px; border-radius: 4px; display: flex; flex-direction: column;}
    .cal-cell.empty { background: transparent; }
    .day-num { text-align: right; color: #666; font-size: 0.8rem; margin-bottom: 5px;}
    .day-header { text-align: center; font-weight: bold; color: #888; font-size: 0.85rem; padding-bottom: 5px; border-bottom: 1px solid #333; margin-bottom: 5px; }
    .mini-task { background: #646cff; color: white; font-size: 0.7rem; padding: 3px 5px; border-radius: 2px; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .mini-task.blocked { background: #8a6a00; opacity: 0.8; }

    .agenda-view { background: #1a1a1a; padding: 20px; border-radius: 8px; }
    .agenda-item { display: flex; align-items: center; background: #111; border: 1px solid #222; padding: 12px; margin-bottom: 10px; border-radius: 6px; border-left: 4px solid #646cff; }
    .agenda-item.blocked { opacity: 0.5; border-left-color: #8a6a00;}
    .agenda-date { min-width: 80px; display: flex; flex-direction: column; align-items: center; padding-right: 15px; border-right: 1px solid #333; margin-right: 15px; }
    .agenda-date .date { font-size: 1.1rem; font-weight: bold; color: #eee; }
    .gantt-view { background: #1a1a1a; padding: 20px; border-radius: 8px; }
    .gantt-row { display: flex; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #222; padding-bottom: 10px; }
    .gantt-row.blocked .gantt-bar { background: #8a6a00; opacity: 0.5; }
    .gantt-label { width: 150px; font-weight: bold; }
    .gantt-bar { height: 20px; background: #646cff; border-radius: 10px; width: 60%; }

    .settings-card { background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid #222; }

    .study-workspace { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .study-layout-container { display: flex; gap: 20px; width: 100%; flex: 1; transition: flex 0.3s ease; min-height: 0; }

    .study-sidebar { width: 280px; flex-shrink: 0; display: flex; flex-direction: column; background: #161616; border: 1px solid #333; border-radius: 8px; padding: 15px; box-sizing: border-box; overflow: hidden; }
    .pane-header { font-size: 0.8rem; font-weight: bold; color: #666; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 6px; border-bottom: 1px solid #222; margin-bottom: 15px; }
    .audio-controls { display: flex; gap: 10px; margin-bottom: 15px; }
    .btn.action-btn { flex: 1; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; border: none; text-align: center; transition: 0.2s; }
    .record-btn { background: #e11d48; color: white; }
    .record-btn:hover { background: #f43f5e; }
    .stop-btn { background: #475569; color: white; }
    .stop-btn:hover { background: #64748b; }
    .audio-player { width: 100%; height: 35px; border-radius: 4px; }
    
    .transcript-box { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .transcription-box { flex: 1; background: #0f172a; border: 1px solid #1e293b; color: #94a3b8; padding: 12px; border-radius: 6px; font-family: inherit; resize: none; width: 100%; box-sizing: border-box; line-height: 1.5; outline: none;}
    .transcription-box:focus { border-color: #646cff; }

    .study-main-workspace { flex: 1; display: flex; flex-direction: column; gap: 15px; min-width: 0; overflow: hidden; }
    .pdf-panel { flex: 3; display: flex; flex-direction: column; background: #080808; border-radius: 8px; border: 1px solid #333; overflow: hidden; min-height: 0; }
    .panel-tools { padding: 12px; background: #161616; border-bottom: 1px solid #333; display: flex; justify-content: center;}
    .pdf-nav { display: flex; align-items: center; gap: 15px; }
    .pdf-nav button { background: #2a2a3a; color: white; border: 1px solid #4a4a6a; padding: 6px 15px; border-radius: 4px; font-weight: bold; cursor: pointer; }
    .pdf-nav button:hover:not(:disabled) { background: #3f3f5a; }
    .pdf-nav button:disabled { opacity: 0.5; cursor: not-allowed; }
    
    .canvas-container { flex: 1; overflow: hidden; display: flex; justify-content: center; align-items: center; padding: 15px; background: #111; cursor: grab;}
    .canvas-container:active { cursor: grabbing; }
    .pdf-base-layer { display: block; background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.8); border-radius: 4px; max-width: 100%; object-fit: contain; }
    
    .drawing-layer { position: absolute; top: 0; left: 0; touch-action: none; z-index: 10; }
    .svg-layer { z-index: 11; }
    .fabric-layer { z-index: 12; }

    .notes-block { flex: 2; display: flex; flex-direction: column; background: #161616; padding: 15px; border-radius: 8px; border: 1px solid #333; min-height: 0; }
    .notes-block textarea { flex: 1; background: #111; color: white; border: 1px solid #333; padding: 15px; border-radius: 6px; font-family: inherit; resize: none; line-height: 1.5; outline: none; }
    .notes-block textarea:focus { border-color: #646cff; }
    .markdown-body { flex: 1; padding: 15px; background: #111; border-radius: 6px; border: 1px solid #333; overflow-y: auto; line-height: 1.6; }
    .upload-btn { background: #646cff; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; color: white; transition: 0.2s; }
    .upload-btn:hover { background: #747bff; }
</style>