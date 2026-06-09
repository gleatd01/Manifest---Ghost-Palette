<script>
    import { onMount, tick } from 'svelte';
    import { io } from 'socket.io-client';

    let user = null;
    let tasks = [];
    let allUsers = []; 
    let notifications = [];
    
    let newTaskTitle = '';
    let newTaskDate = '';
    
    let currentView = 'list';
    let editingTask = null; 
    let selectedDep = null;
    let selectedAssignee = null;
    
    // UI State Variables
    let showAssignees = false;
    let showDependencies = false;
    let showReminder = false;
    
    let isFullWorkspace = false;
    let saveStatus = "All changes saved";
    let saveTimeout = null;
    
    let showNotifications = false;
    let pushPermissionStatus = 'default';

    let currentDate = new Date();
    $: currentMonth = currentDate.getMonth();
    $: currentYear = currentDate.getFullYear();
    $: daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    $: firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

    $: activeTasks = tasks.filter(t => !t.completed);
    $: unreadCount = notifications.filter(n => !n.is_read).length;

    $: calendarDays = Array.from({ length: 42 }, (_, i) => {
        const dayNum = i - firstDayOfMonth + 1;
        if (dayNum > 0 && dayNum <= daysInMonth) {
            const dateObj = new Date(currentYear, currentMonth, dayNum, 12);
            const dateStr = dateObj.toISOString().split('T')[0];
            const dayTasks = activeTasks.filter(t => t.due_date && t.due_date.startsWith(dateStr));
            
            // Normalize today for accurate comparison ignoring specific hours
            const now = new Date();
            const todayNorm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
            
            const isPast = dateObj < todayNorm;
            const isToday = dateStr === todayNorm.toISOString().split('T')[0];
            
            return { dayNum, dateStr, tasks: dayTasks, isPast, isToday };
        }
        return null;
    });

    $: agendaTasks = [...activeTasks].sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
    });

    onMount(async () => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                console.log("New app version detected. Refreshing...");
                window.location.reload();
            });
        }

        await checkUser();
        if (user) {
            await Promise.all([loadTasks(), loadUsers(), loadNotifications()]);
            
            const socket = io();
            socket.on('workspace-update', async () => {
                await Promise.all([loadTasks(), loadNotifications()]);
            });

            if ('Notification' in window) {
                pushPermissionStatus = Notification.permission;
                if (Notification.permission === 'granted') {
                    configurePushSubscription();
                }
            }
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
    
    async function loadNotifications() {
        const res = await fetch('/api/notifications');
        if (res.ok) notifications = await res.json();
    }

    async function requestNotificationPermission() {
        if (!('Notification' in window)) return;
        const permission = await Notification.requestPermission();
        pushPermissionStatus = permission;
        if (permission === 'granted') {
            await configurePushSubscription();
        }
    }

    async function configurePushSubscription() {
        if (!('serviceWorker' in navigator)) return;
        try {
            const reg = await navigator.serviceWorker.ready;
            const keyRes = await fetch('/api/push/key');
            if (!keyRes.ok) return;
            const { publicKey } = await keyRes.json();
            
            const convertedKey = urlBase64ToUint8Array(publicKey);
            
            const subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedKey
            });
            
            await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription })
            });
        } catch (err) {
            console.error("Failed to establish device push pairing:", err);
        }
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
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
            body: JSON.stringify({ 
                ...task, 
                dueDate: task.due_date, 
                predecessors: task.predecessors, 
                assignees: task.assignees,
                reminderTime: task.reminder_time,
                reminderFrequency: task.reminder_frequency
            })
        });
        
        if (!res.ok) {
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
            description: task.description || '',
            reminder_time: task.reminder_time || '',
            reminder_frequency: task.reminder_frequency || 'daily'
        };
        showReminder = !!task.reminder_time;
        selectedDep = null;
        selectedAssignee = null;
        showAssignees = false;
        showDependencies = false;
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
                assignees: editingTask.assignees,
                reminderTime: showReminder && editingTask.reminder_time ? editingTask.reminder_time : null,
                reminderFrequency: showReminder && editingTask.reminder_frequency ? editingTask.reminder_frequency : null
            })
        });
        if (res.ok) {
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

        rawText = rawText.replace(/\$\$([\s\S]*?)\$\$/g, (match, equation) => {
            try { return '<div class="katex-block-wrapper">' + window.katex.renderToString(equation.trim(), { displayMode: true, throwOnError: false }) + '</div>'; } 
            catch (e) { return match; }
        });

        rawText = rawText.replace(/\$([^\$\n]+?)\$/g, (match, equation) => {
            try { return window.katex.renderToString(equation.trim(), { displayMode: false, throwOnError: false }); } 
            catch (e) { return match; }
        });

        if (window.marked && window.marked.parse) {
            previewEl.innerHTML = window.marked.parse(rawText);
        } else {
            previewEl.innerText = rawText;
        }
    }
    
    async function handleNotificationClick(notif) {
        if (!notif.is_read) {
            await fetch(`/api/notifications/${notif.id}/read`, { method: 'POST' });
            await loadNotifications();
        }
        
        showNotifications = false;
        
        if (notif.task_id) {
            const targetTask = tasks.find(t => t.id === notif.task_id);
            if (targetTask) {
                openEdit(targetTask);
            }
        }
    }
    
    async function markAllNotificationsRead() {
        await fetch('/api/notifications/read-all', { method: 'POST' });
        await loadNotifications();
    }

    function changeMonth(offset) { currentDate = new Date(currentYear, currentMonth + offset, 1); }
    async function logout() { await fetch('/auth/logout', { method: 'POST' }); user = null; tasks = []; }
</script>

<main>
    <div class="container">
        <div class="header">
            <h1>Manifest <span>- Ghost Palette</span></h1>
            
            {#if user} 
                <div class="header-actions">
                    <div class="bell-container">
                        <button class="bell-btn" on:click={() => showNotifications = !showNotifications}>
                            🔔
                            {#if unreadCount > 0}
                                <span class="notification-badge">{unreadCount}</span>
                            {/if}
                        </button>
                        
                        {#if showNotifications}
                            <div class="notifications-dropdown">
                                <div class="notif-header">
                                    <h4>Notifications</h4>
                                    {#if unreadCount > 0}
                                        <button class="mark-read-btn" on:click={markAllNotificationsRead}>Mark all read</button>
                                    {/if}
                                </div>
                                <div class="notif-list">
                                    {#if notifications.length === 0}
                                        <p class="empty-notifs">No notifications yet.</p>
                                    {/if}
                                    {#each notifications as notif}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <div class="notif-item {notif.is_read ? 'read' : 'unread'}" on:click={() => handleNotificationClick(notif)}>
                                            <p>{notif.message}</p>
                                            <span class="notif-time">{new Date(notif.created_at).toLocaleDateString()}</span>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>
                    <button class="logout-btn" on:click={logout}>Logout</button> 
                </div>
            {/if}
        </div>
        
        {#if !user}
            <div class="login-box">
                <p>Please log in to manage your tasks.</p>
                <a href="/auth/google" class="btn google-btn">Login with Google</a>
            </div>
        {:else}
            {#if pushPermissionStatus !== 'granted'}
                <div class="push-activation-banner">
                    <p>📱 Enable Cross-Device Push notifications to receive alerts when tasks are updated or shared with you even when the app is closed!</p>
                    <button class="btn primary small-btn" on:click={requestNotificationPermission}>Enable Alerts</button>
                </div>
            {/if}

            <div class="view-tabs">
                <button class:active={currentView === 'list'} on:click={() => currentView = 'list'}>List</button>
                <button class:active={currentView === 'calendar'} on:click={() => currentView = 'calendar'}>Calendar</button>
                <button class:active={currentView === 'agenda'} on:click={() => currentView = 'agenda'}>Agenda</button>
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
                                {#if task.reminder_time} <span class="badge" title="Reminder Active">⏰ {task.reminder_time}</span> {/if}
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
                            <div class="cal-cell {dayObj ? '' : 'empty'} {dayObj && dayObj.isPast ? 'past-date' : ''} {dayObj && dayObj.isToday ? 'today-date' : ''}">
                                {#if dayObj}
                                    <div class="day-num {dayObj.isToday ? 'today-num' : ''}">{dayObj.dayNum}</div>
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
            {:else if currentView === 'agenda'}
                <div class="agenda-view">
                    {#if agendaTasks.length === 0}
                        <p class="empty">No tasks on the agenda.</p>
                    {/if}
                    {#each agendaTasks as task}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <div class="agenda-item {isBlocked(task) ? 'blocked' : ''}" on:click={() => openEdit(task)}>
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
                                    {#if task.assignees && task.assignees.length > 0}<span class="badge shared">👥 {task.assignees.length}</span>{/if}
                                </div>
                            </div>
                        </div>
                    {/each}
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
                    
                    <div class="modal-row" style="justify-content: space-between;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <label>Due Date:</label>
                            <input type="date" bind:value={editingTask.due_date} />
                        </div>
                        <button class="btn secondary small-btn" on:click={() => showReminder = !showReminder} title="Set Recurring Reminder">
                            ⏰ {showReminder ? 'Remove Reminder' : 'Add Reminder'}
                        </button>
                    </div>

                    {#if showReminder}
                        <div class="reminder-box">
                            <label>Remind me at:</label>
                            <input type="time" bind:value={editingTask.reminder_time} />
                            <select bind:value={editingTask.reminder_frequency} style="margin-left: 10px; width: auto;">
                                <option value="daily">Every Day</option>
                                <option value="weekdays">Every Weekday (Mon-Fri)</option>
                                <option value="weekends">Every Weekend (Sat-Sun)</option>
                            </select>
                        </div>
                    {/if}

                    <div class="description-section">
                        <div class="desc-header">
                            <label>Notes:</label>
                            <button class="btn secondary small-btn expand-btn" on:click={() => { isFullWorkspace = true; setTimeout(renderPreview, 50); }} title="Open Full Screen Editor">
                                ⛶ Full Workspace
                            </button>
                        </div>
                        <textarea 
                            class="simple-textarea full-width" 
                            bind:value={editingTask.description} 
                            placeholder="Add simple notes here..."
                            rows="3"
                        ></textarea>
                    </div>
                    
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
                                    <select bind:value={selectedAssignee}>
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

                    <div class="modal-section">
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
                                    <select bind:value={selectedDep}>
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

                    <div class="modal-actions">
                        <button class="btn secondary" on:click={() => {editingTask = null; loadNotifications();}}>Cancel</button>
                        <button class="btn primary" on:click={() => {saveEdit(); editingTask = null; loadNotifications();}}>Save</button>
                    </div>
                {:else}
                    <div class="workspace-title-bar">
                        <input class="ws-title-input" type="text" bind:value={editingTask.title} placeholder="Document Title" on:input={handleDescriptionInput} />
                    </div>
                    <div class="split-editor-container">
                        <div class="editor-pane">
                            <div class="pane-header">Editor (Markdown / LaTeX Syntax Supported)</div>
                            <textarea 
                                class="ws-textarea" 
                                bind:value={editingTask.description} 
                                placeholder="Write detailed notes here...\n\nUse Markdown for rich text layout.\nUse $E=mc^2$ for inline LaTeX math equations.\nUse $$ to wrap a centered mathematical calculation block." 
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
    
    .header-actions { display: flex; align-items: center; gap: 15px; }
    .bell-container { position: relative; }
    .bell-btn { background: transparent; color: #ccc; font-size: 1.3rem; padding: 5px; position: relative; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; }
    .bell-btn:hover { color: #fff; background: rgba(255,255,255,0.1); border-radius: 50%; }
    .notification-badge { position: absolute; top: -2px; right: -2px; background: #e74c3c; color: white; font-size: 0.65rem; font-weight: bold; padding: 2px 5px; border-radius: 10px; }
    
    .notifications-dropdown { position: absolute; top: 40px; right: 0; width: 300px; background: #2a2a2a; border: 1px solid #444; border-radius: 8px; box-shadow: 0 5px 15px rgba(0,0,0,0.6); z-index: 50; overflow: hidden; }
    .notif-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: #333; border-bottom: 1px solid #444; }
    .notif-header h4 { margin: 0; font-size: 0.95rem; color: #eee; }
    .mark-read-btn { background: transparent; border: none; color: #646cff; font-size: 0.8rem; cursor: pointer; padding: 0;}
    .mark-read-btn:hover { text-decoration: underline; }
    
    .notif-list { max-height: 350px; overflow-y: auto; }
    .empty-notifs { padding: 15px; text-align: center; color: #777; font-size: 0.9rem; margin: 0; }
    .notif-item { padding: 12px 15px; border-bottom: 1px solid #333; cursor: pointer; transition: background 0.2s; }
    .notif-item:last-child { border-bottom: none; }
    .notif-item:hover { background: #3a3a3a; }
    .notif-item.unread { background: #2d2d3a; border-left: 3px solid #646cff; }
    .notif-item p { margin: 0 0 5px 0; font-size: 0.85rem; color: #ddd; line-height: 1.3; }
    .notif-time { font-size: 0.7rem; color: #777; }

    .push-activation-banner { background: #2c3e50; border-left: 4px solid #3498db; padding: 12px 15px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; gap: 15px; margin-bottom: 20px; }
    .push-activation-banner p { margin: 0; font-size: 0.85rem; color: #ecf0f1; line-height: 1.4; }

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

    /* Calendar CSS */
    .calendar { background: #1a1a1a; padding: 15px; border-radius: 8px; border: 1px solid #333; }
    .cal-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; color: #fff; }
    .cal-controls button { background: #333; color: #fff; }
    .cal-controls h3 { margin: 0; font-size: 1.1rem; }
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .cal-header-cell { text-align: center; color: #888; font-size: 0.8rem; font-weight: bold; padding-bottom: 5px; }
    
    .cal-cell { 
        background: #2a2a2a; border-radius: 4px; padding: 4px; 
        display: flex; flex-direction: column; gap: 2px;
        aspect-ratio: 1 / 1; overflow-y: auto; transition: background 0.2s;
    }
    
    .cal-cell.empty { background: #1c1c1c; opacity: 0.6; border: none; }
    
    /* Date Highlighting */
    .cal-cell.past-date { background: #1f1f1f; opacity: 0.5; }
    .cal-cell.today-date { border: 1px solid #646cff; background: rgba(100, 108, 255, 0.08); box-shadow: inset 0 0 8px rgba(100, 108, 255, 0.2); }
    
    .day-num { font-size: 0.8rem; color: #aaa; text-align: right; margin-bottom: 2px; flex-shrink: 0;}
    .day-num.today-num { color: #646cff; font-weight: bold; font-size: 0.9rem; }
    
    .day-tasks { display: flex; flex-direction: column; gap: 2px; }
    .mini-task { background: #646cff; color: #fff; font-size: 0.65rem; padding: 2px 4px; border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; flex-shrink: 0;}
    .mini-task.blocked { background: #8a6a00; opacity: 0.8; }

    /* Mobile Overrides */
    @media (max-width: 600px) {
        main { padding: 5px; }
        .container { padding: 15px 10px; border-radius: 8px;}
        .calendar { padding: 0; border: none; background: transparent; }
        
        .cal-grid { gap: 2px; }
        .cal-cell { 
            aspect-ratio: auto; 
            min-height: 65px; 
            padding: 2px; 
        }
        .day-num { font-size: 0.7rem; margin-bottom: 1px; }
        .day-num.today-num { font-size: 0.8rem; }
        .cal-header-cell { font-size: 0.7rem; }
        .mini-task { font-size: 0.55rem; padding: 1px 2px; }
    }

    /* Agenda View CSS */
    .agenda-view { display: flex; flex-direction: column; gap: 10px; }
    .agenda-item { display: flex; align-items: center; background: #2a2a2a; border-radius: 6px; padding: 12px; cursor: pointer; transition: background 0.2s; border-left: 4px solid #646cff; }
    .agenda-item:hover { background: #333; }
    .agenda-item.blocked { opacity: 0.6; border-left-color: #8a6a00; }
    .agenda-date { min-width: 60px; display: flex; flex-direction: column; align-items: center; padding-right: 15px; border-right: 1px solid #444; margin-right: 15px; }
    .agenda-date .day { font-size: 0.75rem; color: #888; text-transform: uppercase; }
    .agenda-date .date { font-size: 0.9rem; font-weight: bold; color: #eee; text-align: center;}
    .agenda-date .no-date { color: #555; font-weight: bold; font-size: 0.8rem;}
    .agenda-content { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 0; }
    .agenda-badges { display: flex; gap: 5px; flex-wrap: wrap; }

    /* Modal Styles */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; z-index: 100; backdrop-filter: blur(3px); overflow-y: auto;}
    .modal { background: #222; padding: 25px; border-radius: 12px; width: 100%; max-width: 450px; display: flex; flex-direction: column; gap: 15px; border: 1px solid #444; box-shadow: 0 10px 30px rgba(0,0,0,0.8); margin: auto; transition: max-width 0.2s, height 0.2s; }
    .modal h2 { margin: 0; color: #fff; font-size: 1.3rem; }
    .full-width { width: 100%; box-sizing: border-box; }
    .title-input { font-size: 1.1rem; font-weight: bold; }
    .modal-row { display: flex; align-items: center; gap: 10px; color: #ccc; }
    
    .reminder-box { display: flex; align-items: center; background: #2a2a2a; padding: 10px 15px; border-radius: 6px; border-left: 3px solid #f1c40f; margin-top: -5px; }
    .reminder-box label { font-size: 0.9rem; margin-right: 10px; }

    .description-section { margin-top: 5px; }
    .desc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
    .desc-header label { font-size: 0.9rem; color: #ccc; }
    .simple-textarea { resize: vertical; min-height: 80px; font-family: inherit; font-size: 0.95rem; }
    .expand-btn { padding: 4px 8px; font-size: 0.75rem; background: #333; color: #aaa; border: 1px solid #555;}
    .expand-btn:hover { background: #444; color: #fff; border-color: #666;}
    
    .modal-section { background: #1a1a1a; padding: 15px; border-radius: 8px; border: 1px solid #333; }
    
    .section-toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; background: transparent; border: none; color: #aaa; font-size: 0.9rem; font-weight: bold; padding: 0; cursor: pointer; transition: color 0.2s; }
    .section-toggle:hover { color: #fff; }
    .section-content { margin-top: 15px; border-top: 1px solid #333; padding-top: 15px; display: flex; flex-direction: column; gap: 15px; }
    .chevron { font-size: 0.8rem; color: #666; transition: color 0.2s; }
    .section-toggle:hover .chevron { color: #fff; }

    .dep-list { display: flex; flex-wrap: wrap; gap: 8px; }
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