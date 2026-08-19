<script>
    import { tasks, activeTasks, editingTask, loadTasks } from '../stores/appStore.js';
    import { isBlocked, formatTaskForEdit } from '../lib/helpers.js';

    let newTaskTitle = '';

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
    {#each $activeTasks as task}
        <li class="task-item {isBlocked(task, $tasks) ? 'blocked' : ''}">
            <input type="checkbox" disabled={isBlocked(task, $tasks)} checked={task.completed} on:change={() => toggleComplete(task)} />
            <div class="task-content" on:click={() => openEdit(task)}>
                <span class="task-title">{task.title}</span>
                {#if isBlocked(task, $tasks)}
                    <span class="badge warning" title="Waiting on predecessor">🔒 Blocked</span>
                {/if}
            </div>
        </li>
    {/each}
</ul>

<style>
    .task-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .task-input input { flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #333; color: white; border-radius: 4px; }
    .add-btn { background: #646cff; color: white; border: none; padding: 0 20px; font-size: 1.5rem; border-radius: 4px; cursor: pointer; }

    .task-list { list-style: none; padding: 0; margin: 0; }
    .task-item { display: flex; align-items: center; gap: 15px; background: #1a1a1a; padding: 15px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #222; cursor: pointer; }
    .task-item.blocked { opacity: 0.5; }

    .badge { background: #555; color: #ddd; font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; white-space: nowrap; margin-left:10px; }
    .badge.warning { background: #8a6a00; font-weight: bold; }

    .task-content { flex: 1; display: flex; align-items: center; justify-content: space-between; }
</style>