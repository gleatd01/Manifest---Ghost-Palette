<script>
    import { editingTask, tasks, topics, allUsers, isStudyMode, isHeaderCollapsed, loadTasks } from '../stores/appStore.js';
    import { getTaskName, getUserName } from '../lib/helpers.js';
    import CreateTopicModal from './CreateTopicModal.svelte';

    let showAssignees = false;
    let showDependencies = false;
    let showReminder = !!$editingTask?.reminder_time;
    let selectedDep = null;
    let selectedAssignee = null;

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

    async function deleteTask() {
        if (!confirm("Are you sure you want to delete this task?")) return;
        const res = await fetch(`/api/tasks/${$editingTask.id}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            closeEdit();
            loadTasks();
        }
    }

    function closeEdit() {
        editingTask.set(null);
    }

    function openStudyMode() {
        isStudyMode.set(true);
        isHeaderCollapsed.set(true);
        // We do not close the editor state completely, because StudyMode relies on $editingTask.
    }

    let showCreateTopicModal = false;
    let newSubtaskTitle = '';

    async function addSubtask() {
        if (!newSubtaskTitle.trim()) return;
        const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: newSubtaskTitle,
                parent_id: $editingTask.id,
                topic_id: $editingTask.topic_id
            })
        });
        if (res.ok) {
            newSubtaskTitle = '';
            loadTasks();
        }
    }

    async function toggleSubtaskComplete(task) {
        let p = typeof task.predecessors === 'string' ? JSON.parse(task.predecessors) : (task.predecessors || []);
        let a = typeof task.assignees === 'string' ? JSON.parse(task.assignees) : (task.assignees || []);

        const res = await fetch(`/api/tasks/${task.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...task,
                completed: !task.completed,
                dueDate: task.due_date,
                predecessors: p,
                assignees: a,
                reminderTime: task.reminder_time,
                reminderFrequency: task.reminder_frequency
            })
        });
        if (res.ok) {
            loadTasks();
        }
    }

    function handleTopicChange() {
        if ($editingTask.topic_id === 'NEW_TOPIC') {
            $editingTask.topic_id = null;
            showCreateTopicModal = true;
        }
    }

    function handleTopicSaved(event) {
        const topic = event.detail.topic;
        $editingTask.topic_id = topic.id;
        showCreateTopicModal = false;
    }
</script>

{#if showCreateTopicModal}
    <CreateTopicModal on:close={() => showCreateTopicModal = false} on:save={handleTopicSaved} />
{/if}

<div class="modal-overlay">
    <div class="modal">
        <h2>Edit Task</h2>
        <input class="full-width" type="text" bind:value={$editingTask.title} style="padding:10px; background:var(--input-bg); border:1px solid var(--border-color); color:var(--text-color); margin-bottom:15px; border-radius:4px;"/>

        <div class="modal-row" style="justify-content: space-between; margin-bottom: 10px; display:flex;">
            <div style="display:flex; align-items:center; gap:10px;">
                <label style="color:var(--text-color); font-size:0.9rem;">Due Date:</label>
                <input type="date" bind:value={$editingTask.due_date} style="background:var(--input-bg); border:1px solid var(--border-color); color:var(--text-color); border-radius:4px; padding:5px;"/>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <label style="color:var(--text-color); font-size:0.9rem;">Topic:</label>
                <select bind:value={$editingTask.topic_id} on:change={handleTopicChange} style="background:var(--input-bg); border:1px solid var(--border-color); color:var(--text-color); border-radius:4px; padding:5px;">
                    <option value={null}>No Topic</option>
                    {#each $topics as t}
                        <option value={t.id}>{t.name}</option>
                    {/each}
                    <option value="NEW_TOPIC">+ Add New Topic...</option>
                </select>
            </div>
            <button class="btn secondary small-btn" on:click={() => showReminder = !showReminder} title="Set Recurring Reminder">
                ⏰ {showReminder ? 'Remove Reminder' : 'Add Reminder'}
            </button>
        </div>

        {#if showReminder}
            <div class="reminder-box">
                <label>Remind me at:</label>
                <input type="time" bind:value={$editingTask.reminder_time} />
                <select bind:value={$editingTask.reminder_frequency} style="margin-left: 10px; width: auto; background:var(--input-bg); border:1px solid var(--border-color); color:var(--text-color); padding:5px;">
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
                        <select bind:value={selectedAssignee} style="flex:1; background:var(--input-bg); border:1px solid var(--border-color); color:var(--text-color); padding:5px;">
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
                        <select bind:value={selectedDep} style="flex:1; background:var(--input-bg); border:1px solid var(--border-color); color:var(--text-color); padding:5px;">
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

        <div class="modal-section" style="margin-bottom: 15px;">
            <div class="section-content" style="border-top: none; margin-top: 0; padding-top: 0;">
                <label style="color:var(--text-color); font-size:0.9rem; font-weight:bold; display:block; margin-bottom:10px;">Subtasks</label>
                <div class="subtask-list" style="margin-bottom: 10px; max-height: 150px; overflow-y: auto;">
                    {#each $tasks.filter(t => t.parent_id === $editingTask.id) as subtask}
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:5px;">
                            <input type="checkbox" checked={subtask.completed} on:change={() => toggleSubtaskComplete(subtask)} />
                            <span style="color:var(--text-color); text-decoration: {subtask.completed ? 'line-through' : 'none'}; opacity: {subtask.completed ? 0.6 : 1};">{subtask.title}</span>
                        </div>
                    {/each}
                    {#if $tasks.filter(t => t.parent_id === $editingTask.id).length === 0}
                        <span style="color: #666; font-size: 0.85rem; font-style: italic;">No subtasks yet.</span>
                    {/if}
                </div>
                <div class="add-subtask" style="display:flex; gap:8px;">
                    <input type="text" bind:value={newSubtaskTitle} placeholder="New subtask..." style="flex:1; background:var(--input-bg); border:1px solid var(--border-color); color:var(--text-color); padding:5px; border-radius:4px;" on:keydown={(e) => e.key === 'Enter' && addSubtask()} />
                    <button class="btn secondary" on:click={addSubtask}>Add</button>
                </div>
            </div>
        </div>

        <div class="study-launch-banner">
            <p>Want to write LaTeX notes alongside an Audio Transcription?</p>
            <button class="btn primary full-width" on:click={openStudyMode}>📚 Open Study Mode (Attach PDF & Audio)</button>
        </div>

        <div class="modal-actions" style="justify-content: space-between;">
            <button class="btn danger" on:click={deleteTask}>Delete Task</button>
            <div style="display: flex; gap: 10px;">
                <button class="btn secondary" on:click={closeEdit}>Cancel</button>
                <button class="btn primary" on:click={() => {saveEdit(); closeEdit();}}>Save</button>
            </div>
        </div>
    </div>
</div>

<style>
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100; overflow-y: auto;}
    .modal { background: var(--modal-bg); padding: 25px; border-radius: 8px; width: 450px; border: 1px solid var(--border-color); margin: auto; transition: background 0.3s ease;}
    .study-launch-banner { background: var(--input-bg); padding: 15px; border-radius: 6px; margin: 20px 0; border: 1px solid #2a2a5a; text-align: center; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

    .full-width { width: 100%; box-sizing: border-box; }

    .modal-section { background: var(--input-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); margin-top: 10px; transition: background 0.3s ease;}
    .section-toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; background: transparent; border: none; color: var(--text-color); font-size: 0.9rem; font-weight: bold; padding: 0; cursor: pointer;}
    .section-content { margin-top: 10px; border-top: 1px solid var(--border-color); padding-top: 10px; display: flex; flex-direction: column; gap: 10px; }
    .chevron { font-size: 0.8rem; color: #666; }
    .dep-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .dep-badge { background: var(--btn-secondary-bg); border: 1px solid #555; padding: 5px 10px; border-radius: 6px; font-size: 0.85rem; display: flex; align-items: center; gap: 8px; color: var(--text-color); }
    .shared-badge { background: #1b4332; border-color: #2d6a4f; }
    .remove-dep { background: transparent; border: none; color: #ff5555; cursor: pointer; font-weight: bold; padding: 0 4px; font-size: 1rem; }
    .add-dep { display: flex; gap: 8px; }
    .reminder-box { display: flex; align-items: center; background: var(--input-bg); padding: 10px 15px; border-radius: 6px; border-left: 3px solid #f1c40f; margin-bottom: 15px; }
    .reminder-box label { font-size: 0.9rem; margin-right: 10px; color: var(--text-color);}
</style>