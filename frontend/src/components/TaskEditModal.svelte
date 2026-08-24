<script>
    import { editingTask, tasks, allUsers, isStudyMode, isHeaderCollapsed, loadTasks } from '../stores/appStore.js';
    import { getTaskName, getUserName } from '../lib/helpers.js';

    let showAssignees = false;
    let showDependencies = false;
    let showSubtasks = true;
    let showReminder = !!$editingTask?.reminder_time;
    let selectedDep = null;
    let selectedAssignee = null;
    let newSubtaskTitle = '';
    let selectedExistingTaskAsSubtask = null;

    $: subtasks = $tasks.filter(t => t.parent_id === $editingTask.id);

    async function createSubtask() {
        if (!newSubtaskTitle.trim()) return;
        const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: newSubtaskTitle,
                parentId: $editingTask.id
            })
        });
        if (res.ok) {
            newSubtaskTitle = '';
            await loadTasks();
        }
    }

    async function linkExistingSubtask() {
        if (!selectedExistingTaskAsSubtask) return;
        const target = $tasks.find(t => t.id === selectedExistingTaskAsSubtask);
        if (!target) return;
        let p = typeof target.predecessors === 'string' ? JSON.parse(target.predecessors) : (target.predecessors || []);
        let a = typeof target.assignees === 'string' ? JSON.parse(target.assignees) : (target.assignees || []);

        await fetch(`/api/tasks/${target.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...target,
                dueDate: target.due_date,
                parentId: $editingTask.id,
                predecessors: p,
                assignees: a,
                reminderTime: target.reminder_time,
                reminderFrequency: target.reminder_frequency
            })
        });
        selectedExistingTaskAsSubtask = null;
        await loadTasks();
    }

    async function unlinkSubtask(subtask) {
        let p = typeof subtask.predecessors === 'string' ? JSON.parse(subtask.predecessors) : (subtask.predecessors || []);
        let a = typeof subtask.assignees === 'string' ? JSON.parse(subtask.assignees) : (subtask.assignees || []);

        await fetch(`/api/tasks/${subtask.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...subtask,
                dueDate: subtask.due_date,
                parentId: null,
                predecessors: p,
                assignees: a,
                reminderTime: subtask.reminder_time,
                reminderFrequency: subtask.reminder_frequency
            })
        });
        await loadTasks();
    }

    async function toggleSubtaskComplete(subtask) {
        subtask.completed = !subtask.completed;
        let p = typeof subtask.predecessors === 'string' ? JSON.parse(subtask.predecessors) : (subtask.predecessors || []);
        let a = typeof subtask.assignees === 'string' ? JSON.parse(subtask.assignees) : (subtask.assignees || []);

        await fetch(`/api/tasks/${subtask.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...subtask,
                dueDate: subtask.due_date,
                parentId: subtask.parent_id,
                predecessors: p,
                assignees: a,
                reminderTime: subtask.reminder_time,
                reminderFrequency: subtask.reminder_frequency
            })
        });
        await loadTasks();
    }

    function editSubtask(subtask) {
        editingTask.set(formatTaskForEdit(subtask));
    }

    // Helper functions for array manipulation
    function addDep() {
        if (selectedDep && !$editingTask.predecessors.includes(selectedDep)) {
            $editingTask.predecessors = [...$editingTask.predecessors, selectedDep];
            selectedDep = null;
        }
    }
    function removeDep(id) { $editingTask.predecessors = $editingTask.predecessors.filter(pid => pid !== id); }

    function addAssignee() {
        if (selectedAssignee && !$editingTask.assignees.includes(selectedAssignee)) {
            $editingTask.assignees = [...$editingTask.assignees, selectedAssignee];
            selectedAssignee = null;
        }
    }
    function removeAssignee(id) { $editingTask.assignees = $editingTask.assignees.filter(uid => uid !== id); }

    async function saveEdit() {
        await fetch(`/api/tasks/${$editingTask.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...$editingTask,
                dueDate: $editingTask.due_date,
                predecessors: $editingTask.predecessors,
                assignees: $editingTask.assignees,
                reminderTime: showReminder && $editingTask.reminder_time ? $editingTask.reminder_time : null,
                reminderFrequency: showReminder && $editingTask.reminder_frequency ? $editingTask.reminder_frequency : null
            })
        });
        loadTasks(); // Update the global state
    }

    function closeEdit() {
        editingTask.set(null);
    }

    function openStudyMode() {
        isStudyMode.set(true);
        isHeaderCollapsed.set(true);
        // We do not close the editor state completely, because StudyMode relies on $editingTask.
    }
</script>

<div class="modal-overlay">
    <div class="modal">
        <h2>Edit Task</h2>
        <input class="full-width" type="text" bind:value={$editingTask.title} style="padding:10px; background:#111; border:1px solid #333; color:white; margin-bottom:15px; border-radius:4px;"/>

        <div class="modal-row" style="justify-content: space-between; margin-bottom: 10px;">
            <div style="display:flex; align-items:center; gap:10px;">
                <label style="color:#aaa; font-size:0.9rem;">Due Date:</label>
                <input type="date" bind:value={$editingTask.due_date} style="background:#111; border:1px solid #333; color:white; border-radius:4px; padding:5px;"/>
            </div>
            <button class="btn secondary small-btn" on:click={() => showReminder = !showReminder} title="Set Recurring Reminder">
                ⏰ {showReminder ? 'Remove Reminder' : 'Add Reminder'}
            </button>
        </div>

        {#if showReminder}
            <div class="reminder-box">
                <label>Remind me at:</label>
                <input type="time" bind:value={$editingTask.reminder_time} />
                <select bind:value={$editingTask.reminder_frequency} style="margin-left: 10px; width: auto; background:#111; border:1px solid #333; color:white; padding:5px;">
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
                        {#if $editingTask.assignees.length === 0}
                            <span style="color: #666; font-size: 0.85rem; font-style: italic;">Private (Only you)</span>
                        {/if}
                        {#each $editingTask.assignees as uid}
                            <span class="dep-badge shared-badge">
                                {getUserName(uid, $allUsers)}
                                <button class="remove-dep" on:click={() => removeAssignee(uid)}>x</button>
                            </span>
                        {/each}
                    </div>
                    <div class="add-dep">
                        <select bind:value={selectedAssignee} style="flex:1; background:#111; border:1px solid #333; color:white; padding:5px;">
                            <option value={null}>-- Select user to share with --</option>
                            {#each $allUsers.filter(u => u.id !== $editingTask.user_id && !$editingTask.assignees.includes(u.id)) as u}
                                <option value={u.id}>{u.username}</option>
                            {/each}
                        </select>
                        <button class="btn secondary" on:click={addAssignee}>Add</button>
                    </div>
                </div>
            {/if}
        </div>

        <div class="modal-section">
            <button class="section-toggle" on:click={() => showSubtasks = !showSubtasks}>
                <span>Subtasks & Checklist ({subtasks.filter(s => s.completed).length}/{subtasks.length})</span>
                <span class="chevron">{showSubtasks ? '▼' : '▶'}</span>
            </button>
            {#if showSubtasks}
                <div class="section-content">
                    {#if subtasks.length === 0}
                        <span style="color: #666; font-size: 0.85rem; font-style: italic;">No subtasks created yet.</span>
                    {/if}
                    <ul class="subtask-checklist">
                        {#each subtasks as sub}
                            <li class="subtask-item">
                                <input type="checkbox" checked={sub.completed} on:change={() => toggleSubtaskComplete(sub)} />
                                <span class="subtask-title {sub.completed ? 'completed' : ''}" on:click={() => editSubtask(sub)} title="Click to edit subtask">
                                    {sub.title}
                                </span>
                                {#if sub.due_date}
                                    <span class="subtask-date">📅 {sub.due_date.split('T')[0]}</span>
                                {/if}
                                <button class="remove-dep" on:click={() => unlinkSubtask(sub)} title="Unlink subtask">x</button>
                            </li>
                        {/each}
                    </ul>

                    <div class="add-subtask-form" style="display:flex; gap:8px;">
                        <input type="text" placeholder="Add new subtask..." bind:value={newSubtaskTitle} on:keydown={(e) => e.key === 'Enter' && createSubtask()} style="flex:1; background:#111; border:1px solid #333; color:white; padding:5px; border-radius:4px;" />
                        <button class="btn secondary" on:click={createSubtask}>+ Add</button>
                    </div>

                    {#if $tasks.filter(t => t.id !== $editingTask.id && t.parent_id !== $editingTask.id).length > 0}
                        <div class="add-dep">
                            <select bind:value={selectedExistingTaskAsSubtask} style="flex:1; background:#111; border:1px solid #333; color:white; padding:5px;">
                                <option value={null}>-- Or link an existing task as subtask --</option>
                                {#each $tasks.filter(t => t.id !== $editingTask.id && t.parent_id !== $editingTask.id) as t}
                                    <option value={t.id}>{t.title}</option>
                                {/each}
                            </select>
                            <button class="btn secondary" on:click={linkExistingSubtask}>Link</button>
                        </div>
                    {/if}
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
                        {#if $editingTask.predecessors.length === 0}
                            <span style="color: #666; font-size: 0.85rem; font-style: italic;">No dependencies.</span>
                        {/if}
                        {#each $editingTask.predecessors as pid}
                            <span class="dep-badge">
                                {getTaskName(pid, $tasks)}
                                <button class="remove-dep" on:click={() => removeDep(pid)}>x</button>
                            </span>
                        {/each}
                    </div>
                    <div class="add-dep">
                        <select bind:value={selectedDep} style="flex:1; background:#111; border:1px solid #333; color:white; padding:5px;">
                            <option value={null}>-- Select a prerequisite task --</option>
                            {#each $tasks.filter(t => t.id !== $editingTask.id && !$editingTask.predecessors.includes(t.id)) as t}
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

<style>
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100; overflow-y: auto;}
    .modal { background: #1a1a1a; padding: 25px; border-radius: 8px; width: 450px; border: 1px solid #333; margin: auto;}
    .study-launch-banner { background: #1f1f3a; padding: 15px; border-radius: 6px; margin: 20px 0; border: 1px solid #2a2a5a; text-align: center; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

    .btn { padding: 10px 15px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; transition: 0.2s; }
    .btn.primary { background: #646cff; color: white; }
    .btn.secondary { background: #333; color: white; }
    .full-width { width: 100%; box-sizing: border-box; }

    .modal-section { background: #111; padding: 12px; border-radius: 6px; border: 1px solid #222; margin-top: 10px;}
    .section-toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; background: transparent; border: none; color: #aaa; font-size: 0.9rem; font-weight: bold; padding: 0; cursor: pointer;}
    .section-content { margin-top: 10px; border-top: 1px solid #222; padding-top: 10px; display: flex; flex-direction: column; gap: 10px; }
    .chevron { font-size: 0.8rem; color: #666; }
    .dep-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .dep-badge { background: #333; border: 1px solid #555; padding: 5px 10px; border-radius: 6px; font-size: 0.85rem; display: flex; align-items: center; gap: 8px; color: #ddd; }
    .shared-badge { background: #1b4332; border-color: #2d6a4f; }
    .remove-dep { background: transparent; border: none; color: #ff5555; cursor: pointer; font-weight: bold; padding: 0 4px; font-size: 1rem; }
    .add-dep { display: flex; gap: 8px; }
    .reminder-box { display: flex; align-items: center; background: #2a2a2a; padding: 10px 15px; border-radius: 6px; border-left: 3px solid #f1c40f; margin-bottom: 15px; }
    .reminder-box label { font-size: 0.9rem; margin-right: 10px; color:#aaa;}

    .subtask-checklist { list-style: none; padding: 0; margin: 0 0 10px 0; display: flex; flex-direction: column; gap: 6px; }
    .subtask-item { display: flex; align-items: center; gap: 8px; background: #1a1a1a; padding: 6px 10px; border-radius: 4px; border: 1px solid #2a2a2a; }
    .subtask-title { flex: 1; cursor: pointer; font-size: 0.9rem; }
    .subtask-title.completed { text-decoration: line-through; color: #777; }
    .subtask-date { font-size: 0.75rem; color: #888; }
</style>