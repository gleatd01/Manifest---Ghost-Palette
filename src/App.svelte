<script>
    import { onMount, tick } from 'svelte';

    let user = null;
    let tasks = [];
    let allUsers = []; 
    
    let newTaskTitle = '';
    let newTaskDate = '';
    
    let currentView = 'list';
    let editingTask = null; 
    let selectedDep = null;
    let selectedAssignee = null;
    
    let isFullWorkspace = false;
    let saveStatus = "All changes saved";
    let saveTimeout = null;

    let currentDate = new Date();
    $: currentMonth = currentDate.getMonth();
    $: currentYear = currentDate.getFullYear();
    $: daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    $: firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

    $: activeTasks = tasks.filter(t => !t.completed);

    $: calendarDays = Array.from({ length: 42 }, (_, i) => {
        const dayNum = i - firstDayOfMonth + 1;
        if (dayNum > 0 && dayNum <= daysInMonth) {
            const dateStr = new Date(currentYear, currentMonth, dayNum, 12).toISOString().split('T')[0];
            const dayTasks = activeTasks.filter(t => t.due_date && t.due_date.startsWith(dateStr));
            return { dayNum, dateStr, tasks: dayTasks };
        }
        return null;
    });

    onMount(async () => {
        await checkUser();
        if (user) {
            await Promise.all([loadTasks(), loadUsers()]);
        }
    });

    async function checkUser() {
        const res = await fetch('/api/user');
        if (res.ok) user = await res.json();
    }
    
    async function loadUsers() {
        const res = await fetch('/api/users');
        if (res.ok) allUsers = await res.json();
    }

    async function loadTasks() {
        const res = await fetch('/api/tasks');
        if (res.ok) tasks = await res.json();
    }

    function isBlocked(task) {
        if (!task.predecessors || task.predecessors.length === 0) return false;
        return task.predecessors.some(pid => {
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

    async function addTask() {
        if (!newTaskTitle.trim()) return;
        const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTaskTitle, dueDate: newTaskDate || null })
        });
        if (res.ok) {
            await loadTasks(); 
            newTaskTitle = '';
            newTaskDate = '';
        }
    }
    
    async function toggleComplete(task) {
        if (isBlocked(task)) return; 
        
        const oldStatus = task.completed;
        task.completed = !task.completed;
        tasks = [...tasks]; 

        const res = await fetch(`/api/tasks/${task.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...task, dueDate: task.due_date, predecessors: task.predecessors, assignees: task.assignees })
        });
        
        if (res.ok) {
            await loadTasks(); 
        } else {
            task.completed = oldStatus;
            tasks = [...tasks];
        }
    }

    function openEdit(task) {
        editingTask = { 
            ...task, 
            due_date: task.due_date ? task.due_date.split('T')[0] : '',
            predecessors: task.predecessors ? [...task.predecessors] : [],
            assignees: task.assignees ? [...task.assignees] : [],
            description: task.description || ''
        };
        selectedDep = null;
        selectedAssignee = null;
        isFullWorkspace = false;
        saveStatus = "All changes saved";
        
        setTimeout(renderPreview, 50);
    }

    function addDep() {
        if (selectedDep && !editingTask.predecessors.includes(selectedDep)) {
            editingTask.predecessors = [...editingTask.predecessors, selectedDep];
            selectedDep = null;
        }
    }
    function removeDep(id) {
        editingTask.predecessors = editingTask.predecessors.filter(pid => pid !== id);
    }
    
    function addAssignee() {
        if (selectedAssignee && !editingTask.assignees.includes(selectedAssignee)) {
            editingTask.assignees = [...editingTask.assignees, selectedAssignee];
            selectedAssignee = null;
        }
    }
    function removeAssignee(id) {
        editingTask.assignees = editingTask.assignees.filter(uid => uid !== id);
    }

    async function saveEdit() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveStatus = "Saving...";
        
        const res = await fetch(`/api/tasks/${editingTask.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                title: editingTask.title,
                description: editingTask.description,
                dueDate: editingTask.due_date,
                completed: editingTask.completed,
                predecessors: editingTask.predecessors,
                assignees: editingTask.assignees
            })
        });
        if (res.ok) {
            await loadTasks();
            saveStatus = "All changes saved";
        } else {
            saveStatus = "Error saving changes";
        }
    }

    function handleDescriptionInput() {
        saveStatus = "Unsaved changes";
        renderPreview();
        
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveEdit();
        }, 2000);
    }

    function renderPreview() {
        const previewEl = document.getElementById('md-preview');
        if (!previewEl || !editingTask) return;

        let rawText = editingTask.description || '';

        // Process LaTeX block elements $$equation$$
        rawText = rawText.replace(/\$\$([\s\S]*?)\$\$/g, (match, equation) => {
            try {
                return '<div class="katex-block-wrapper">' + window.katex.renderToString(equation.trim(), { displayMode: true, throwOnError: false }) + '</div>';
            } catch (e) {
                return match;
            }
        });

        // Process LaTeX inline elements $ equation $
        rawText = rawText.replace(/\$([^\$\n]+?)\$/g, (match, equation) => {
            try {
                return window.katex.renderToString(equation.trim(), { displayMode: false, throwOnError: false });
            } catch (e) {
                return match;
            }
        });

        // Compile Markdown formatting
        if (window.marked && window.marked.parse) {
            previewEl.innerHTML = window.marked.parse(rawText);
        } else {
            previewEl.innerText = rawText;
        }
    }

    function changeMonth(offset) { currentDate = new Date(currentYear, currentMonth + offset, 1); }
    async function logout() { await fetch('/auth/logout', { method: 'POST' }); user = null; tasks = []; }
</script>

<main>
    <div class="container">
        <div class="header">
            <h1>Manifest <span>- Ghost Palette</span></h1>
            {#if user} <button class="logout-btn" on:click={logout}>Logout</button> {/if}
        </div>
        
        {#if !user}
            <div class="login-box">
                <p>Please log in to manage your tasks.</p>
                <a href="/auth/google" class="btn google-btn">Login with Google</a>
            </div>
        {:else}
            <div class="view-tabs">
                <button class:active={currentView === 'list'} on:click={() => currentView = 'list'}>List</button>
                <button class:active={currentView === 'calendar'} on:click={() => currentView = 'calendar'}>Calendar</button>
            </div>

            {#if currentView === 'list'}
                <div class="task-input">
                    <input class="flex-2" type="text" bind:value={newTaskTitle} placeholder="New task or course assignment..." on:keydown={(e) => e.key === 'Enter' && addTask()} />
                    <input class="flex-1" type="date" bind:value={newTaskDate} />
                    <button class="add-btn" on:click={addTask}>+</button>
                </div>

                {#if activeTasks.length === 0} <p class="empty">No active tasks or course topics.</p> {/if}

                <ul class="task-list">
                    {#each activeTasks as task}
                        <li class="task-item {isBlocked(task) ? 'blocked' : ''}">
                            <input type="checkbox" disabled={isBlocked(task)} checked={task.completed} on:change={() => toggleComplete(task)} />
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <div class="task-content" on:click={() => openEdit(task)}>
                                <span class="task-title">{task.title}</span>
                                {#if isBlocked(task)}
                                    <span class="badge warning" title="Waiting on predecessor">🔒 Blocked</span>
                                {/if}
                                {#if task.assignees && task.assignees.length > 0} 
                                    <span class="badge shared" title="Shared Task">👥 {task.assignees.length}</span> 
                                {/if}
                                {#if task.due_date} <span class="badge">{task.due_date.split('T')[0]}</span> {/if}
                                {#if task.description} <span class="desc-indicator" title="Contains notes">📝 Doc</span> {/if}
                            </div>
                        </li>
                    {/each}
                </ul>
            {:else if currentView === 'calendar'}
                <div class="calendar">
                    <div class="cal-controls">
                        <button on:click={() => changeMonth(-1)}>◀</button>
                        <h3>{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
                        <button on:click={() => changeMonth(1)}>▶</button>
                    </div>
                    <div class="cal-grid">
                        {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as day} <div class="cal-header-cell">{day}</div> {/each}
                        {#each calendarDays as dayObj}
                            <div class="cal-cell {dayObj ? '' : 'empty'}">
                                {#if dayObj}
                                    <div class="day-num">{dayObj.dayNum}</div>
                                    <div class="day-tasks">
                                        {#each dayObj.tasks as t}
                                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                                            <div class="mini-task {isBlocked(t) ? 'blocked' : ''}" on:click={() => openEdit(t)}>
                                                {#if isBlocked(t)}🔒{/if} {t.title}
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}
        {/if}
    </div>

    {#if editingTask}
        <div class="modal-overlay">
            <div class="modal {isFullWorkspace ? 'workspace-layout' : ''}">
                <div class="modal-header-row">
                    <h2>{isFullWorkspace ? 'Workspace Document' : 'Task Details'}</h2>
                    {#if isFullWorkspace}
                        <div class="workspace-indicators">
                            <span class="save-indicator {saveStatus === 'Saving...' ? 'saving' : ''}">{saveStatus}</span>
                            <button class="btn secondary small-btn" on:click={() => { isFullWorkspace = false; saveEdit(); }}>Close Workspace</button>
                        </div>
                    {/if}
                </div>
                
                {#if !isFullWorkspace}
                    <input class="full-width title-input" type="text" bind:value={editingTask.title} placeholder="Task Title" />
                    
                    <div class="workspace-trigger-box">
                        <label>Notes & Course Document Workspace:</label>
                        <button class="btn primary full-width ws-btn" on:click={() => { isFullWorkspace = true; setTimeout(renderPreview, 50); }}>
                            📖 Open Full Screen Document Editor (Markdown & LaTeX)
                        </button>
                    </div>

                    <div class="modal-row">
                        <label>Due Date:</label>
                        <input type="date" bind:value={editingTask.due_date} />
                    </div>
                    
                    <!-- Assignment Section -->
                    <div class="modal-section">
                        <label>Assigned To (Shared Users):</label>
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
                            <select bind:value={selectedAssignee}>
                                <option value={null}>-- Select user to share with --</option>
                                {#each allUsers.filter(u => u.id !== editingTask.user_id && !editingTask.assignees.includes(u.id)) as u}
                                    <option value={u.id}>{u.username}</option>
                                {/each}
                            </select>
                            <button class="btn secondary" on:click={addAssignee}>Add</button>
                        </div>
                    </div>

                    <!-- Dependencies Section -->
                    <div class="modal-section">
                        <label>Depends on (Predecessors):</label>
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
                            <select bind:value={selectedDep}>
                                <option value={null}>-- Select a prerequisite task --</option>
                                {#each tasks.filter(t => t.id !== editingTask.id && !editingTask.predecessors.includes(t.id)) as t}
                                    <option value={t.id}>{t.title} {t.completed ? '(Done)' : ''}</option>
                                {/each}
                            </select>
                            <button class="btn secondary" on:click={addDep}>Add</button>
                        </div>
                    </div>

                    <div class="modal-actions">
                        <button class="btn secondary" on:click={() => editingTask = null}>Cancel</button>
                        <button class="btn primary" on:click={saveEdit}>Save</button>
                    </div>
                {:else}
                    <!-- Full Document Workspace View (Splitscreen Markdown + KaTeX) -->
                    <div class="workspace-title-bar">
                        <input class="ws-title-input" type="text" bind:value={editingTask.title} placeholder="Document Title" on:input={handleDescriptionInput} />
                    </div>
                    <div class="split-editor-container">
                        <div class="editor-pane">
                            <div class="pane-header">Editor (Markdown / LaTeX Syntax Supported)</div>
                            <textarea 
                                class="ws-textarea" 
                                bind:value={editingTask.description} 
                                placeholder="Write detailed notes here...

Use Markdown for rich text layout.
Use $E=mc^2$ for inline LaTeX math equations.
Use $$ to wrap a centered mathematical calculation block." 
                                on:input={handleDescriptionInput}
                            ></textarea>
                        </div>
                        <div class="preview-pane">
                            <div class="pane-header">Live Preview Document</div>
                            <div id="md-preview" class="markdown-body"></div>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</main>

<style>
    :global(body) { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    main { display: flex; justify-content: center; padding: 20px; min-height: 100vh; box-sizing: border-box; }
    .container { width: 100%; max-width: 600px; background: #222; padding: 30px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: flex; flex-direction: column; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 1.5rem; color: #fff; }
    h1 span { font-weight: normal; color: #777; font-size: 1.2rem; }
    
    .btn, button { padding: 8px 14px; cursor: pointer; border: none; border-radius: 6px; font-weight: bold; transition: 0.2s; }
    .google-btn { display: inline-block; background: #fff; color: #333; text-decoration: none; text-align: center; width: 100%; box-sizing: border-box; padding: 12px;}
    .logout-btn { background: #444; color: #ccc; font-size: 0.9rem;}
    .logout-btn:hover { background: #555; color: #fff; }
    
    .view-tabs { display: flex; gap: 10px; margin-bottom: 20px; }
    .view-tabs button { flex: 1; background: #333; color: #888; padding: 10px; border-radius: 6px; font-size: 1rem;}
    .view-tabs button.active { background: #646cff; color: #fff; }

    input, textarea, select { padding: 10px; border-radius: 6px; border: 1px solid #444; background: #1a1a1a; color: #fff; font-family: inherit; }
    .task-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .flex-2 { flex: 2; min-width: 0; }
    .flex-1 { flex: 1; min-width: 0; }
    .add-btn { background: #646cff; color: white; font-size: 1.2rem; width: 45px; flex-shrink: 0;}
    
    .empty { color: #666; text-align: center; font-style: italic; margin-top: 40px; }
    
    .task-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .task-item { display: flex; align-items: center; gap: 15px; padding: 12px 15px; background: #333; border-radius: 6px; transition: 0.2s; }
    .task-item:hover { background: #3a3a3a; }
    .task-item.blocked { opacity: 0.6; }
    .task-item input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: #646cff; margin: 0; }
    .task-content { flex: 1; display: flex; align-items: center; gap: 10px; cursor: pointer; min-width: 0; }
    .task-title { color: #eee; font-size: 1.05rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
    .badge { background: #555; color: #ddd; font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; white-space: nowrap; }
    .badge.warning { background: #8a6a00; font-weight: bold; }
    .badge.shared { background: #2f855a; }
    .desc-indicator { color: #646cff; font-size: 0.8rem; font-weight: bold; border: 1px solid #646cff; padding: 1px 5px; border-radius: 4px; }

    .calendar { background: #1a1a1a; padding: 15px; border-radius: 8px; border: 1px solid #333; }
    .cal-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; color: #fff; }
    .cal-controls button { background: #333; color: #fff; }
    .cal-controls h3 { margin: 0; font-size: 1.1rem; }
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .cal-header-cell { text-align: center; color: #888; font-size: 0.8rem; font-weight: bold; padding-bottom: 5px; }
    .cal-cell { background: #2a2a2a; border-radius: 4px; min-height: 70px; padding: 4px; display: flex; flex-direction: column; gap: 2px;}
    .cal-cell.empty { background: transparent; }
    .day-num { font-size: 0.8rem; color: #aaa; text-align: right; margin-bottom: 2px; }
    .mini-task { background: #646cff; color: #fff; font-size: 0.65rem; padding: 2px 4px; border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .mini-task.blocked { background: #8a6a00; opacity: 0.8; }

    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; z-index: 100; backdrop-filter: blur(3px); overflow-y: auto;}
    .modal { background: #222; padding: 25px; border-radius: 12px; width: 100%; max-width: 450px; display: flex; flex-direction: column; gap: 15px; border: 1px solid #444; box-shadow: 0 10px 30px rgba(0,0,0,0.8); margin: auto; transition: max-width 0.2s, height 0.2s; }
    .modal h2 { margin: 0; color: #fff; font-size: 1.3rem; }
    .full-width { width: 100%; box-sizing: border-box; }
    .title-input { font-size: 1.1rem; font-weight: bold; }
    .modal-row { display: flex; align-items: center; gap: 10px; color: #ccc; }
    
    .modal-section { background: #1a1a1a; padding: 15px; border-radius: 8px; border: 1px solid #333; }
    .modal-section label { display: block; color: #aaa; margin-bottom: 10px; font-size: 0.9rem; font-weight: bold; }
    .dep-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 15px; }
    .dep-badge { background: #333; border: 1px solid #555; padding: 5px 10px; border-radius: 6px; font-size: 0.85rem; display: flex; align-items: center; gap: 8px; color: #ddd; }
    .shared-badge { background: #1b4332; border-color: #2d6a4f; }
    .remove-dep { background: transparent; border: none; color: #ff5555; cursor: pointer; font-weight: bold; padding: 0 4px; font-size: 1rem; }
    .remove-dep:hover { color: #ff2222; }
    .add-dep { display: flex; gap: 8px; }
    .add-dep select { flex: 1; padding: 8px; min-width: 0; }

    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; }
    .btn.primary { background: #646cff; color: #fff; }
    .btn.secondary { background: #444; color: #ccc; }
    .btn.secondary:hover { background: #555; }
    
    .workspace-trigger-box { background: #2a2a2a; padding: 12px; border-radius: 6px; border: 1px dashed #555; margin-top: 5px;}
    .workspace-trigger-box label { display: block; margin-bottom: 8px; font-size: 0.85rem; color: #bbb;}
    .ws-btn { background: #3b3b98; padding: 12px;}
    .ws-btn:hover { background: #4b4baf; }

    /* Immersive Document Workspace Formatting */
    .modal.workspace-layout { max-width: 95vw; height: 90vh; display: flex; flex-direction: column; background: #161616; padding: 20px;}
    .modal-header-row { display: flex; justify-content: space-between; align-items: center; }
    .workspace-indicators { display: flex; align-items: center; gap: 15px; }
    .save-indicator { font-size: 0.85rem; color: #2ecc71; font-style: italic; }
    .save-indicator.saving { color: #f1c40f; }
    .small-btn { padding: 6px 12px; font-size: 0.85rem; }
    
    .workspace-title-bar { width: 100%; margin-top: 5px; }
    .ws-title-input { width: 100%; font-size: 1.4rem; font-weight: bold; background: transparent; border: none; border-bottom: 1px solid #333; border-radius: 0; padding: 8px 0; color: #fff; }
    .ws-title-input:focus { outline: none; border-bottom-color: #646cff; }

    .split-editor-container { display: flex; flex: 1; gap: 20px; min-height: 0; margin-top: 10px; }
    .editor-pane, .preview-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%; }
    .pane-header { font-size: 0.8rem; font-weight: bold; color: #666; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 6px; border-bottom: 1px solid #222; margin-bottom: 8px; }
    
    .ws-textarea { flex: 1; width: 100%; resize: none; background: #111; border: 1px solid #252525; padding: 15px; font-family: 'Courier New', Courier, monospace; font-size: 1rem; line-height: 1.5; color: #e0e0e0; border-radius: 6px; box-sizing: border-box; }
    .ws-textarea:focus { outline: none; border-color: #646cff; }
    
    .preview-pane { background: #1a1a1a; padding: 15px; border-radius: 6px; border: 1px solid #252525; overflow-y: auto; box-sizing: border-box; }
    
    /* Markdown / Rendered Styling inside Preview Pane */
    .markdown-body { color: #e0e0e0; font-size: 1.05rem; line-height: 1.6; }
    :global(.markdown-body h1) { font-size: 1.6rem; color: #fff; border-bottom: 1px solid #333; padding-bottom: 6px; margin-top: 0; }
    :global(.markdown-body h2) { font-size: 1.3rem; color: #f0f0f0; margin-top: 20px; }
    :global(.markdown-body h3) { font-size: 1.1rem; color: #e0e0e0; }
    :global(.markdown-body p) { margin-bottom: 14px; }
    :global(.markdown-body ul, .markdown-body ol) { padding-left: 20px; margin-bottom: 14px; }
    :global(.markdown-body li) { margin-bottom: 4px; }
    :global(.markdown-body code) { background: #2a2a2a; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.95rem; }
    :global(.markdown-body pre) { background: #111; padding: 12px; border-radius: 6px; overflow-x: auto; border: 1px solid #222; }
    :global(.markdown-body pre code) { background: transparent; padding: 0; }
    :global(.markdown-body blockquote) { border-left: 4px solid #646cff; padding-left: 15px; color: #aaa; margin: 0 0 14px 0; font-style: italic; }
    :global(.katex-block-wrapper) { display: flex; justify-content: center; width: 100%; margin: 15px 0; overflow-x: auto; padding: 10px 0; }
</style>