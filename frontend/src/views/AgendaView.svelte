<script>
    import { agendaTasks, tasks, editingTask, topics } from '../stores/appStore.js';
    import { isBlocked, formatTaskForEdit } from '../lib/helpers.js';

    /**
     * Opens the editor for the clicked task.
     */
    function openEdit(task) {
        editingTask.set(formatTaskForEdit(task));
    }
</script>

<div class="agenda-view">
    <h2>Agenda Timeline</h2>
    {#if $agendaTasks.length === 0}
        <p class="empty" style="color:#666; font-style:italic;">No tasks on the agenda.</p>
    {/if}
    {#each $agendaTasks as task}
        <div class="agenda-item {task.completed ? 'completed' : ''} {isBlocked(task, $tasks) ? 'blocked' : ''}" on:click={() => openEdit(task)} style={task.topic_id ? `border-left: 4px solid ${$topics.find(t => t.id === task.topic_id)?.color || '#333'};` : ''}>
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
                    {#if isBlocked(task, $tasks)}<span class="badge warning">🔒 Blocked</span>{/if}
                    {#if task.reminder_time}<span class="badge">⏰ {task.reminder_time}</span>{/if}
                </div>
            </div>
        </div>
    {/each}
</div>

<style>
    .agenda-view { background: var(--modal-bg); padding: 20px; border-radius: 8px; transition: background 0.3s ease; }
    .agenda-item { display: flex; align-items: center; background: var(--input-bg); border: 1px solid var(--border-color); padding: 12px; margin-bottom: 10px; border-radius: 6px; border-left: 4px solid #646cff; cursor: pointer; transition: background 0.3s ease;}
    .agenda-item.blocked { opacity: 0.5; border-left-color: #8a6a00;}

    .agenda-date { min-width: 80px; display: flex; flex-direction: column; align-items: center; padding-right: 15px; border-right: 1px solid var(--border-color); margin-right: 15px; }
    .agenda-date .date { font-size: 1.1rem; font-weight: bold; color: var(--text-color, #eee); }

    .agenda-content { flex: 1; display: flex; flex-direction: column; justify-content: center; }
    .task-title { font-weight: bold; margin-bottom: 5px; }
    .agenda-badges { display: flex; gap: 5px; }

    .badge { background: var(--badge-bg); color: var(--text-color); font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; white-space: nowrap; margin-left: 0; }
    .badge.warning { background: var(--warning-bg); font-weight: bold; }
</style>