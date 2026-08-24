<script>
    import { activeTasks, tasks } from '../stores/appStore.js';
    import { isBlocked } from '../lib/helpers.js';

    $: topLevelTasks = $activeTasks.filter(t => !t.parent_id);
    $: getSubtasks = (parentId) => $activeTasks.filter(t => t.parent_id === parentId);
    $: standaloneSubtasks = $activeTasks.filter(t => t.parent_id && !$activeTasks.some(parent => parent.id === t.parent_id));
</script>

<div class="gantt-view">
    <h2>Project Timeline</h2>
    {#if $activeTasks.length === 0} <p>No tasks to map.</p> {/if}
    {#each topLevelTasks as task}
        <div class="gantt-row parent-row {isBlocked(task, $tasks) ? 'blocked' : ''}">
            <div class="gantt-label">
                {#if isBlocked(task, $tasks)}🔒 {/if}{task.title}
            </div>
            <div class="gantt-bar parent-bar"></div>
        </div>
        {#each getSubtasks(task.id) as subtask}
            <div class="gantt-row subtask-row {isBlocked(subtask, $tasks) ? 'blocked' : ''}">
                <div class="gantt-label subtask-label">
                    <span>└─ {#if isBlocked(subtask, $tasks)}🔒 {/if}{subtask.title}</span>
                </div>
                <div class="gantt-bar subtask-bar"></div>
            </div>
        {/each}
    {/each}

    {#each standaloneSubtasks as subtask}
        <div class="gantt-row subtask-row {isBlocked(subtask, $tasks) ? 'blocked' : ''}">
            <div class="gantt-label subtask-label">
                <span>{#if isBlocked(subtask, $tasks)}🔒 {/if}{subtask.title}</span>
            </div>
            <div class="gantt-bar subtask-bar"></div>
        </div>
    {/each}
</div>

<style>
    .gantt-view { background: #1a1a1a; padding: 20px; border-radius: 8px; }
    .gantt-row { display: flex; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #222; padding-bottom: 10px; }
    .gantt-row.blocked .gantt-bar { background: #8a6a00 !important; opacity: 0.5; }
    .gantt-label { width: 180px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 15px;}
    .gantt-bar { height: 20px; background: #646cff; border-radius: 10px; width: 60%; }

    .subtask-row { padding-left: 15px; background: rgba(100, 108, 255, 0.05); }
    .subtask-label { font-weight: normal; font-size: 0.9rem; color: #bbb; }
    .subtask-bar { height: 16px; background: #646cff; opacity: 0.85; border-radius: 8px; width: 50%; }
</style>