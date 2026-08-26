<script>
    import { activeTasks, tasks, topics } from '../stores/appStore.js';
    import { isBlocked } from '../lib/helpers.js';
</script>

<div class="gantt-view">
    <h2>Project Timeline</h2>
    {#if $activeTasks.length === 0} <p>No tasks to map.</p> {/if}
    {#each $activeTasks as task}
        <div class="gantt-row {isBlocked(task, $tasks) ? 'blocked' : ''}">
            <div class="gantt-label">
                {#if isBlocked(task, $tasks)}🔒 {/if}{task.title}
            </div>
            <div class="gantt-bar" style={task.topic_id ? `background-color: ${$topics.find(t => t.id === task.topic_id)?.color || '#646cff'};` : ''}></div>
        </div>
    {/each}
</div>

<style>
    .gantt-view { background: var(--modal-bg, #1a1a1a); padding: 20px; border-radius: 8px; transition: background 0.3s ease; }
    .gantt-row { display: flex; align-items: center; margin-bottom: 10px; border-bottom: 1px solid var(--border-color, #222); padding-bottom: 10px; }
    .gantt-row.blocked .gantt-bar { background: #8a6a00; opacity: 0.5; }
    .gantt-label { width: 150px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 15px;}
    .gantt-bar { height: 20px; background: #646cff; border-radius: 10px; width: 60%; }
</style>