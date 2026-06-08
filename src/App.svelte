<script>
    import { onMount } from 'svelte';

    let user = null;
    let tasks = [];
    let newTaskTitle = '';
    let newTaskDate = '';
    
    // UI State
    let currentView = 'list'; // 'list' or 'calendar'
    let editingTask = null; // Holds the clone of the task being edited
    
    // Calendar State
    let currentDate = new Date();
    $: currentMonth = currentDate.getMonth();
    $: currentYear = currentDate.getFullYear();
    $: daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    $: firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

    $: activeTasks = tasks.filter(t => !t.completed);

    // Generate Calendar Grid
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
        if (user) await loadTasks();
    });

    async function checkUser() {
        const res = await fetch('/api/user');
        if (res.ok) user = await res.json();
    }

    async function loadTasks() {
        const res = await fetch('/api/tasks');
        if (res.ok) tasks = await res.json();
    }

    async function addTask() {
        if (!newTaskTitle.trim()) return;
        const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTaskTitle, dueDate: newTaskDate || null })
        });
        if (res.ok) {
            const newTask = await res.json();
            tasks = [newTask, ...tasks];
            newTaskTitle = '';
            newTaskDate = '';
        }
    }
    
    async function toggleComplete(task) {
        // Toggle instantly in UI for snappy feel
        task.completed = !task.completed;
        tasks = [...tasks]; 

        await fetch(`/api/tasks/${task.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...task })
        });
    }

    function openEdit(task) {
        // Create a clone to edit without affecting UI instantly
        editingTask = { ...task, due_date: task.due_date ? task.due_date.split('T')[0] : '' };
    }

    async function saveEdit() {
        const res = await fetch(`/api/tasks/${editingTask.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                title: editingTask.title,
                description: editingTask.description,
                dueDate: editingTask.due_date,
                completed: editingTask.completed
            })
        });
        if (res.ok) {
            const updatedTask = await res.json();
            tasks = tasks.map(t => t.id === updatedTask.id ? updatedTask : t);
            editingTask = null;
        }
    }

    function changeMonth(offset) {
        currentDate = new Date(currentYear, currentMonth + offset, 1);
    }
    
    async function logout() {
        await fetch('/auth/logout', { method: 'POST' });
        user = null;
        tasks = [];
    }
</script>

<main>
    <div class="container">
        <div class="header">
            <h1>Manifest <span>- Ghost Palette</span></h1>
            {#if user}
                <button class="logout-btn" on:click={logout}>Logout</button>
            {/if}
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
                    <input class="flex-2" type="text" bind:value={newTaskTitle} placeholder="New task..." on:keydown={(e) => e.key === 'Enter' && addTask()} />
                    <input class="flex-1" type="date" bind:value={newTaskDate} />
                    <button class="add-btn" on:click={addTask}>+</button>
                </div>

                {#if activeTasks.length === 0}
                    <p class="empty">No tasks yet. You're all caught up!</p>
                {/if}

                <ul class="task-list">
                    {#each activeTasks as task}
                        <li class="task-item">
                            <input type="checkbox" checked={task.completed} on:change={() => toggleComplete(task)} />
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <div class="task-content" on:click={() => openEdit(task)}>
                                <span class="task-title">{task.title}</span>
                                {#if task.due_date}
                                    <span class="badge">{task.due_date.split('T')[0]}</span>
                                {/if}
                                {#if task.description}
                                    <span class="desc-indicator">☰</span>
                                {/if}
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
                        {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as day}
                            <div class="cal-header-cell">{day}</div>
                        {/each}
                        {#each calendarDays as dayObj}
                            <div class="cal-cell {dayObj ? '' : 'empty'}">
                                {#if dayObj}
                                    <div class="day-num">{dayObj.dayNum}</div>
                                    <div class="day-tasks">
                                        {#each dayObj.tasks as t}
                                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                                            <div class="mini-task" on:click={() => openEdit(t)}>{t.title}</div>
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

    <!-- Edit Task Modal -->
    {#if editingTask}
        <div class="modal-overlay">
            <div class="modal">
                <h2>Task Details</h2>
                <input class="full-width" type="text" bind:value={editingTask.title} placeholder="Task Title" />
                <textarea class="full-width" bind:value={editingTask.description} placeholder="Add notes, links, or a detailed description here..." rows="4"></textarea>
                <div class="modal-row">
                    <label>Due Date:</label>
                    <input type="date" bind:value={editingTask.due_date} />
                </div>
                <div class="modal-actions">
                    <button class="btn secondary" on:click={() => editingTask = null}>Cancel</button>
                    <button class="btn primary" on:click={saveEdit}>Save</button>
                </div>
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

    input, textarea { padding: 10px; border-radius: 6px; border: 1px solid #444; background: #1a1a1a; color: #fff; font-family: inherit; }
    .task-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .flex-2 { flex: 2; min-width: 0; }
    .flex-1 { flex: 1; min-width: 0; }
    .add-btn { background: #646cff; color: white; font-size: 1.2rem; width: 45px; flex-shrink: 0;}
    
    .empty { color: #666; text-align: center; font-style: italic; margin-top: 40px; }
    
    .task-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .task-item { display: flex; align-items: center; gap: 15px; padding: 12px 15px; background: #333; border-radius: 6px; transition: 0.2s; }
    .task-item:hover { background: #3a3a3a; }
    .task-item input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: #646cff; margin: 0; }
    .task-content { flex: 1; display: flex; align-items: center; gap: 10px; cursor: pointer; min-width: 0; }
    .task-title { color: #eee; font-size: 1.05rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
    .badge { background: #555; color: #ddd; font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; white-space: nowrap; }
    .desc-indicator { color: #888; font-size: 0.9rem; }

    /* Calendar Styles */
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

    /* Modal Styles */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box; z-index: 100; backdrop-filter: blur(3px); }
    .modal { background: #222; padding: 25px; border-radius: 12px; width: 100%; max-width: 450px; display: flex; flex-direction: column; gap: 15px; border: 1px solid #444; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
    .modal h2 { margin: 0; color: #fff; font-size: 1.3rem; }
    .full-width { width: 100%; box-sizing: border-box; }
    .modal-row { display: flex; align-items: center; gap: 10px; color: #ccc; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; }
    .btn.primary { background: #646cff; color: #fff; }
    .btn.secondary { background: #444; color: #ccc; }
    .btn.secondary:hover { background: #555; }
</style>