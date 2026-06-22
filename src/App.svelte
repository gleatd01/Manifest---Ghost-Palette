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
    
    let showAssignees = false;
    let showDependencies = false;
    let showReminder = false;
    
    let isFullWorkspace = false;
    let saveStatus = "All changes saved";
    let saveTimeout = null;
    
    let showNotifications = false;
    let pushPermissionStatus = 'default';
    let billingStatusMessage = '';

    // Settings Profile Matrices variables
    let userTimezone = 'UTC';
    let apiKeys = [];
    let newKeyName = '';
    let generatedCleartextKey = '';
    let showKeyModal = false;

    let currentDate = new Date();
    $: currentMonth = currentDate.getMonth();
    $: currentYear = currentDate.getFullYear();
    $: daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    $: firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

    $: activeTasks = tasks.filter(t => !t.completed);
    $: unreadCount = notifications.filter(n => !n.is_read).length;

    // Calendar Matrix Dynamic Grid track fixes
    $: totalCellsNeeded = firstDayOfMonth + daysInMonth;
    $: totalRows = Math.ceil(totalCellsNeeded / 7);

    $: calendarDays = Array.from({ length: totalRows * 7 }, (_, i) => {
        const dayNum = i - firstDayOfMonth + 1;
        if (dayNum > 0 && dayNum <= daysInMonth) {
            const dateObj = new Date(currentYear, currentMonth, dayNum, 12);
            const dateStr = dateObj.toISOString().split('T')[0];
            const dayTasks = activeTasks.filter(t => t.due_date && t.due_date.startsWith(dateStr));
            const now = new Date();
            const todayNorm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
            return { dayNum, dateStr, tasks: dayTasks, isPast: dateObj < todayNorm, isToday: dateStr === todayNorm.toISOString().split('T')[0] };
        }
        return null;
    });

    $: agendaTasks = [...activeTasks].sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
    });

    $: if (currentView === 'settings' && user) {
        fetchProfile();
        fetchApiKeys();
    }

    onMount(async () => {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('billing') === 'success') {
            billingStatusMessage = '🎉 Upgrade verification processed! Pro account assets activated successfully.';
            window.history.replaceState({}, document.title, "/");
        } else if (urlParams.get('billing') === 'cancel') {
            billingStatusMessage = 'Subscription checkout checkout route closed.';
            window.history.replaceState({}, document.title, "/");
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
                if (Notification.permission === 'granted') configurePushSubscription();
            }
        }
    });

    async function checkUser() { const res = await fetch('/api/user'); if (res.ok) user = await res.json(); }
    async function loadUsers() { const res = await fetch('/api/users'); if (res.ok) allUsers = await res.json(); }
    async function loadTasks() { const res = await fetch('/api/tasks'); if (res.ok) tasks = await res.json(); }
    async function loadNotifications() { const res = await fetch('/api/notifications'); if (res.ok) notifications = await res.json(); }

    // Billing Integration Triggers
    async function upgradeToPro() {
        try {
            const res = await fetch('/api/checkout', { method: 'POST' });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
        } catch (err) { alert('Stripe session initialization latency fault.'); }
    }
    async function manageSubscription() {
        try {
            const res = await fetch('/api/billing-portal', { method: 'POST' });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
        } catch (err) { alert('Portal redirect communications loss.'); }
    }

    // Regional controls
    async function fetchProfile() {
        const res = await fetch('/api/settings/profile');
        if (res.ok) { const data = await res.json(); userTimezone = data.timezone || 'UTC'; }
    }
    function autoDetectTimezone() { try { userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {} }
    async function saveProfileSettings() {
        const res = await fetch('/api/settings/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timezone: userTimezone })
        });
        if (res.ok) alert('Timezone specifications synchronized locally and on-server!');
    }

    // Key management logic 
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
        if (!confirm("Wipe this system token? Power Platform workflows using it will instantly fail.")) return;
        const res = await fetch(`/api/settings/keys/${id}`, { method: 'DELETE' });
        if (res.ok) fetchApiKeys();
    }

    // Notification permission setup
    async function requestNotificationPermission() {
        if (!('Notification' in window)) return;
        const permission = await Notification.requestPermission();
        pushPermissionStatus = permission;
        if (permission === 'granted') await configurePushSubscription();
    }
    async function configurePushSubscription() {
        if (!('serviceWorker' in navigator)) return;
        try {
            const reg = await navigator.serviceWorker.ready;
            const keyRes = await fetch('/api/push/key');
            if (!keyRes.ok) return;
            const { publicKey } = await keyRes.json();
            const convertedKey = urlBase64ToUint8Array(publicKey);
            const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: convertedKey });
            await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription }) });
        } catch (err) { console.error("Device verification pairing exception.", err); }
    }
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
        return outputArray;
    }

    // Business Logic Handlers
    function isBlocked(task) {
        if (!task.predecessors || task.predecessors.length === 0) return false;
        return task.predecessors.some(pid => { const p = tasks.find(t => t.id === pid); return p && !p.completed; });
    }
    function getTaskName(id) { const t = tasks.find(t => t.id === id); return t ? t.title : 'Unknown Reference'; }
    function getUserName(id) { const u = allUsers.find(u => u.id === id); return u ? u.username : 'Shared Participant'; }

    async function addTask() {
        if (!newTaskTitle.trim()) return;
        const res = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTaskTitle, dueDate: newTaskDate || null }) });
        if (res.ok) { newTaskTitle = ''; newTaskDate = ''; }
    }
    async function toggleComplete(task) {
        if (isBlocked(task)) return;
        const oldStatus = task.completed;
        task.completed = !task.completed;
        tasks = [...tasks];
        const res = await fetch(`/api/tasks/${task.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...task, dueDate: task.due_date, predecessors: task.predecessors, assignees: task.assignees, reminderTime: task.reminder_time, reminderFrequency: task.reminder_frequency })
        });
        if (!res.ok) { task.completed = oldStatus; tasks = [...tasks]; }
    }
    function openEdit(task) {
        editingTask = { ...task, due_date: task.due_date ? task.due_date.split('T')[0] : '', predecessors: task.predecessors ? [...task.predecessors] : [], assignees: task.assignees ? [...task.assignees] : [], description: task.description || '', reminder_time: task.reminder_time || '', reminder_frequency: task.reminder_frequency || 'daily' };
        showReminder = !!task.reminder_time;
        selectedDep = null; selectedAssignee = null; showAssignees = false; showDependencies = false; isFullWorkspace = false; saveStatus = "All changes saved";
        setTimeout(renderPreview, 50);
    }
    function addDep() { if (selectedDep && !editingTask.predecessors.includes(selectedDep)) { editingTask.predecessors = [...editingTask.predecessors, selectedDep]; selectedDep = null; } }
    function removeDep(id) { editingTask.predecessors = editingTask.predecessors.filter(pid => pid !== id); }
    function addAssignee() { if (selectedAssignee && !editingTask.assignees.includes(selectedAssignee)) { editingTask.assignees = [...editingTask.assignees, selectedAssignee]; selectedAssignee = null; } }
    function removeAssignee(id) { editingTask.assignees = editingTask.assignees.filter(uid => uid !== id); }

    async function saveEdit() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveStatus = "Saving...";
        const res = await fetch(`/api/tasks/${editingTask.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: editingTask.title, description: editingTask.description, dueDate: editingTask.due_date, completed: editingTask.completed, predecessors: editingTask.predecessors, assignees: editingTask.assignees, reminderTime: showReminder && editingTask.reminder_time ? editingTask.reminder_time : null, reminderFrequency: showReminder && editingTask.reminder_frequency ? editingTask.reminder_frequency : null })
        });
        saveStatus = res.ok ? "All changes saved" : "Error saving changes";
    }
    function handleDescriptionInput() { saveStatus = "Unsaved changes"; renderPreview(); if (saveTimeout) clearTimeout(saveTimeout); saveTimeout = setTimeout(saveEdit, 2000); }
    function renderPreview() {
        const previewEl = document.getElementById('md-preview');
        if (!previewEl || !editingTask) return;
        let txt = editingTask.description || '';
        txt = txt.replace(/\$\$([\s\S]*?)\$\$/g, (m, eq) => { try { return '<div class="katex-block-wrapper">' + window.katex.renderToString(eq.trim(), { displayMode: true, throwOnError: false }) + '</div>'; } catch(e) { return m; } });
        txt = txt.replace(/\$([^\$\n]+?)\$/g, (m, eq) => { try { return window.katex.renderToString(eq.trim(), { displayMode: false, throwOnError: false }); } catch(e) { return m; } });
        if (window.marked && window.marked.parse) previewEl.innerHTML = window.marked.parse(txt);
        else previewEl.innerText = txt;
    }
    async function handleNotificationClick(notif) {
        if (!notif.is_read) { await fetch(`/api/notifications/${notif.id}/read`, { method: 'POST' }); await loadNotifications(); }
        showNotifications = false;
        if (notif.task_id) { const target = tasks.find(t => t.id === notif.task_id); if (target) openEdit(target); }
    }
    async function markAllNotificationsRead() { await fetch('/api/notifications/read-all', { method: 'POST' }); await loadNotifications(); }
    function changeMonth(offset) { currentDate = new Date(currentYear, currentMonth + offset, 1); }
    async function logout() { await fetch('/auth/logout', { method: 'POST' }); user = null; tasks = []; }
</script>

{#if billingStatusMessage}
    <div class="billing-banner">
        <span>{billingStatusMessage}</span>
        <button on:click={() => billingStatusMessage = ''}>&times;</button>
    </div>
{/if}

<main>
    <div class="container">
        <div class="header">
            <h1>Manifest <span>- Ghost Palette Workspace</span></h1>
            {#if user}
                <div class="header-actions">
                    <div class="bell-container">
                        <button class="bell-btn" on:click={() => showNotifications = !showNotifications}>
                            🔔{#if unreadCount > 0}<span class="notification-badge">{unreadCount}</span>{/if}
                        </button>
                        {#if showNotifications}
                            <div class="notifications-dropdown">
                                <div class="notif-header">
                                    <h4>Notifications</h4>
                                    {#if unreadCount > 0}<button class="mark-read-btn" on:click={markAllNotificationsRead}>Mark all read</button>{/if}
                                </div>
                                <div class="notif-list">
                                    {#if notifications.length === 0}<p class="empty-notifs">No alerts found.</p>{/if}
                                    {#each notifications as n}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <div class="notif-item {n.is_read ? 'read' : 'unread'}" on:click={() => handleNotificationClick(n)}>
                                            <p>{n.message}</p>
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
                <p>Please log in to manage your collaborative course components.</p>
                <a href="/auth/google" class="btn google-btn">Authentication via Google Identity</a>
            </div>
        {:else}
            {#if pushPermissionStatus !== 'granted'}
                <div class="push-activation-banner">
                    <p>📱 Pair device components to guarantee workflow notification alerts update in the background context landscape.</p>
                    <button class="btn primary small-btn" on:click={requestNotificationPermission}>Connect Devices</button>
                </div>
            {/if}

            <div class="view-tabs">
                <button class:active={currentView === 'list'} on:click={() => currentView = 'list'}>Registry List</button>
                <button class:active={currentView === 'calendar'} on:click={() => currentView = 'calendar'}>Calendar Tracks</button>
                <button class:active={currentView === 'agenda'} on:click={() => currentView = 'agenda'}>Agenda Timeline</button>
                <button class:active={currentView === 'settings'} on:click={() => currentView = 'settings'}>Settings Hub</button>
            </div>

            {#if currentView === 'settings'}
                <div class="settings-container">
                    <div class="settings-card">
                        <h3>Regional Chronology Configuration</h3>
                        <p class="card-desc">Lock local structural coordinates to guarantee backend automated crons process alerts at your explicit local frame layout.</p>
                        <div class="settings-action-row">
                            <input type="text" bind:value={userTimezone} placeholder="e.g., America/New_York" />
                            <button class="btn secondary" on:click={autoDetectTimezone}>Auto-Detect Space</button>
                            <button class="btn primary" on:click={saveProfileSettings}>Synchronize Regional Metrics</button>
                        </div>
                    </div>

                    <div class="settings-card">
                        <h3>Premium Core Subscriptions</h3>
                        <p class="card-desc">Account Billing Level Status Matrix: <span class="billing-badge {user.plan_type}">{user.plan_type.toUpperCase()}</span></p>
                        {#if user.plan_type === 'pro'}
                            <button class="btn secondary" on:click={manageSubscription}>⚙️ Modify Billing Credentials / Cancel</button>
                        {:else}
                            <p class="promo-text">🚀 Unlock continuous server-side ML architectures to automatically transcribe and match audio streams with massive text components natively without local power exhaustion.</p>
                            <button class="btn primary gradient-btn" on:click={upgradeToPro}>Upgrade to Server Architecture Tier</button>
                        {/if}
                    </div>

                    <div class="settings-card">
                        <h3>Stateless Automated Access Gateway Integrations (DoD Domain Support)</h3>
                        <p class="card-desc">Provision custom integration credentials to authenticate Microsoft Power Platform elements programmatically without installing PWA layers.</p>
                        <div class="settings-action-row">
                            <input type="text" bind:value={newKeyName} placeholder="e.g., PowerApps DoD Custom Connector Link" />
                            <button class="btn primary" on:click={generateKey}>Generate Access Key Pair</button>
                        </div>
                        <div class="keys-table-wrapper">
                            {#if apiKeys.length === 0}
                                <p class="empty-state-text">No programmatically generated external system access credentials exist.</p>
                            {:else}
                                <table class="keys-dashboard-table">
                                    <thead><tr><th>Connector Profile Identity Name</th><th>Generation Date</th><th>Control</th></tr></thead>
                                    <tbody>
                                        {#each apiKeys as k}
                                            <tr><td>{k.key_name}</td><td>{new Date(k.created_at).toLocaleDateString()}</td><td><button class="revoke-btn" on:click={() => revokeKey(k.id)}>Revoke</button></td></tr>
                                        {/each}
                                    </tbody>
                                </table>
                            {/if}
                        </div>
                    </div>
                </div>
            {:else if currentView === 'list'}
                <div class="task-input">
                    <input class="flex-2" type="text" bind:value={newTaskTitle} placeholder="Initialize workflow component assignment name..." on:keydown={(e) => e.key === 'Enter' && addTask()} />
                    <input class="flex-1" type="date" bind:value={newTaskDate} />
                    <button class="add-btn" on:click={addTask}>+</button>
                </div>
                {#if activeTasks.length === 0}<p class="empty">No active structural task frameworks tracked inside workspace layers.</p>{/if}
                <ul class="task-list">
                    {#each activeTasks as task}
                        <li class="task-item {isBlocked(task) ? 'blocked' : ''}">
                            <input type="checkbox" disabled={isBlocked(task)} checked={task.completed} on:change={() => toggleComplete(task)} />
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <div class="task-content" on:click={() => openEdit(task)}>
                                <span class="task-title">{task.title}</span>
                                {#if isBlocked(task)}<span class="badge warning">🔒 Execution Interrupted</span>{/if}
                                {#if task.assignees?.length > 0}<span class="badge shared">👥 Shared</span>{/if}
                                {#if task.reminder_time}<span class="badge">⏰ {task.reminder_time}</span>{/if}
                                {#if task.due_date}<span class="badge">{task.due_date.split('T')[0]}</span>{/if}
                            </div>
                        </li>
                    {/each}
                </ul>
            {:else if currentView === 'calendar'}
                <div class="calendar">
                    <div class="cal-controls"><button on:click={() => changeMonth(-1)}>◀</button><h3>{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3><button on:click={() => changeMonth(1)}>▶</button></div>
                    <div class="cal-grid">
                        {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as d}<div class="cal-header-cell">{d}</div>{/each}
                        {#each calendarDays as day}
                            <div class="cal-cell {day ? '' : 'empty'} {day?.isPast ? 'past-date' : ''} {day?.isToday ? 'today-date' : ''}">
                                {#if day}
                                    <div class="day-num {day.isToday ? 'today-num' : ''}">{day.dayNum}</div>
                                    <div class="day-tasks">
                                        {#each day.tasks as t}
                                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                                            <div class="mini-task {isBlocked(t) ? 'blocked' : ''}" on:click={() => openEdit(t)}>{t.title}</div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            {:else if currentView === 'agenda'}
                <div class="agenda-view">
                    {#if agendaTasks.length === 0}<p class="empty">Timeline queue clear.</p>{/if}
                    {#each agendaTasks as task}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <div class="agenda-item {isBlocked(task) ? 'blocked' : ''}" on:click={() => openEdit(task)}>
                            <div class="agenda-date">
                                {#if task.due_date}
                                    <span class="day">{new Date(task.due_date).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
                                    <span class="date">{new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
                                {:else}
                                    <span class="no-date">Floating Context</span>
                                {/if}
                            </div>
                            <div class="agenda-content">
                                <span class="task-title">{task.title}</span>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>

    <!-- Dynamic Modal System Framework Sheets -->
    {#if editingTask}
        <div class="modal-overlay">
            <div class="modal {isFullWorkspace ? 'workspace-layout' : ''}">
                <div class="modal-header-row">
                    <h2>{isFullWorkspace ? 'Core Technical Document Studio' : 'Workspace Metrics Configuration'}</h2>
                    {#if isFullWorkspace}
                        <div class="workspace-indicators">
                            <span class="save-indicator {saveStatus === 'Saving...' ? 'saving' : ''}">{saveStatus}</span>
                            <button class="btn secondary small-btn" on:click={() => { isFullWorkspace = false; saveEdit(); }}>Exit Studio Environment</button>
                        </div>
                    {/if}
                </div>

                {#if !isFullWorkspace}
                    <input class="full-width title-input" type="text" bind:value={editingTask.title} placeholder="Configuration Object Title" />
                    <div class="modal-row" style="justify-content: space-between;">
                        <div style="display:flex; align-items:center; gap:10px;"><label>Execution Boundary Date:</label><input type="date" bind:value={editingTask.due_date} /></div>
                        <button class="btn secondary small-btn" on:click={() => showReminder = !showReminder}>⏰ {showReminder ? 'Wipe Temporal Reminder' : 'Attach Reminder Sequence'}</button>
                    </div>

                    {#if showReminder}
                        <div class="reminder-box">
                            <label>Execution Hour Check:</label><input type="time" bind:value={editingTask.reminder_time} />
                            <select bind:value={editingTask.reminder_frequency} style="margin-left:10px;">
                                <option value="daily">Continuous Intercepts (Daily)</option>
                                <option value="weekdays">Working Sequence Frames (Mon-Fri)</option>
                                <option value="weekends">Inertia Interval Sequences (Sat-Sun)</option>
                            </select>
                        </div>
                    {/if}

                    <div class="description-section">
                        <div class="desc-header"><label>Documentation Corpus Notes:</label><button class="btn secondary small-btn expand-btn" on:click={() => { isFullWorkspace = true; setTimeout(renderPreview, 50); }}>⛶ Open Technical Split Studio</button></div>
                        <textarea class="simple-textarea full-width" bind:value={editingTask.description} placeholder="Append technical descriptions or equations..." rows="4"></textarea>
                    </div>

                    <div class="modal-section">
                        <button class="section-toggle" on:click={() => showAssignees = !showAssignees}><span>Shared Participants Workspace Matrix Mapping</span><span class="chevron">{showAssignees ? '▼' : '▶'}</span></button>
                        {#if showAssignees}
                            <div class="section-content">
                                <div class="dep-list">
                                    {#if editingTask.assignees.length === 0}<span class="private-placeholder-text">Isolated Private Instance Channel</span>{/if}
                                    {#each editingTask.assignees as uid}<span class="dep-badge shared-badge">{getUserName(uid)}<button class="remove-dep" on:click={() => removeAssignee(uid)}>x</button></span>{/each}
                                </div>
                                <div class="add-dep">
                                    <select bind:value={selectedAssignee}><option value={null}>-- Map Authorized Identity --</option>{#each allUsers.filter(u => u.id !== editingTask.user_id && !editingTask.assignees.includes(u.id)) as userObj}<option value={userObj.id}>{userObj.username}</option>{/each}</select>
                                    <button class="btn secondary" on:click={addAssignee}>Inject Profile</button>
                                </div>
                            </div>
                        {/if}
                    </div>

                    <div class="modal-section">
                        <button class="section-toggle" on:click={() => showDependencies = !showDependencies}><span>Upstream Structural Predecessor Boundaries</span><span class="chevron">{showDependencies ? '▼' : '▶'}</span></button>
                        {#if showDependencies}
                            <div class="section-content">
                                <div class="dep-list">
                                    {#if editingTask.predecessors.length === 0}<span class="private-placeholder-text">No dependency block rules compiled.</span>{/if}
                                    {#each editingTask.predecessors as pid}<span class="dep-badge">{getTaskName(pid)}<button class="remove-dep" on:click={() => removeDep(pid)}>x</button></span>{/each}
                                </div>
                                <div class="add-dep">
                                    <select bind:value={selectedDep}><option value={null}>-- Assign Mandatory Pre-requisite Node --</option>{#each tasks.filter(t => t.id !== editingTask.id && !editingTask.predecessors.includes(t.id)) as taskObj}<option value={taskObj.id}>{taskObj.title}</option>{/each}</select>
                                    <button class="btn secondary" on:click={addDep}>Link Upstream Node</button>
                                </div>
                            </div>
                        {/if}
                    </div>
                    <div class="modal-footer"><button class="btn secondary" on:click={() => { editingTask = null; loadTasks(); }}>Abort Configuration</button><button class="btn primary" on:click={() => { saveEdit(); editingTask = null; loadTasks(); }}>Apply Parameters</button></div>
                {:else}
                    <div class="workspace-split">
                        <div class="editor-pane"><textarea class="ws-textarea" bind:value={editingTask.description} on:input={handleDescriptionInput}></textarea></div>
                        <div class="preview-pane"><div id="md-preview" class="markdown-body"></div></div>
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    <!-- Single Reveal Secure Overlay Modal Matrix -->
    {#if showKeyModal}
        <div class="one-time-modal-backdrop">
            <div class="one-time-modal-card">
                <h3>Isolate and Copy Secret Credentials Token</h3>
                <p class="warning-text">Cryptographic parameters will be displayed explicitly **once**. Archive these parameters inside your local enterprise secure storage repository instantly. This entity value can never be queried or rendered from our core storage database tables again.</p>
                <div class="secret-token-display-box">{generatedCleartextKey}</div>
                <button class="btn primary full-width" on:click={() => { showKeyModal = false; generatedCleartextKey = ''; }}>I Have Successfully Archived The Security Coordinates</button>
            </div>
        </div>
    {/if}
</main>

<style>
    :global(body) { background-color: #0d0d0d; color: #f2f2f2; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; }
    main { padding: 25px; display: flex; justify-content: center; min-height: 100vh; box-sizing: border-box; }
    .container { width: 100%; max-width: 950px; background: #141414; padding: 30px; border-radius: 12px; border: 1px solid #222; box-shadow: 0 15px 35px rgba(0,0,0,0.7); }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #262626; padding-bottom: 20px; margin-bottom: 25px; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 800; tracking: -0.5px; }
    h1 span { font-weight: 300; color: #646cff; }
    .header-actions { display: flex; align-items: center; gap: 20px; }
    .bell-btn { background: transparent; border: none; font-size: 1.4rem; position: relative; cursor: pointer; color: #fff; padding: 5px; }
    .notification-badge { position: absolute; top: -2px; right: -2px; background: #ef4444; color: white; font-size: 0.65rem; border-radius: 50%; padding: 2px 5px; font-weight: bold; }
    .notifications-dropdown { position: absolute; top: 50px; right: 0; width: 340px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.6); z-index: 1000; }
    .notif-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: #222; border-bottom: 1px solid #333; }
    .notif-header h4 { margin: 0; font-size: 0.9rem; }
    .mark-read-btn { background: transparent; border: none; color: #646cff; font-size: 0.75rem; cursor: pointer; }
    .notif-list { max-height: 300px; overflow-y: auto; }
    .notif-item { padding: 12px 15px; border-bottom: 1px solid #262626; cursor: pointer; }
    .notif-item.unread { background: #1a1d29; border-left: 3px solid #646cff; }
    .notif-item p { margin: 0; font-size: 0.85rem; color: #ccc; }
    .empty-notifs { text-align: center; padding: 20px; color: #555; font-style: italic; font-size: 0.85rem; margin:0; }
    .logout-btn { background: #262626; color: #aaa; border: 1px solid #3a3a3a; padding: 6px 14px; border-radius: 6px; font-size: 0.85rem; cursor: pointer; font-weight: bold; }
    .logout-btn:hover { background: #333; color: #fff; }
    .login-box { text-align: center; padding: 50px 20px; background: #1a1a1a; border: 1px solid #282828; border-radius: 8px; max-width: 450px; margin: 80px auto; }
    .btn { background: #262626; color: #fff; padding: 10px 18px; font-weight: 600; border-radius: 6px; cursor: pointer; border: 1px solid #3a3a3a; transition: 0.2s; font-size: 0.9rem; }
    .btn:hover { background: #333; border-color: #555; }
    .btn.primary { background: #646cff; border-color: #646cff; }
    .btn.primary:hover { background: #4d55d6; }
    .google-btn { display: block; text-decoration: none; background: #fff; color: #111; font-weight: bold; margin-top: 15px; border: none; padding: 12px; }
    .push-activation-banner { background: #122533; border-left: 4px solid #3b82f6; padding: 15px 20px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; gap: 20px; }
    .push-activation-banner p { margin: 0; font-size: 0.9rem; color: #93c5fd; }
    .view-tabs { display: flex; gap: 10px; margin-bottom: 25px; border-bottom: 1px solid #222; padding-bottom: 12px; }
    .view-tabs button { background: transparent; border: none; color: #777; font-size: 1rem; font-weight: 600; padding: 8px 16px; cursor: pointer; border-radius: 6px; }
    .view-tabs button.active { background: #222; color: #fff; border: 1px solid #333; }
    .task-input { display: flex; gap: 12px; margin-bottom: 25px; }
    .task-input input { background: #181818; border: 1px solid #2b2b2b; color: white; font-size: 1rem; border-radius: 6px; padding: 12px; }
    .add-btn { background: #646cff; color: white; border: none; width: 48px; font-size: 1.5rem; border-radius: 6px; cursor: pointer; font-weight: bold; }
    .task-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .task-item { display: flex; align-items: center; background: #1a1a1a; border: 1px solid #262626; padding: 14px 18px; border-radius: 8px; gap: 15px; }
    .task-item.blocked { opacity: 0.55; background: #1a1612; border-color: #3d2a13; }
    .task-item input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: #646cff; margin:0; }
    .task-content { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 15px; cursor: pointer; min-width: 0; }
    .task-title { font-size: 1rem; color: #eee; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge { background: #262626; border: 1px solid #3a3a3a; border-radius: 4px; padding: 2px 8px; font-size: 0.75rem; color: #bbb; font-weight: 500; }
    .badge.warning { background: #451a03; color: #fcd34d; border-color: #78350f; }
    .badge.shared { background: #064e3b; color: #6ee7b7; border-color: #065f46; }
    .empty { color: #555; text-align: center; font-style: italic; margin-top: 40px; }

    /* Calendar Grid Matrix Architecture Layouts */
    .calendar { background: #141414; padding: 20px; border-radius: 8px; border: 1px solid #222; }
    .cal-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .cal-controls h3 { margin: 0; font-size: 1.2rem; font-weight: 700; }
    .cal-controls button { background: #222; border: 1px solid #333; color: white; border-radius: 4px; padding: 5px 12px; }
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; align-content: start; }
    .cal-header-cell { text-align: center; color: #666; font-size: 0.8rem; font-weight: 700; text-transform: uppercase; padding-bottom: 8px; }
    .cal-cell { background: #1c1c1c; border-radius: 6px; padding: 6px; display: flex; flex-direction: column; gap: 4px; aspect-ratio: 1 / 1; overflow-y: auto; border: 1px solid transparent; }
    .cal-cell.empty { background: transparent; border: none; opacity: 0; pointer-events: none; }
    .cal-cell.past-date { background: #151515; opacity: 0.45; }
    .cal-cell.today-date { border-color: #646cff; background: rgba(100, 108, 255, 0.05); }
    .day-num { font-size: 0.8rem; color: #777; text-align: right; font-weight: 600; }
    .day-num.today-num { color: #646cff; font-weight: bold; font-size: 0.9rem; }
    .day-tasks { display: flex; flex-direction: column; gap: 3px; }
    .mini-task { background: #646cff; color: white; font-size: 0.65rem; font-weight: 600; padding: 2px 5px; border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; border-left: 2px solid #4d55d6; }
    .mini-task.blocked { background: #78350f; border-left-color: #ffd166; }

    /* Agenda Framework View */
    .agenda-view { display: flex; flex-direction: column; gap: 12px; }
    .agenda-item { display: flex; background: #1a1a1a; border: 1px solid #262626; border-radius: 8px; padding: 15px; cursor: pointer; border-left: 4px solid #646cff; }
    .agenda-item.blocked { opacity: 0.6; border-left-color: #78350f; }
    .agenda-date { min-width: 75px; display: flex; flex-direction: column; align-items: center; padding-right: 15px; border-right: 1px solid #2d2d2d; margin-right: 15px; }
    .agenda-date .day { font-size: 0.75rem; color: #666; text-transform: uppercase; font-weight: bold; }
    .agenda-date .date { font-size: 1.1rem; font-weight: 800; color: #fff; margin-top: 2px; }
    .agenda-date .no-date { color: #444; font-size: 0.8rem; font-style: italic; font-weight: bold; text-align: center; margin-top: 4px;}
    .agenda-content { display: flex; align-items: center; flex: 1; min-width: 0; }

    /* Settings Control Center Modules Layout Matrix */
    .settings-container { display: flex; flex-direction: column; gap: 25px; }
    .settings-card { background: #1a1a1a; border: 1px solid #262626; border-radius: 10px; padding: 25px; display: flex; flex-direction: column; gap: 12px; }
    .settings-card h3 { margin: 0; font-size: 1.15rem; font-weight: 700; color: #fff; }
    .card-desc { margin: 0 0 5px 0; font-size: 0.9rem; color: #888; line-height: 1.4; }
    .settings-action-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .settings-action-row input { background: #111; border: 1px solid #333; padding: 10px 14px; border-radius: 6px; color: white; flex: 1; min-width: 250px; font-size: 0.95rem; }
    .billing-badge { padding: 3px 10px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; margin-left: 5px; }
    .billing-badge.free { background: #333; color: #aaa; }
    .billing-badge.pro { background: #f59e0b; color: #1e1b4b; box-shadow: 0 0 10px rgba(245,158,11,0.2); }
    .promo-text { margin: 5px 0; font-size: 0.9rem; color: #a78bfa; line-height: 1.4; }
    .btn.gradient-btn { background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); border: none; font-weight: bold; padding: 12px 24px; box-shadow: 0 4px 15px rgba(99,102,241,0.3); }
    .btn.gradient-btn:hover { filter: brightness(1.1); }
    .keys-table-wrapper { margin-top: 15px; border-top: 1px solid #262626; padding-top: 15px; }
    .empty-state-text { margin: 0; font-size: 0.85rem; color: #555; font-style: italic; }
    .keys-dashboard-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem; }
    .keys-dashboard-table th { padding: 10px; background: #222; border-bottom: 2px solid #333; color: #888; font-weight: bold; }
    .keys-dashboard-table td { padding: 12px 10px; border-bottom: 1px solid #222; color: #ddd; }
    .revoke-btn { background: #3a1c1c; border: 1px solid #5a2c2c; color: #f87171; font-weight: bold; font-size: 0.8rem; padding: 5px 12px; border-radius: 4px; cursor: pointer; transition: 0.2s; }
    .revoke-btn:hover { background: #5a2c2c; color: #fff; }

    /* Modals Control Sheets styling map */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; z-index: 1000; backdrop-filter: blur(4px); }
    .modal { background: #161616; padding: 25px; border-radius: 12px; width: 100%; max-width: 500px; display: flex; flex-direction: column; gap: 18px; border: 1px solid #2b2b2b; box-shadow: 0 20px 45px rgba(0,0,0,0.8); max-height: 90vh; overflow-y: auto; }
    .modal-header-row { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #262626; padding-bottom: 12px; }
    .modal-header-row h2 { margin: 0; font-size: 1.3rem; font-weight: 700; }
    .full-width { width: 100%; box-sizing: border-box; }
    .title-input { background: #222; border: 1px solid #333; padding: 12px; font-size: 1.1rem; font-weight: bold; border-radius: 6px; color: white; }
    .title-input:focus { outline: none; border-color: #646cff; }
    .modal-row { display: flex; align-items: center; gap: 15px; font-size: 0.95rem; }
    .modal label { color: #aaa; font-weight: 600; }
    .modal input[type="date"], .modal input[type="time"], .modal select { background: #222; border: 1px solid #333; padding: 8px 12px; border-radius: 6px; color: white; font-family: inherit; }
    .reminder-box { display: flex; align-items: center; background: #221a0f; border-left: 3px solid #f59e0b; padding: 12px 15px; border-radius: 6px; border-top: 1px solid #3d2a13; border-bottom: 1px solid #3d2a13; border-right: 1px solid #3d2a13; }
    .description-section { display: flex; flex-direction: column; gap: 8px; }
    .desc-header { display: flex; justify-content: space-between; align-items: center; }
    .simple-textarea { background: #222; border: 1px solid #333; border-radius: 6px; color: white; padding: 12px; font-family: inherit; resize: vertical; box-sizing: border-box; }
    .expand-btn { padding: 4px 10px; font-size: 0.75rem; background: #262626; border: 1px solid #444; color: #ccc; }
    .expand-btn:hover { background: #333; color: white; }
    .modal-section { background: #111; padding: 16px; border-radius: 8px; border: 1px solid #222; }
    .section-toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; background: transparent; border: none; color: #aaa; font-size: 0.9rem; font-weight: bold; cursor: pointer; padding: 0; }
    .section-toggle:hover { color: white; }
    .section-content { margin-top: 15px; border-top: 1px solid #262626; padding-top: 15px; display: flex; flex-direction: column; gap: 12px; }
    .dep-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .dep-badge { background: #222; border: 1px solid #444; padding: 5px 12px; border-radius: 6px; font-size: 0.8rem; display: flex; align-items: center; gap: 8px; color: #ddd; }
    .shared-badge { background: #142e20; border-color: #1e5c36; color: #6ee7b7; }
    .remove-dep { background: transparent; border: none; color: #f87171; font-weight: bold; cursor: pointer; padding: 0 2px; font-size: 0.95rem; }
    .add-dep { display: flex; gap: 10px; }
    .add-dep select { flex: 1; padding: 8px; min-width: 0; }
    .private-placeholder-text { font-size: 0.8rem; color: #555; font-style: italic; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid #262626; padding-top: 15px; }
    .small-btn { padding: 6px 14px; font-size: 0.8rem; }

    /* Full Split Workspace Studio Specifications Mapping Matrix */
    .modal.workspace-layout { max-width: 96vw; height: 92vh; padding: 25px; background: #0a0a0a; }
    .workspace-split { display: flex; flex: 1; gap: 20px; min-height: 0; margin-top: 10px; }
    .editor-pane, .preview-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%; }
    .ws-textarea { flex: 1; width: 100%; resize: none; background: #111; border: 1px solid #222; padding: 20px; font-family: "Courier New", Courier, monospace; font-size: 1.05rem; line-height: 1.6; color: #e2e8f0; border-radius: 8px; box-sizing: border-box; }
    .ws-textarea:focus { outline: none; border-color: #646cff; }
    .preview-pane { background: #141414; padding: 20px; border-radius: 8px; border: 1px solid #222; overflow-y: auto; box-sizing: border-box; }
    .workspace-indicators { display: flex; align-items: center; gap: 15px; }
    .save-indicator { font-size: 0.85rem; color: #10b981; font-style: italic; }
    .save-indicator.saving { color: #f59e0b; }
    .markdown-body { color: #cbd5e1; font-size: 1.05rem; line-height: 1.7; }
    :global(.markdown-body h1) { font-size: 1.7rem; color: #fff; border-bottom: 1px solid #333; padding-bottom: 8px; margin-top: 0; font-weight: 800; }
    :global(.markdown-body h2) { font-size: 1.35rem; color: #f1f5f9; margin-top: 22px; border-bottom: 1px solid #222; padding-bottom: 4px; }
    :global(.markdown-body p) { margin-bottom: 16px; color: #cbd5e1; }
    :global(.markdown-body code) { background: #1e1e1e; padding: 3px 6px; border-radius: 4px; font-family: monospace; color: #f43f5e; font-size: 0.95rem; border: 1px solid #2d2d2d; }
    :global(.markdown-body pre) { background: #090909; padding: 15px; border-radius: 6px; overflow-x: auto; border: 1px solid #222; margin-bottom: 16px; }
    :global(.markdown-body pre code) { background: transparent; padding: 0; border: none; color: #e2e8f0; }
    :global(.markdown-body blockquote) { border-left: 4px solid #646cff; padding-left: 16px; color: #94a3b8; margin: 0 0 16px 0; font-style: italic; }
    :global(.katex-block-wrapper) { display: flex; justify-content: center; width: 100%; margin: 20px 0; padding: 12px; background: #111; border-radius: 6px; border: 1px solid #222; overflow-x: auto; }

    /* Cleartext Cryptographic Token Reveal Sheet Matrix overlays */
    .one-time-modal-backdrop { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index: 2000; padding: 20px; box-sizing: border-box; backdrop-filter: blur(5px); }
    .one-time-modal-card { background: #1a1a1a; padding: 30px; border-radius: 10px; border: 1px solid #f59e0b; max-width: 550px; width:100%; text-align: center; box-shadow: 0 15px 40px rgba(0,0,0,0.9); }
    .one-time-modal-card h3 { color: #f59e0b; margin-top:0; font-size: 1.3rem; font-weight: 800; }
    .warning-text { color: #e2e8f0; font-size: 0.95rem; line-height: 1.5; margin-bottom: 20px; text-align: left; background: #2a1f0c; padding: 12px; border-radius: 6px; border-left: 3px solid #f59e0b; }
    .secret-token-display-box { background: #000; padding: 16px; font-family: monospace; font-size: 1.15rem; color: #10b981; word-break: break-all; border-radius: 6px; margin: 20px 0; user-select: all; text-align: center; font-weight: bold; tracking: 0.5px; border: 1px solid #222; }
    .billing-banner { background: #1e3a8a; color: #f8fafc; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #3b82f6; font-weight: 600; font-size: 0.95rem; }
    .billing-banner button { background: transparent; border: none; color: white; font-size: 1.4rem; cursor: pointer; line-height: 1; padding: 0 5px; }

    /* Dynamic Mobile Response Track Layout Sizing Updates */
    @media (max-width: 768px) {
        main { padding: 10px; }
        .container { padding: 15px; border-radius: 8px; }
        .view-tabs { gap: 4px; overflow-x: auto; white-space: nowrap; padding-bottom: 8px; }
        .view-tabs button { font-size: 0.9rem; padding: 6px 12px; }
        .task-input { flex-direction: column; gap: 8px; }
        .task-input input { width: 100%; box-sizing: border-box; }
        .add-btn { width: 100%; height: 44px; }
        .cal-grid { gap: 3px; }
        .cal-cell { min-height: 65px; padding: 3px; aspect-ratio: auto; }
        .day-num { font-size: 0.75rem; }
        .mini-task { font-size: 0.55rem; padding: 1px 3px; }
        .settings-action-row { flex-direction: column; align-items: stretch; }
        .settings-action-row input { width: 100%; box-sizing: border-box; }
        .modal { padding: 15px; width: 95vw; }
        .modal-row { flex-direction: column; align-items: flex-start; gap: 10px; }
        .add-dep { flex-direction: column; }
    }
</style>