<script>
    import { tasks, topics, topicsMap, activeTasks, editingTask, loadTasks } from '../stores/appStore.js';
    import { isBlocked, formatTaskForEdit, computeHierarchy } from '../lib/helpers.js';
    import CreateTopicModal from '../components/CreateTopicModal.svelte';

    let newTaskTitle = '';
    let newTaskTopicId = null;
    let selectedTopicFilter = null;
    let showCreateTopicModal = false;

    /**
     * Adds a new task by calling the POST API.
     * On success, reloads the global task store.
     */
    async function addTask() {
        if (!newTaskTitle.trim()) return;
        const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTaskTitle, topic_id: newTaskTopicId })
        });
        if (res.ok) {
            newTaskTitle = '';
            newTaskTopicId = null;
            loadTasks();
        }
    }

    /**
     * Toggles a task's completion status.
     * Prevents toggling if the task is blocked by predecessors.
     */
    async function toggleComplete(task) {
        if (isBlocked(task, $tasks)) return;

        // Optimistic UI update
        task.completed = !task.completed;
        $tasks = [...$tasks];

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

    /**
     * Opens the global task editor modal by setting the editingTask store.
     */
    function openEdit(task) {
        editingTask.set(formatTaskForEdit(task));
    }

    function handleTopicChange(event) {
        if (newTaskTopicId === 'NEW_TOPIC') {
            newTaskTopicId = null;
            showCreateTopicModal = true;
        }
    }

    function handleTopicSaved(event) {
        const topic = event.detail.topic;
        newTaskTopicId = topic.id;
        showCreateTopicModal = false;
    }
</script>

{#if showCreateTopicModal}
    <CreateTopicModal on:close={() => showCreateTopicModal = false} on:save={handleTopicSaved} />
{/if}

<!-- Task Input Area -->
<div class="task-input">
    <input type="text" bind:value={newTaskTitle} placeholder="New task..." />
    <select bind:value={newTaskTopicId} on:change={handleTopicChange} style="background:var(--input-bg); border:1px solid var(--border-color); color:var(--text-color); border-radius:4px; padding:5px; max-width: 150px;">
        <option value={null}>No Topic</option>
        {#each $topics as topic}
            <option value={topic.id}>{topic.name}</option>
        {/each}
        <option value="NEW_TOPIC">+ Add New Topic...</option>
    </select>
    <button class="add-btn" on:click={addTask}>+</button>
</div>

<!-- Topic Filter -->
<div class="topic-filter" style="margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
    <label style="color:var(--text-color); font-size:0.9rem;">Filter by Topic:</label>
    <select bind:value={selectedTopicFilter} style="background:var(--input-bg); border:1px solid var(--border-color); color:var(--text-color); border-radius:4px; padding:5px;">
        <option value={null}>All Topics</option>
        {#each $topics as topic}
            <option value={topic.id}>{topic.name}</option>
        {/each}
    </select>
</div>

<!-- Task List Display -->
<ul class="task-list">
    {#each computeHierarchy($activeTasks).filter(t => selectedTopicFilter === null || t.topic_id === selectedTopicFilter) as task}
        <li class="task-item {isBlocked(task, $tasks) ? 'blocked' : ''}" style="{task.topic_id ? `border-left: 4px solid ${$topicsMap[task.topic_id]?.color || '#333'};` : ''} margin-left: {task._level * 20}px;">
            <input type="checkbox" disabled={isBlocked(task, $tasks)} checked={task.completed} on:change={() => toggleComplete(task)} />
            <div class="task-content" on:click={() => openEdit(task)}>
                <div style="display:flex; flex-direction:column;">
                    <span class="task-title">{task.title}</span>
                    {#if task.topic_id}
                        <span style="font-size: 0.75rem; color: var(--text-color); margin-top: 2px;">
                            {$topicsMap[task.topic_id]?.name || ''}
                        </span>
                    {/if}
                </div>
                {#if isBlocked(task, $tasks)}
                    <span class="badge warning" title="Waiting on predecessor">🔒 Blocked</span>
                {/if}
            </div>
        </li>
    {/each}
</ul>

<style>
    .task-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .task-input input { flex: 1; padding: 10px; background: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-color); border-radius: 4px; }
    .add-btn { background: var(--btn-primary-bg); color: var(--text-color); border: none; padding: 0 20px; font-size: 1.5rem; border-radius: 4px; cursor: pointer; }

    .task-list { list-style: none; padding: 0; margin: 0; }
    .task-item { display: flex; align-items: center; gap: 15px; background: var(--modal-bg); padding: 15px; margin-bottom: 10px; border-radius: 6px; border: 1px solid var(--border-color); cursor: pointer; }
    .task-item.blocked { opacity: 0.5; }

    .badge { background: var(--badge-bg); color: var(--text-color); font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; white-space: nowrap; margin-left:10px; }
    .badge.warning { background: var(--warning-bg); font-weight: bold; }

    .task-content { flex: 1; display: flex; align-items: center; justify-content: space-between; }
</style>