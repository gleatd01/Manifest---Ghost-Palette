<script>
    import { tasks, activeTasks, editingTask, loadTasks } from '../stores/appStore.js';
    import { isBlocked, formatTaskForEdit } from '../lib/helpers.js';

    let newTaskTitle = '';

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
            body: JSON.stringify({ title: newTaskTitle })
        });
        if (res.ok) {
            newTaskTitle = '';
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
</script>

<!-- Task Input Area -->
<div class="task-input">
    <input type="text" bind:value={newTaskTitle} placeholder="New task..." />
    <button class="add-btn" on:click={addTask}>+</button>
</div>

<!-- Task List Display -->
<ul class="task-list">
    {#each topLevelTasks as task}
        <li class="task-item {isBlocked(task, $tasks) ? 'blocked' : ''}">
            <input type="checkbox" disabled={isBlocked(task, $tasks)} checked={task.completed} on:change={() => toggleComplete(task)} />
            <div class="task-content" on:click={() => openEdit(task)}>
                <span class="task-title">{task.title}</span>
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

        {#each getSubtasks(task.id) as subtask}
            <li class="task-item subtask-item {isBlocked(subtask, $tasks) ? 'blocked' : ''}">
                <span class="subtask-indent-icon">└─</span>
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
    {/each}
</ul>

<style>
    .task-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .task-input input { flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #333; color: white; border-radius: 4px; }
    .add-btn { background: #646cff; color: white; border: none; padding: 0 20px; font-size: 1.5rem; border-radius: 4px; cursor: pointer; }

    .task-list { list-style: none; padding: 0; margin: 0; }
    .task-item { display: flex; align-items: center; gap: 15px; background: #1a1a1a; padding: 15px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #222; cursor: pointer; }
    .task-item.blocked { opacity: 0.5; }

    .subtask-item { margin-left: 30px; background: #141414; border-left: 3px solid #646cff; border-top: 1px solid #222; margin-top: -5px; }
    .subtask-indent-icon { color: #646cff; font-weight: bold; font-family: monospace; }
    .completed { text-decoration: line-through; color: #777; }

    .badges { display: flex; gap: 6px; align-items: center; }
    .badge { background: #555; color: #ddd; font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; white-space: nowrap; margin-left:0; }
    .badge.warning { background: #8a6a00; font-weight: bold; }
    .badge.info { background: #2b4c7e; }
    .badge.subtask-badge { background: #3b3b5c; color: #a5b4fc; }

    .task-content { flex: 1; display: flex; align-items: center; justify-content: space-between; }
</style>