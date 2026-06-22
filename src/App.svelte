<script>
    import { onMount } from 'svelte';
    import { io } from 'socket.io-client'; 
    import StudyView from './StudyView.svelte';

    let user = null; 
    let tasks = []; 
    let allUsers = []; 
    let notifications = [];
    
    let newTaskTitle = '';
    let newTaskDate = '';
    let currentView = 'list';
    let editingTask = null; 
    
    let showAssignees = false;
    let showDependencies = false;
    let showReminder = false;
    let isFullWorkspace = false;
    let saveStatus = "All changes saved";
    let saveTimeout = null;
    let showNotifications = false;
    let pushPermissionStatus = 'default';
    let billingStatusMessage = '';

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

    $: totalCellsNeeded = firstDayOfMonth + daysInMonth;
    $: totalRows = Math.ceil(totalCellsNeeded / 7); 

    $: calendarDays = Array.from({ length: totalRows * 7 }, (_, i) => {
        const dayNum = i - firstDayOfMonth + 1;
        if (dayNum > 0 && dayNum <= daysInMonth) {
            const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const dayTasks = activeTasks.filter(t => t.due_date && t.due_date.startsWith(dateStr));
            const now = new Date();
            const todayNorm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
            return { dayNum, dateStr, tasks: dayTasks, isPast: new Date(currentYear, currentMonth, dayNum, 12) < todayNorm, isToday: dateStr === todayNorm.toISOString().split('T')[0] };
        }
        return null; 
    });

    onMount(async () => {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('billing') === 'success') {
            billingStatusMessage = '🎉 Checkout validation success! Premium server tier capability unlocked.';
            window.history.replaceState({}, document.title, "/");
        } else if (urlParams.get('billing') === 'cancel') {
            billingStatusMessage = 'Stripe financial transaction interface cancelled.';
            window.history.replaceState({}, document.title, "/");
        }

        await checkUser();
        if (user) {
            await Promise.all([loadTasks(), loadUsers(), loadNotifications()]);
            const socket = io(); 
            socket.on('workspace-update', async () => {
                await Promise.all([loadTasks(), loadNotifications()]);
            });
        }
    });

    async function checkUser() { const res = await fetch('/api/user'); if (res.ok) user = await res.json(); }
    async function loadTasks() { const res = await fetch('/api/tasks'); if (res.ok) tasks = await res.json(); }
    async function loadUsers() { const res = await fetch('/api/users'); if (res.ok) allUsers = await res.json(); }
    async function loadNotifications() { const res = await fetch('/api/notifications'); if (res.ok) notifications = await res.json(); }

    async function upgradeToPro() {
        const res = await fetch('/api/checkout', { method: 'POST' });
        const data = await res.json();
        if (data.url) window.location.href = data.url; 
    }
</script>

{#if billingStatusMessage}
    <div class="billing-banner"><span>{billingStatusMessage}</span><button on:click={() => billingStatusMessage = ''}>&times;</button></div>
{/if}

<main>
    <div class="container {currentView === 'study' ? 'study-mode-container' : ''}">
        <div class="header">
            <h1>Manifest <span>- v24 Dashboard</span></h1>
            {#if user}
                <div class="header-actions">
                    <button class="logout-btn" on:click={() => window.location.href='/auth/logout'}>Logout</button>
                </div>
            {/if}
        </div>

        {#if !user}
            <div class="login-box">
                <p>Please log in to manage your tasks.</p>
                <a href="/auth/google" class="btn google-btn">Login with Google</a>
            </div>
        {:else}
            <div class="view-tabs">
                <button class:active={currentView === 'list'} on:click={() => currentView = 'list'}>Registry List</button>
                <button class:active={currentView === 'calendar'} on:click={() => currentView = 'calendar'}>Calendar Tracking</button>
                <button class:active={currentView === 'study'} on:click={() => currentView = 'study'} style="color: #646cff;">📖 Study Room</button>
                <button class:active={currentView === 'settings'} on:click={() => currentView = 'settings'}>Settings Hub</button>
            </div>

            {#if currentView === 'list'}
                <div class="task-input">
                    <input class="flex-2" type="text" bind:value={newTaskTitle} placeholder="Initialize workflow component assignment..." />
                    <button class="add-btn">+</button>
                </div>
                <ul class="task-list">
                    {#each activeTasks as task}
                        <li class="task-item">
                            <div class="task-content"><span class="task-title">{task.title}</span></div>
                        </li>
                    {/each}
                </ul>
            
            {:else if currentView === 'calendar'}
                <div class="calendar">
                    <div class="cal-grid">
                        {#each calendarDays as day}
                            <div class="cal-cell {day ? '' : 'empty'}">
                                {#if day}
                                    <div class="day-num">{day.dayNum}</div>
                                    {#each day.tasks as t}
                                        <div class="mini-task">{t.title}</div>
                                    {/each}
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>

            {:else if currentView === 'study'}
                <StudyView />
                
            {:else if currentView === 'settings'}
                <div class="settings-container">
                    <div class="settings-card">
                        <h3>Premium Subscriptions</h3>
                        <p>Billing Matrix Status Status: <strong>{user.plan_type.toUpperCase()}</strong></p>
                        {#if user.plan_type !== 'pro'}
                            <button class="btn primary" on:click={upgradeToPro}>Upgrade to Server Architecture Tier</button>
                        {/if}
                    </div>
                </div>
            {/if}
        {/if}
    </div>
</main>

<style>
    :global(body) { background: #0c0c0c; color: #e2e8f0; font-family: system-ui, sans-serif; margin: 0; padding: 0; }
    main { padding: 20px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 900px; background: #141414; padding: 25px; border-radius: 10px; border: 1px solid #222; transition: max-width 0.3s ease; }
    .study-mode-container { max-width: 1400px; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #232323; padding-bottom: 15px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 1.6rem; color: #fff; }
    h1 span { font-weight: normal; color: #777; font-size: 1.2rem; }
    .logout-btn { background: #262626; color: #aaa; border: 1px solid #3a3a3a; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; }
    .logout-btn:hover { background: #333; color: #fff; }
    .view-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid #222; padding-bottom: 12px; }
    .view-tabs button { background: none; border: none; color: #777; padding: 8px 16px; cursor: pointer; font-weight: 600; transition: 0.2s;}
    .view-tabs button:hover { color: #fff; }
    .view-tabs button.active { background: #222; color: #fff; border-radius: 4px; border: 1px solid #333; }
    
    .login-box { text-align: center; padding: 4px 0; background: #1a1a1a; border: 1px solid #2d2d2d; border-radius: 8px; margin-top: 40px; }
    .google-btn { display: inline-block; text-decoration: none; background: #4285f4; color: white; border: none; padding: 10px 20px; border-radius: 4px; font-weight: 500; margin-top: 10px; }

    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; align-content: start; }
    .cal-cell { background: #1a1a1a; padding: 4px; border-radius: 4px; aspect-ratio: 1 / 1; min-height: 70px; display: flex; flex-direction: column; }
    .cal-cell.empty { background: transparent; pointer-events: none; opacity: 0; }
    .mini-task { background: #646cff; color: #fff; font-size: 0.65rem; padding: 2px; border-radius: 3px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    
    .task-input { display: flex; gap: 12px; margin-bottom: 25px; }
    .task-input input { flex: 1; background: #181818; border: 1px solid #2b2b2b; color: white; font-size: 1rem; border-radius: 6px; padding: 12px; }
    .add-btn { background: #646cff; color: white; border: none; width: 48px; font-size: 1.5rem; border-radius: 6px; cursor: pointer; font-weight: bold; }
    
    .task-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .task-item { display: flex; align-items: center; background: #1a1a1a; border: 1px solid #262626; padding: 14px 18px; border-radius: 8px; gap: 15px; }
    .task-content { flex: 1; display: flex; align-items: center; }
    .task-title { font-size: 1rem; color: #eee; }
    
    .settings-card { background: #1a1a1a; border: 1px solid #262626; border-radius: 10px; padding: 25px; display: flex; flex-direction: column; gap: 12px; }
    .btn.primary { background: #646cff; color: #fff; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; }
</style>