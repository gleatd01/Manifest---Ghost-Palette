<script>
    import { onMount } from 'svelte';
    import { io } from 'socket.io-client';
    import * as pdfjsLib from 'pdfjs-dist';

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    let user = null;
    let tasks = [];
    
    // Core v20 Nav Tabs + Agenda and Gantt
    let currentView = 'list'; // 'list', 'calendar', 'agenda', 'gantt', 'settings'
    let editingTask = null;
    
    // Study Mode Variables (Task-Level)
    let isStudyMode = false;
    let canvasRef;
    let pdfDoc = null;
    let pageNum = 1;
    let isRendering = false;

    // Calendar UI State (Restored Month / Week Toggle)
    let calendarMode = 'month'; // 'month' or 'week'
    let currentDate = new Date();
    
    // Reactive Calendar Month Calculations
    $: currentMonth = currentDate.getMonth();
    $: currentYear = currentDate.getFullYear();
    $: daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    $: firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
    
    // Reactive Calendar Week Calculations
    $: currentWeekStart = new Date(currentYear, currentMonth, currentDate.getDate() - currentDate.getDay());
    $: weekDays = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate() + i, 12);
        const dateStr = d.toISOString().split('T')[0];
        const dayTasks = tasks.filter(t => !t.completed && t.due_date && t.due_date.startsWith(dateStr));
        return { dayNum: d.getDate(), dateStr, tasks: dayTasks, dateObj: d };
    });

    $: activeTasks = tasks.filter(t => !t.completed);

    // Reactive Agenda Sorting
    $: agendaTasks = [...activeTasks].sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
    });

    // Settings & API Keys (Restored)
    let apiKeys = [];
    let newKeyName = '';
    let generatedCleartextKey = '';
    let showKeyModal = false;

    $: if (currentView === 'settings' && user) fetchApiKeys();

    onMount(async () => {
        await checkUser();
        if (user) {
            await loadTasks();
            const socket = io();
            socket.on('workspace-update', async () => await loadTasks());
        }
    });

    async function checkUser() { const res = await fetch('/api/user'); if (res.ok) user = await res.json(); }
    async function loadTasks() { const res = await fetch('/api/tasks'); if (res.ok) tasks = await res.json(); }

    // API Key Logic
    async function fetchApiKeys() {
        const res = await fetch('/api/settings/keys');
        if (res.ok) apiKeys = await res.json();
    }
    async function generateKey() {
        if (!newKeyName.trim()) return;
        const res = await fetch('/api/settings/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyName: newKeyName })
        });
        if (res.ok) {
            const data = await res.json();
            generatedCleartextKey = data.key;
            showKeyModal = true;
            newKeyName = '';
            fetchApiKeys();
        }
    }
    async function revokeKey(id) {
        if (!confirm("Wipe this system token?")) return;
        const res = await fetch(`/api/settings/keys/${id}`, { method: 'DELETE' });
        if (res.ok) fetchApiKeys();
    }

    // Task Logic
    let newTaskTitle = '';
    async function addTask() {
        if (!newTaskTitle.trim()) return;
        await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTaskTitle }) });
        newTaskTitle = '';
    }

    async function toggleComplete(task) {
        task.completed = !task.completed;
        tasks = [...tasks];
        await fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task) });
    }

    function openEdit(task) {
        editingTask = { ...task };
        isStudyMode = false;
    }

    async function saveEdit() {
        await fetch(`/api/tasks/${editingTask.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(editingTask)
        });
        loadTasks();
    }

    function closeEdit() {
        editingTask = null;
        isStudyMode = false;
        pdfDoc = null;
    }

    // Calendar Navigation
    function changeDate(dir) {
        if (calendarMode === 'month') {
            currentDate = new Date(currentYear, currentMonth + dir, 1);
        } else {
            currentDate = new Date(currentYear, currentMonth, currentDate.getDate() + (dir * 7));
        }
    }

    // --- Study Mode Logic ---
    function openStudyMode() {
        isStudyMode = true;
        if (editingTask.pdf_url) {
            setTimeout(() => loadPdf(editingTask.pdf_url), 100);
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
        const page = await pdfDoc.getPage(num);
        const viewport = page.getViewport({ scale: 1.5 });
        canvasRef.height = viewport.height;
        canvasRef.width = viewport.width;
        await page.render({ canvasContext: canvasRef.getContext('2d'), viewport: viewport }).promise;
        isRendering = false;
    }

    function handlePdfUpload(e) {
        const file = e.target.files[0];
        if (file) {
            editingTask.pdf_url = URL.createObjectURL(file);
            saveEdit();
            loadPdf(editingTask.pdf_url);
        }
    }

    function handleAudioUpload(e) {
        const file = e.target.files[0];
        if (file) {
            editingTask.audio_url = URL.createObjectURL(file);
            saveEdit();
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
        <div class="header">
            <h1>Manifest <span>- v27 Final UI Restoration</span></h1>
            {#if user} <button class="logout-btn" on:click={() => window.location.href='/auth/logout'}>Logout</button> {/if}
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
            <div class="login-box"><a href="/auth/google" class="btn google-btn">Login with Google</a></div>
        {:else if !isStudyMode && !editingTask}
            
            {#if currentView === 'list'}
                <div class="task-input">
                    <input type="text" bind:value={newTaskTitle} placeholder="New task..." />
                    <button class="add-btn" on:click={addTask}>+</button>
                </div>
                <ul class="task-list">
                    {#each activeTasks as task}
                        <li class="task-item">
                            <input type="checkbox" checked={task.completed} on:change={() => toggleComplete(task)} />
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <div class="task-content" on:click={() => openEdit(task)}>{task.title}</div>
                        </li>
                    {/each}
                </ul>

            {:else if currentView === 'calendar'}
                <div class="calendar">
                    <!-- RESTORED: Month / Week View Toggles & Header -->
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
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <div class="mini-task" on:click={() => openEdit(t)}>{t.title}</div>
                                    {/each}
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <!-- Week View Grid -->
                        <div class="cal-grid week-grid">
                            {#each weekDays as wd}
                                <div class="cal-cell">
                                    <div class="day-header">{wd.dateObj.toLocaleString('default', {weekday: 'short'})} {wd.dayNum}</div>
                                    {#each wd.tasks as t}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <div class="mini-task" on:click={() => openEdit(t)}>{t.title}</div>
                                    {/each}
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>

            {:else if currentView === 'agenda'}
                <!-- RESTORED: Agenda View -->
                <div class="agenda-view">
                    <h2>Agenda Timeline</h2>
                    {#if agendaTasks.length === 0}
                        <p class="empty" style="color:#666; font-style:italic;">No tasks on the agenda.</p>
                    {/if}
                    {#each agendaTasks as task}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <div class="agenda-item {task.completed ? 'completed' : ''}" on:click={() => openEdit(task)}>
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
                            </div>
                        </div>
                    {/each}
                </div>

            {:else if currentView === 'gantt'}
                <div class="gantt-view">
                    <h2>Project Timeline</h2>
                    {#if activeTasks.length === 0} <p>No tasks to map.</p> {/if}
                    {#each activeTasks as task}
                        <div class="gantt-row">
                            <div class="gantt-label">{task.title}</div>
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

                <!-- RESTORED: API Key Power Automate Section -->
                <div class="settings-card" style="margin-top: 20px;">
                    <h2>API Integrations (Power Automate)</h2>
                    <p style="font-size: 0.9rem; color: #888;">Generate keys for stateless system access.</p>
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
                    <p style="font-size:0.9rem; color:#ccc;">Copy this key now. It will never be shown again.</p>
                    <div style="background:#000; padding:15px; color:#10b981; font-family:monospace; word-break:break-all; border-radius:4px; margin: 15px 0;">{generatedCleartextKey}</div>
                    <button class="btn primary full-width" on:click={() => {showKeyModal = false; generatedCleartextKey = '';}}>I Have Copied The Key</button>
                </div>
            </div>
        {/if}

        {#if isStudyMode}
            <div class="study-workspace">
                <div class="study-header">
                    <h2>Study Mode: {editingTask.title}</h2>
                    <button class="btn secondary" on:click={closeEdit}>Exit Study Mode</button>
                </div>

                <div class="split-layout">
                    <div class="pdf-panel">
                        <div class="panel-tools">
                            {#if !editingTask.pdf_url}
                                <label>Upload PDF: <input type="file" accept="application/pdf" on:change={handlePdfUpload} /></label>
                            {:else}
                                <div class="pdf-nav">
                                    <button on:click={() => renderPage(pageNum-1)} disabled={pageNum<=1}>Prev</button>
                                    <span>Page {pageNum}</span>
                                    <button on:click={() => renderPage(pageNum+1)} disabled={!pdfDoc || pageNum >= pdfDoc.numPages}>Next</button>
                                </div>
                            {/if}
                        </div>
                        <div class="canvas-container">
                            <canvas bind:this={canvasRef}></canvas>
                        </div>
                    </div>

                    <div class="transcript-panel">
                        <div class="audio-block">
                            {#if !editingTask.audio_url}
                                <label>Upload Lecture Audio: <input type="file" accept="audio/*" on:change={handleAudioUpload} /></label>
                            {:else}
                                <audio controls class="audio-player" src={editingTask.audio_url}></audio>
                            {/if}
                        </div>
                        
                        <div class="notes-block">
                            <p class="section-label">Audio Transcription</p>
                            <textarea bind:value={editingTask.transcription} on:input={saveEdit} placeholder="Transcription text goes here..."></textarea>
                            
                            <p class="section-label">LaTeX / Markdown Notes</p>
                            <textarea bind:value={editingTask.description} on:input={() => { saveEdit(); renderPreview(); }} placeholder="Type your notes here..."></textarea>
                            <div id="md-preview" class="markdown-body"></div>
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
    .study-expanded { max-width: 1500px; height: 90vh; display: flex; flex-direction: column; }
    
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #232323; padding-bottom: 15px; margin-bottom: 20px; }
    .view-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid #222; padding-bottom: 12px; }
    .view-tabs button { background: none; border: none; color: #777; padding: 8px 16px; cursor: pointer; font-weight: 600; }
    .view-tabs button.active { background: #222; color: #fff; border-radius: 4px; }
    
    .btn { padding: 10px 15px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; }
    .btn.primary { background: #646cff; color: white; }
    .btn.secondary { background: #333; color: white; }
    .full-width { width: 100%; box-sizing: border-box; }
    
    .task-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .task-input input { flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #333; color: white; border-radius: 4px; }
    .add-btn { background: #646cff; color: white; border: none; padding: 0 20px; font-size: 1.5rem; border-radius: 4px; }
    .task-list { list-style: none; padding: 0; margin: 0; }
    .task-item { display: flex; align-items: center; gap: 15px; background: #1a1a1a; padding: 15px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #222; cursor: pointer; }

    /* Modal */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .modal { background: #1a1a1a; padding: 25px; border-radius: 8px; width: 400px; border: 1px solid #333; }
    .modal h2 { margin-top: 0; }
    .study-launch-banner { background: #1f1f3a; padding: 15px; border-radius: 6px; margin: 20px 0; border: 1px solid #2a2a5a; text-align: center; }
    .study-launch-banner p { margin-top: 0; font-size: 0.9rem; color: #a5b4fc; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

    /* Calendar */
    .cal-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
    .cal-view-toggles { display: flex; gap: 5px; }
    .cal-view-toggles button { background: #111; color: #888; border: 1px solid #333; padding: 5px 15px; border-radius: 4px; cursor: pointer;}
    .cal-view-toggles button.active { background: #646cff; color: white; border-color: #646cff; }
    .cal-nav { display: flex; align-items: center; gap: 15px; }
    .cal-nav button { background: #333; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; }
    .cal-nav button:hover { background: #444; }
    .cal-header-title { min-width: 180px; text-align: center; }
    .cal-header-title h3 { margin: 0; font-size: 1.1rem; }
    
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
    .cal-header-cell { text-align: center; font-weight: bold; color: #888; padding-bottom: 10px; }
    .cal-cell { background: #1a1a1a; min-height: 80px; padding: 5px; border-radius: 4px; display: flex; flex-direction: column;}
    .cal-cell.empty { background: transparent; }
    .day-num { text-align: right; color: #666; font-size: 0.8rem; margin-bottom: 5px;}
    .day-header { text-align: center; font-weight: bold; color: #888; font-size: 0.85rem; padding-bottom: 5px; border-bottom: 1px solid #333; margin-bottom: 5px; }
    .mini-task { background: #646cff; color: white; font-size: 0.7rem; padding: 3px 5px; border-radius: 2px; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }

    /* Agenda View */
    .agenda-view { background: #1a1a1a; padding: 20px; border-radius: 8px; }
    .agenda-view h2 { margin-top: 0; font-size: 1.3rem; margin-bottom: 15px;}
    .agenda-item { display: flex; align-items: center; background: #111; border: 1px solid #222; padding: 12px; margin-bottom: 10px; border-radius: 6px; cursor: pointer; border-left: 4px solid #646cff; }
    .agenda-item.completed { opacity: 0.6; border-left-color: #555; }
    .agenda-date { min-width: 80px; display: flex; flex-direction: column; align-items: center; padding-right: 15px; border-right: 1px solid #333; margin-right: 15px; }
    .agenda-date .day { font-size: 0.75rem; color: #888; text-transform: uppercase; font-weight: bold;}
    .agenda-date .date { font-size: 1.1rem; font-weight: bold; color: #eee; }
    .agenda-date .no-date { font-size: 0.8rem; color: #666; font-style: italic; }
    .agenda-content { display: flex; flex-direction: column; }
    
    /* Gantt */
    .gantt-view { background: #1a1a1a; padding: 20px; border-radius: 8px; }
    .gantt-row { display: flex; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #222; padding-bottom: 10px; }
    .gantt-label { width: 150px; font-weight: bold; }
    .gantt-bar { height: 20px; background: #646cff; border-radius: 10px; width: 60%; }

    /* Settings */
    .settings-card { background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid #222; }
    .settings-card h2 { margin-top:0; font-size: 1.2rem;}

    /* STUDY MODE FULLSCREEN */
    .study-workspace { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .study-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 15px; margin-bottom: 15px; }
    .study-header h2 { margin: 0; color: #646cff; }
    .split-layout { display: flex; gap: 20px; flex: 1; min-height: 0; }
    
    .pdf-panel { flex: 3; background: #080808; display: flex; flex-direction: column; border-radius: 8px; border: 1px solid #333; overflow: hidden; }
    .panel-tools { padding: 10px; background: #1a1a1a; border-bottom: 1px solid #333; }
    .canvas-container { flex: 1; overflow: auto; display: flex; justify-content: center; padding: 20px; }
    canvas { background: white; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
    .pdf-nav button { background: #333; color: white; border: none; padding: 4px 10px; border-radius: 4px; }

    .transcript-panel { flex: 2; display: flex; flex-direction: column; gap: 15px; min-height: 0; }
    .audio-block { background: #1a1a1a; padding: 15px; border-radius: 8px; border: 1px solid #333; }
    .audio-player { width: 100%; }
    
    .notes-block { flex: 1; background: #1a1a1a; padding: 15px; border-radius: 8px; border: 1px solid #333; display: flex; flex-direction: column; overflow-y: auto; }
    .section-label { font-weight: bold; color: #888; margin: 0 0 5px 0; font-size: 0.85rem; text-transform: uppercase; }
    .notes-block textarea { background: #111; color: white; border: 1px solid #333; padding: 10px; border-radius: 4px; font-family: inherit; margin-bottom: 15px; resize: vertical; min-height: 100px; }
    .markdown-body { padding: 10px; background: #111; border-radius: 4px; min-height: 100px; border: 1px solid #333;}
</style>