<script>
    import { activeTasks, tasks } from '../stores/appStore.js';
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
            <div class="gantt-bar"></div>
        </div>
    {/each}
</div>

<style>
    .gantt-view { background: #1a1a1a; padding: 20px; border-radius: 8px; }
    .gantt-row { display: flex; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #222; padding-bottom: 10px; }
    .gantt-row.blocked .gantt-bar { background: #8a6a00; opacity: 0.5; }
    .gantt-label { width: 150px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 15px;}
    .gantt-bar { height: 20px; background: #646cff; border-radius: 10px; width: 60%; }
</style>