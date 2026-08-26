<script>
    import { tasks, topics, activeTasks, editingTask, loadTasks } from '../stores/appStore.js';
    import { isBlocked, formatTaskForEdit } from '../lib/helpers.js';
    import CreateTopicModal from '../components/CreateTopicModal.svelte';

    let newTaskTitle = '';
    let newTaskTopicId = null;
    let selectedTopicFilter = null;
    let showCreateTopicModal = false;

    $: topLevelTasks = $activeTasks.filter(t => !t.parent_id);
    $: getSubtasks = (parentId) => $tasks.filter(t => t.parent_id === parentId);

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
                parentId: task.parent_id || null,
                predecessors: p,
                assignees: a,
                reminderTime: task.reminder_time,
                reminderFrequency: task.reminder_frequency,
                topic_id: task.topic_id || null
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
    <select bind:value={newTaskTopicId} on:change={handleTopicChange} style="background:var(--input-bg, #1a1a1a); border:1px solid var(--border-color, #333); color:var(--text-color, white); border-radius:4px; padding:5px; max-width: 150px;">
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
    <label style="color:var(--text-color, #aaa); font-size:0.9rem;">Filter by Topic:</label>
    <select bind:value={selectedTopicFilter} style="background:var(--input-bg, #1a1a1a); border:1px solid var(--border-color, #333); color:var(--text-color, white); border-radius:4px; padding:5px;">
        <option value={null}>All Topics</option>
        {#each $topics as topic}
            <option value={topic.id}>{topic.name}</option>
        {/each}
    </select>
</div>

<!-- Task List Display -->
<ul class="task-list">
    {#each topLevelTasks.filter(t => selectedTopicFilter === null || t.topic_id === selectedTopicFilter) as task}
        <li class="task-item {isBlocked(task, $tasks) ? 'blocked' : ''}" style={task.topic_id ? `border-left: 4px solid ${$topics.find(t => t.id === task.topic_id)?.color || '#333'};` : ''}>
            <input type="checkbox" disabled={isBlocked(task, $tasks)} checked={task.completed} on:change={() => toggleComplete(task)} />
            <div class="task-content" on:click={() => openEdit(task)}>
                <div style="display:flex; flex-direction:column;">
                    <span class="task-title">{task.title}</span>
                    {#if task.topic_id}
                        <span style="font-size: 0.75rem; color: #888; margin-top: 2px;">
                            {$topics.find(t => t.id === task.topic_id)?.name || ''}
                        </span>
                    {/if}
                </div>
                <div class="badges">
                    {#if getSubtasks(task.id).length > 0}
                        <span class="badge info">{getSubtasks(task.id).filter(s => s.completed).length}/{getSubtasks(task.id).length} Subtasks</span>
                    {/if}
                    {#if isBlocked(task, $tasks)}
                        <span class="badge warning" title="Waiting on predecessor">🔒 Blocked</span>
                    {/if}
                </div>
            </div>
        </li>

        {#if getSubtasks(task.id).length > 0}
            <li class="subtask-container">
                <ul class="subtask-checklist">
                    {#each getSubtasks(task.id) as subtask}
                        <li class="subtask-item {isBlocked(subtask, $tasks) ? 'blocked' : ''}" style={subtask.topic_id ? `border-left: 3px solid ${$topics.find(t => t.id === subtask.topic_id)?.color || '#333'};` : ''}>
                            <input type="checkbox" disabled={isBlocked(subtask, $tasks)} checked={subtask.completed} on:change={() => toggleComplete(subtask)} />
                            <div class="task-content" on:click={() => openEdit(subtask)}>
                                <span class="task-title {subtask.completed ? 'completed' : ''}">{subtask.title}</span>
                                <div class="badges">
                                    <span class="badge subtask-badge">Subtask</span>
                                    {#if isBlocked(subtask, $tasks)}
                                        <span class="badge warning" title="Waiting on predecessor">🔒 Blocked</span>
                                    {/if}
                                </div>
                            </div>
                        </li>
                    {/each}
                </ul>
            </li>
        {/if}
    {/each}
</ul>

<style>
    .task-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .task-input input { flex: 1; padding: 10px; background: var(--input-bg, #1a1a1a); border: 1px solid var(--border-color, #333); color: var(--text-color, white); border-radius: 4px; }
    .add-btn { background: #646cff; color: white; border: none; padding: 0 20px; font-size: 1.5rem; border-radius: 4px; cursor: pointer; }

    .task-list { list-style: none; padding: 0; margin: 0; }
    .task-item { display: flex; align-items: center; gap: 15px; background: var(--modal-bg, #1a1a1a); padding: 15px; margin-bottom: 10px; border-radius: 6px; border: 1px solid var(--border-color, #222); cursor: pointer; }
    .task-item.blocked { opacity: 0.5; }

    .subtask-container { list-style: none; padding: 0; margin: -5px 0 10px 25px; border-left: 2px solid var(--border-color, #333); }
    .subtask-checklist { list-style: none; padding: 0 0 0 15px; margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .subtask-item { display: flex; align-items: center; gap: 12px; background: var(--modal-bg, #141414); padding: 10px 12px; border-radius: 4px; border: 1px solid var(--border-color, #222); cursor: pointer; }
    .completed { text-decoration: line-through; color: #777; }

    .badges { display: flex; gap: 6px; align-items: center; }
    .badge { background: #555; color: #ddd; font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; white-space: nowrap; margin-left:0; }
    .badge.warning { background: #8a6a00; font-weight: bold; }
    .badge.info { background: #2b4c7e; }
    .badge.subtask-badge { background: #3b3b5c; color: #a5b4fc; }

    .task-content { flex: 1; display: flex; align-items: center; justify-content: space-between; }
</style>