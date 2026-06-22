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
    let calendarMode = 'month'; // 'month' or 'week'
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

    // Settings Variables
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

    // Grid Calculation
    $: totalCellsNeeded = firstDayOfMonth + daysInMonth;
    $: totalRows = Math.ceil(totalCellsNeeded / 7);

    $: startOfWeek = new Date(currentYear, currentMonth, currentDate.getDate() - currentDate.getDay());
    $: endOfWeek = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + 6);

    // Header string
    $: calHeaderTitle = calendarMode === 'month' 
        ? currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })
        : `${startOfWeek.toLocaleDateString('default', { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    $: calendarDays = Array.from({ length: calendarMode === 'week' ? 7 : totalRows * 7 }, (_, i) => {
        let dateObj;
        let dayNum;
        
        if (calendarMode === 'week') {
            dateObj = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + i, 12);
            dayNum = dateObj.getDate();
        } else {
            dayNum = i - firstDayOfMonth + 1;
            if (dayNum > 0 && dayNum <= daysInMonth) {
                dateObj = new Date(currentYear, currentMonth, dayNum, 12);
            } else {
                return null; // out of month bounds
            }
        }

        const dateStr = dateObj.toISOString().split('T')[0];
        const dayTasks = activeTasks.filter(t => t.due_date && t.due_date.startsWith(dateStr));
        
        const now = new Date();
        const todayNorm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
        
        const isPast = dateObj < todayNorm;
        const isToday = dateStr === todayNorm.toISOString().split('T')[0];
        
        return { dayNum, dateStr, tasks: dayTasks, isPast, isToday };
    });

    function changeTimeRange(offset) {
        if (calendarMode === 'month' || currentView === 'gantt') {
            currentDate = new Date(currentYear, currentMonth + offset, 1);
        } else {
            currentDate = new Date(currentYear, currentMonth, currentDate.getDate() + (offset * 7));
        }
    }

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
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
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

    async function fetchProfile() {
        try {
            const res = await fetch('/api/settings/profile');
            if (res.ok) {
                const data = await res.json();
                userTimezone = data.timezone || 'UTC';
            }
        } catch (err) {
            console.error(err);
        }
    }

    function autoDetectTimezone() {
        try {
            userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch (e) {
            console.error("Auto-detect timezone failed");
        }
    }

    async function saveProfileSettings() {
        try {
            const res = await fetch('/api/settings/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timezone: userTimezone })
            });
            if (res.ok) {
                alert('Timezone settings securely saved!');
            }
        } catch(e) {
            console.error(e);
        }
    }

    async function fetchApiKeys() {
        try {
            const res = await fetch('/api/settings/keys');
            if (res.ok) apiKeys = await res.json();
        } catch (err) {
            console.error("Failed to gather API key data:", err);
        }
    }

    async function generateKey() {
        if (!newKeyName.trim()) return;
        try {
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
        } catch (err) {
            console.error("Could not run generating engine:", err);
        }
    }

    async function revokeKey(id) {
        if (!confirm("Are you sure you want to revoke this key? Microsoft Power Platform configurations using it will instantly fail.")) return;
        try {
            const res = await fetch(`/api/settings/keys/${id}`, { method: 'DELETE' });
            if (res.ok) fetchApiKeys();
        } catch (err) {
            console.error("Revocation engine error:", err);
        }
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
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
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
            if (targetTask) openEdit(targetTask);
        }
    }
    
    async function markAllNotificationsRead() {
        await fetch('/api/notifications/read-all', { method: 'POST' });
        await loadNotifications();
    }

    async function logout() { await fetch('/auth/logout', { method: 'POST' }); user = null; tasks = []; }
</script>

<main>
    <div class="container" style={currentView === 'gantt' || currentView === 'settings' ? 'max-width: 950px;' : ''}>
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
                    <p>📱 Enable Cross-Device Push notifications to receive alerts when tasks are updated or shared with you!</p>
                    <button class="btn primary small-btn" on:click={requestNotificationPermission}>Enable Alerts</button>
                </div>
            {/if}

            <div class="view-tabs">
                <button class:active={currentView === 'list'} on:click={() => currentView = 'list'}>List</button>
                <button class:active={currentView === 'calendar'} on:click={() => currentView = 'calendar'}>Calendar</button>
                <button class:active={currentView === 'agenda'} on:click={() => currentView = 'agenda'}>Agenda</button>
                <button class:active={currentView === 'gantt'} on:click={() => currentView = 'gantt'}>Gantt</button>
                <button class:active={currentView === 'settings'} on:click={() => currentView = 'settings'}>Settings</button>
            </div>

            {#if currentView === 'settings'}
                <div class="settings-container" style="padding: 10px; color: #fff;">
                    <h2>Settings & Integrations</h2>
                    
                    <div style="background: #222; padding: 20px; border-radius: 6px; border: 1px solid #333; margin-bottom: 25px;">
                        <h3 style="margin-top:0;">Profile & Regional Settings</h3>
                        <p style="color: #aaa; margin-bottom: 15px; font-size: 0.9rem;">
                            Set your local timezone to ensure background task reminders trigger correctly at your designated local time.
                        </p>
                        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                            <label style="font-weight: bold; font-size: 0.95rem;">Timezone:</label>
                            <input type="text" bind:value={userTimezone} placeholder="e.g., America/New_York" style="flex: 1; min-width: 200px; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #111; color: #fff;" />
                            <button on:click={autoDetectTimezone} style="padding: 8px 16px; background: #444; color: white; border: none; border-radius: 4px; cursor: pointer;">Auto-Detect</button>
                            <button on:click={saveProfileSettings} style="padding: 8px 16px; background: #2f855a; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Save Local Settings</button>
                        </div>
                    </div>

                    <div style="background: #222; padding: 20px; border-radius: 6px; border: 1px solid #333; margin-bottom: 25px;">
                        <h3 style="margin-top:0;">Generate New System Token</h3>
                        <p style="color: #aaa; margin-bottom: 15px; font-size: 0.9rem;">
                            Generate external API access tokens to connect application actions safely to tools inside isolated domains (such as Microsoft Power Apps or Power Automate Flows via an <code>X-API-Key</code> header).
                        </p>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <input type="text" bind:value={newKeyName} placeholder="e.g., DoD Power Automate Flow" style="flex: 1; min-width: 200px; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #111; color: #fff;" />
                            <button on:click={generateKey} style="padding: 8px 16px; background: #646cff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Generate Secure Key</button>
                        </div>
                    </div>

                    <div style="background: #222; padding: 20px; border-radius: 6px; border: 1px solid #333;">
                        <h3 style="margin-top:0; margin-bottom: 15px;">Active System Access Integrations</h3>
                        {#if apiKeys.length === 0}
                            <p style="color: #666; font-style: italic; margin: 0;">No external connection credentials configured.</p>
                        {:else}
                            <table style="width: 100%; border-collapse: collapse; text-align: left;">
                                <thead>
                                    <tr style="border-bottom: 1px solid #444; color: #aaa;">
                                        <th style="padding: 10px 8px;">Key Identifier Name</th>
                                        <th style="padding: 10px 8px;">Created Date</th>
                                        <th style="padding: 10px 8px; text-align: right;">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each apiKeys as k}
                                        <tr style="border-bottom: 1px solid #333;">
                                            <td style="padding: 12px 8px; font-weight: bold;">{k.key_name}</td>
                                            <td style="padding: 12px 8px; color: #aaa;">{new Date(k.created_at).toLocaleDateString()}</td>
                                            <td style="padding: 12px 8px; text-align: right;">
                                                <button on:click={() => revokeKey(k.id)} style="padding: 6px 12px; background: #e04040; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Revoke</button>
                                            </td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        {/if}
                    </div>
                </div>
            {:else if currentView === 'list'}
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
                        <button on:click={() => changeTimeRange(-1)}>◀</button>
                        <div class="cal-header-center">
                            <h3>{calHeaderTitle}</h3>
                            <div class="cal-mode-toggle">
                                <button class:active={calendarMode === 'month'} on:click={() => calendarMode = 'month'}>Month</button>
                                <button class:active={calendarMode === 'week'} on:click={() => calendarMode = 'week'}>Week</button>
                            </div>
                        </div>
                        <button on:click={() => changeTimeRange(1)}>▶</button>
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
            {:else if currentView === 'gantt'}
                <div class="gantt-chart">
                    <div class="cal-controls">
                        <button on:click={() => changeTimeRange(-1)}>◀</button>
                        <h3>{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })} Timeline</h3>
                        <button on:click={() => changeTimeRange(1)}>▶</button>
                    </div>

                    <div class="gantt-scroll-container">
                        <div class="gantt-grid" style="grid-template-columns: 180px repeat({daysInMonth}, 1fr);">
                            <div class="gantt-header-cell label-head">Workspace Documents</div>
                            {#each Array.from({ length: daysInMonth }, (_, i) => i + 1) as day}
                                <div class="gantt-header-cell day-head">{day}</div>
                            {/each}

                            {#if activeTasks.filter(t => t.due_date && new Date(t.due_date).getMonth() === currentMonth && new Date(t.due_date).getFullYear() === currentYear).length === 0}
                                <div class="gantt-empty-row" style="grid-column: 1 / span {daysInMonth + 1};">
                                    No tasks mapped inside this month window.
                                </div>
                            {/if}

                            {#each activeTasks as task}
                                {#if task.due_date}
                                    {@const taskDate = new Date(task.due_date)}
                                    {#if taskDate.getMonth() === currentMonth && taskDate.getFullYear() === currentYear}
                                        {@const endDay = taskDate.getDate()}
                                        {@const startDay = Math.max(1, endDay - 3)}

                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <div class="gantt-task-title" on:click={() => openEdit(task)}>
                                            <span>{task.title}</span>
                                        </div>
                                        
                                        <div class="gantt-row-timeline" style="grid-column: span {daysInMonth}; grid-template-columns: repeat({daysInMonth}, 1fr);">
                                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                                            <div class="gantt-task-bar {isBlocked(task) ? 'blocked' : ''}" 
                                                 style="grid-column: {startDay} / span {endDay - startDay + 1};"
                                                 on:click={() => openEdit(task)}>
                                                {#if isBlocked(task)}🔒 {/if}{task.title}
                                            </div>
                                        </div>
                                    {/if}
                                {/if}
                            {/each}
                        </div>
                    </div>
                </div>
            {/if}
        {/if}
    </div>

    <!-- One-Time API Credential Reveal Dialog -->
    {#if showKeyModal}
    <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; box-sizing: border-box;">
        <div style="background: #1a1a1a; padding: 25px; border-radius: 8px; border: 1px solid #f0a020; max-width: 500px; width: 100%; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.9);">
            <h3 style="color: #f0a020; margin-top: 0;">Copy Your Secret Integration Key</h3>
            <p style="color: #ddd; font-size: 0.95rem; line-height: 1.4;">
                For security reasons, this token will only be shown to you <strong>once</strong>. Store it safely immediately for your Power Apps Custom Connector or Power Automate HTTP configuration.
            </p>
            <div style="background: #000; padding: 15px; font-family: monospace; font-size: 1.1rem; color: #00ff00; word-break: break-all; border-radius: 4px; margin: 20px 0; user-select: all; border: 1px solid #333;">
                {generatedCleartextKey}
            </div>
            <button on:click={() => { showKeyModal = false; generatedCleartextKey = ''; }} style="padding: 10px 24px; background: #f0a020; color: #000; font-weight: bold; border: none; border-radius: 4px; cursor: pointer; width: 100%;">I Have Saved This Key Securely</button>
        </div>
    </div>
    {/if}

    <!-- Standard Workspace Modal -->
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
                        <button class="btn secondary small-btn" on:click={() => showReminder = !showReminder}>
                            ⏰ {showReminder ? 'Remove Reminder' : 'Add Reminder'}
                        </button>
                    </div>

                    {#if showReminder}
                        <div class="reminder-box">
                            <label>Remind me at:</label>
                            <input type="time" bind:value={editingTask.reminder_time} />
                            <select bind:value={editingTask.reminder_frequency} style="margin-left: 10px; width: auto;">
                                <option value="daily">Every Day</option>
                                <option value="weekdays">Every Weekday</option>
                                <option value="weekends">Every Weekend</option>
                            </select>
                        </div>
                    {/if}

                    <div class="description-section">
                        <div class="desc-header">
                            <label>Notes:</label>
                            <button class="btn secondary small-btn expand-btn" on:click={() => { isFullWorkspace = true; setTimeout(renderPreview, 50); }}>
                                ⛶ Full Workspace
                            </button>
                        </div>
                        <textarea class="simple-textarea full-width" bind:value={editingTask.description} placeholder="Add simple notes here..." rows="3"></textarea>
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
                            <div class="pane-header">Editor (Markdown / LaTeX Supported)</div>
                            <textarea class="ws-textarea" bind:value={editingTask.description} placeholder="Write detailed notes here..." on:input={handleDescriptionInput}></textarea>
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
    :global(body) { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #121212; color: #fff; margin: 0; }
    main { display: flex; justify-content: center; padding: 20px; min-height: 100vh; box-sizing: border-box; }
    .container { width: 100%; max-width: 600px; background: #222; padding: 30px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: flex; flex-direction: column; transition: max-width 0.2s ease-in-out; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 1.5rem; color: #fff; }
    h1 span { font-weight: normal; color: #777; font-size: 1.2rem; }
    
    .header-actions { display: flex; align-items: center; gap: 15px; }
    .bell-container { position: relative; }
    .bell-btn { background: transparent; color: #ccc; font-size: 1.3rem; padding: 5px; position: relative; border: none; cursor: pointer; }
    .notification-badge { position: absolute; top: -2px; right: -2px; background: #e74c3c; color: white; font-size: 0.65rem; font-weight: bold; padding: 2px 5px; border-radius: 10px; }
    
    .notifications-dropdown { position: absolute; top: 40px; right: 0; width: 300px; background: #2a2a2a; border: 1px solid #444; border-radius: 8px; box-shadow: 0 5px 15px rgba(0,0,0,0.6); z-index: 50; overflow: hidden; }
    .notif-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: #333; border-bottom: 1px solid #444; }
    .notif-header h4 { margin: 0; font-size: 0.95rem; color: #eee; }
    .mark-read-btn { background: transparent; border: none; color: #646cff; font-size: 0.8rem; cursor: pointer; padding: 0;}
    .notif-list { max-height: 350px; overflow-y: auto; }
    .empty-notifs { padding: 15px; text-align: center; color: #777; font-size: 0.9rem; margin: 0; }
    .notif-item { padding: 12px 15px; border-bottom: 1px solid #333; cursor: pointer; }
    .notif-item.unread { background: #2d2d3a; border-left: 3px solid #646cff; }
    .notif-item p { margin: 0 0 5px 0; font-size: 0.85rem; color: #ddd; line-height: 1.3; }
    .notif-time { font-size: 0.7rem; color: #777; }

    .push-activation-banner { background: #2c3e50; border-left: 4px solid #3498db; padding: 12px 15px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; gap: 15px; margin-bottom: 20px; }
    .push-activation-banner p { margin: 0; font-size: 0.85rem; color: #ecf0f1; line-height: 1.4; }

    .btn, button { padding: 8px 14px; cursor: pointer; border: none; border-radius: 6px; font-weight: bold; transition: 0.2s; }
    .google-btn { display: inline-block; background: #fff; color: #333; text-decoration: none; text-align: center; width: 100%; box-sizing: border-box; padding: 12px;}
    .logout-btn { background: #444; color: #ccc; font-size: 0.9rem;}
    
    .view-tabs { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
    .view-tabs button { flex: 1; background: #333; color: #888; padding: 10px; border-radius: 6px; font-size: 1rem; min-width: 80px;}
    .view-tabs button.active { background: #646cff; color: #fff; }

    input, textarea, select { padding: 10px; border-radius: 6px; border: 1px solid #444; background: #1a1a1a; color: #fff; font-family: inherit; }
    .task-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .flex-2 { flex: 2; min-width: 0; }
    .flex-1 { flex: 1; min-width: 0; }
    .add-btn { background: #646cff; color: white; font-size: 1.2rem; width: 45px; flex-shrink: 0;}
    .empty { color: #666; text-align: center; font-style: italic; margin-top: 40px; }
    
    .task-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .task-item { display: flex; align-items: center; gap: 15px; padding: 12px 15px; background: #333; border-radius: 6px; }
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
    .cal-header-center { display: flex; flex-direction: column; align-items: center; gap: 5px; }
    .cal-header-center h3 { margin: 0; font-size: 1.1rem; }
    .cal-mode-toggle { display: flex; background: #222; border-radius: 4px; overflow: hidden; border: 1px solid #444; }
    .cal-mode-toggle button { background: transparent; color: #888; border: none; padding: 2px 8px; font-size: 0.7rem; border-radius: 0; }
    .cal-mode-toggle button.active { background: #646cff; color: #fff; }
    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .cal-header-cell { text-align: center; color: #888; font-size: 0.8rem; font-weight: bold; padding-bottom: 5px; }
    .cal-cell { background: #2a2a2a; border-radius: 4px; padding: 4px; display: flex; flex-direction: column; gap: 2px; aspect-ratio: 1 / 1; overflow-y: auto; }
    .cal-cell.empty { background: transparent !important; opacity: 0; pointer-events: none; }
    .cal-cell.past-date { background: #1f1f1f; opacity: 0.5; }
    .cal-cell.today-date { border: 1px solid #646cff; background: rgba(100, 108, 255, 0.08); }
    .day-num { font-size: 0.8rem; color: #aaa; text-align: right; }
    .day-num.today-num { color: #646cff; font-weight: bold; }
    .day-tasks { display: flex; flex-direction: column; gap: 2px; }
    .mini-task { background: #646cff; color: #fff; font-size: 0.65rem; padding: 2px 4px; border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .mini-task.blocked { background: #8a6a00; opacity: 0.8; }

    /* Gantt Chart Tab Styles */
    .gantt-chart { background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid #333; display: flex; flex-direction: column; gap: 15px; }
    .gantt-scroll-container { width: 100%; overflow-x: auto; border: 1px solid #333; border-radius: 6px; background: #111; }
    .gantt-grid { display: grid; align-items: center; min-width: 800px; }
    .gantt-header-cell { background: #222; padding: 10px; font-size: 0.8rem; font-weight: bold; color: #888; text-align: center; border-bottom: 1px solid #333; border-right: 1px solid #222; }
    .gantt-header-cell.label-head { text-align: left; color: #fff; background: #1a1a1a; position: sticky; left: 0; z-index: 10; border-right: 2px solid #333; }
    .gantt-header-cell.day-head { font-family: monospace; }
    .gantt-task-title { padding: 12px 10px; font-size: 0.9rem; color: #eee; background: #1a1a1a; border-bottom: 1px solid #262626; border-right: 2px solid #333; position: sticky; left: 0; z-index: 10; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gantt-task-title:hover { background: #252525; color: #646cff; }
    .gantt-row-timeline { display: grid; background: #151515; height: 100%; align-items: center; padding: 0 4px; border-bottom: 1px solid #222; box-sizing: border-box; }
    .gantt-task-bar { background: #646cff; color: #fff; font-size: 0.75rem; font-weight: bold; padding: 6px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-left: 3px solid #4d54d6; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
    .gantt-task-bar:hover { filter: brightness(1.1); }
    .gantt-task-bar.blocked { background: #8a6a00; border-left-color: #b38a00; }
    .gantt-empty-row { padding: 25px; text-align: center; color: #555; font-style: italic; font-size: 0.9rem; }

    /* Agenda View CSS */
    .agenda-view { display: flex; flex-direction: column; gap: 10px; }
    .agenda-item { display: flex; align-items: center; background: #2a2a2a; border-radius: 6px; padding: 12px; cursor: pointer; border-left: 4px solid #646cff; }
    .agenda-item.blocked { opacity: 0.6; border-left-color: #8a6a00; }
    .agenda-date { min-width: 60px; display: flex; flex-direction: column; align-items: center; padding-right: 15px; border-right: 1px solid #444; margin-right: 15px; }
    .agenda-date .day { font-size: 0.75rem; color: #888; text-transform: uppercase; }
    .agenda-date .date { font-size: 0.9rem; font-weight: bold; color: #eee; }
    .agenda-date .no-date { color: #555; font-weight: bold; font-size: 0.8rem;}
    .agenda-content { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 0; }
    .agenda-badges { display: flex; gap: 5px; flex-wrap: wrap; }

    /* Modals */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; z-index: 100; backdrop-filter: blur(3px); }
    .modal { background: #222; padding: 25px; border-radius: 12px; width: 100%; max-width: 450px; display: flex; flex-direction: column; gap: 15px; border: 1px solid #444; box-shadow: 0 10px 30px rgba(0,0,0,0.8); margin: auto; }
    .modal h2 { margin: 0; color: #fff; font-size: 1.3rem; }
    .full-width { width: 100%; box-sizing: border-box; }
    .title-input { font-size: 1.1rem; font-weight: bold; }
    .modal-row { display: flex; align-items: center; gap: 10px; color: #ccc; }
    .reminder-box { display: flex; align-items: center; background: #2a2a2a; padding: 10px 15px; border-radius: 6px; border-left: 3px solid #f1c40f; }
    .description-section { margin-top: 5px; }
    .desc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
    .desc-header label { font-size: 0.9rem; color: #ccc; }
    .simple-textarea { resize: vertical; min-height: 80px; }
    .expand-btn { padding: 4px 8px; font-size: 0.75rem; background: #333; color: #aaa; border: 1px solid #555;}
    .modal-section { background: #1a1a1a; padding: 15px; border-radius: 8px; border: 1px solid #333; }
    .section-toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; background: transparent; border: none; color: #aaa; font-size: 0.9rem; font-weight: bold; padding: 0; cursor: pointer; }
    .section-content { margin-top: 15px; border-top: 1px solid #333; padding-top: 15px; display: flex; flex-direction: column; gap: 15px; }
    .chevron { font-size: 0.8rem; color: #666; }
    .dep-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .dep-badge { background: #333; border: 1px solid #555; padding: 5px 10px; border-radius: 6px; font-size: 0.85rem; display: flex; align-items: center; gap: 8px; color: #ddd; }
    .shared-badge { background: #1b4332; border-color: #2d6a4f; }
    .remove-dep { background: transparent; border: none; color: #ff5555; cursor: pointer; font-weight: bold; font-size: 1rem; }
    .add-dep { display: flex; gap: 8px; }
    .add-dep select { flex: 1; padding: 8px; min-width: 0; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .btn.primary { background: #646cff; color: #fff; }
    .btn.secondary { background: #444; color: #ccc; }
    
    /* Full Workspace layouts */
    .modal.workspace-layout { max-width: 95vw; height: 90vh; display: flex; flex-direction: column; background: #161616; padding: 20px;}
    .modal-header-row { display: flex; justify-content: space-between; align-items: center; }
    .workspace-indicators { display: flex; align-items: center; gap: 15px; }
    .save-indicator { font-size: 0.85rem; color: #2ecc71; font-style: italic; }
    .save-indicator.saving { color: #f1c40f; }
    .small-btn { padding: 6px 12px; font-size: 0.85rem; }
    .workspace-title-bar { width: 100%; margin-top: 5px; }
    .ws-title-input { width: 100%; font-size: 1.4rem; font-weight: bold; background: transparent; border: none; border-bottom: 1px solid #333; padding: 8px 0; color: #fff; }
    .split-editor-container { display: flex; flex: 1; gap: 20px; min-height: 0; margin-top: 10px; }
    .editor-pane, .preview-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%; }
    .pane-header { font-size: 0.8rem; font-weight: bold; color: #666; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 6px; border-bottom: 1px solid #222; margin-bottom: 8px; }
    .ws-textarea { flex: 1; width: 100%; resize: none; background: #111; border: 1px solid #252525; padding: 15px; font-family: monospace; font-size: 1rem; color: #e0e0e0; border-radius: 6px; }
    .preview-pane { background: #1a1a1a; padding: 15px; border-radius: 6px; border: 1px solid #252525; overflow-y: auto; }
    .markdown-body { color: #e0e0e0; font-size: 1.05rem; line-height: 1.6; }
    :global(.markdown-body h1) { font-size: 1.6rem; color: #fff; border-bottom: 1px solid #333; padding-bottom: 6px; }
    :global(.markdown-body h2) { font-size: 1.3rem; color: #f0f0f0; margin-top: 20px; }
    :global(.markdown-body code) { background: #2a2a2a; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    :global(.markdown-body pre) { background: #111; padding: 12px; border-radius: 6px; overflow-x: auto; }
    :global(.markdown-body blockquote) { border-left: 4px solid #646cff; padding-left: 15px; color: #aaa; font-style: italic; }
    :global(.katex-block-wrapper) { display: flex; justify-content: center; width: 100%; margin: 15px 0; }
</style>
