<script>
    import { tasks, activeTasks, editingTask, topics } from '../stores/appStore.js';
    import { isBlocked, formatTaskForEdit } from '../lib/helpers.js';

    let calendarMode = 'month';
    let currentDate = new Date();

    // Reactive statements to compute calendar grid data
    $: currentMonth = currentDate.getMonth();
    $: currentYear = currentDate.getFullYear();
    $: daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    $: firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
    $: currentWeekStart = new Date(currentYear, currentMonth, currentDate.getDate() - currentDate.getDay());

    // Generate data for the week view
    $: weekDays = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate() + i, 12);
        const dateStr = d.toISOString().split('T')[0];
        const dayTasks = $tasks.filter(t => !t.completed && t.due_date && t.due_date.startsWith(dateStr));
        return { dayNum: d.getDate(), dateStr, tasks: dayTasks, dateObj: d };
    });

    /**
     * Navigates the calendar backward or forward.
     * @param {number} dir -1 for previous, 1 for next.
     */
    function changeDate(dir) {
        if (calendarMode === 'month') {
            currentDate = new Date(currentYear, currentMonth + dir, 1);
        } else {
            currentDate = new Date(currentYear, currentMonth, currentDate.getDate() + (dir * 7));
        }
    }

    /**
     * Opens the editor for the clicked task.
     */
    function openEdit(task) {
        editingTask.set(formatTaskForEdit(task));
    }
</script>

<div class="calendar">
    <div class="cal-controls">
        <div class="cal-view-toggles">
            <button class:active={calendarMode==='month'} on:click={() => calendarMode='month'}>Month</button>
            <button class:active={calendarMode==='week'} on:click={() => calendarMode='week'}>Week</button>
        </div>
        <div class="cal-nav">
            <button on:click={() => changeDate(-1)}>◀ Prev</button>
            <div class="cal-header-title">
                <h3>
                    {#if calendarMode === 'month'}
                        {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                    {:else}
                        Week of {currentWeekStart.toLocaleDateString()}
                    {/if}
                </h3>
            </div>
            <button on:click={() => changeDate(1)}>Next ▶</button>
        </div>
    </div>

    {#if calendarMode === 'month'}
        <div class="cal-grid">
            {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as day}<div class="cal-header-cell">{day}</div>{/each}
            {#each Array(firstDayOfMonth) as _}<div class="cal-cell empty"></div>{/each}
            {#each Array(daysInMonth) as _, i}
                <div class="cal-cell">
                    <div class="day-num">{i + 1}</div>
                    {#each $activeTasks.filter(t => t.due_date && new Date(t.due_date).getDate() === (i+1) && new Date(t.due_date).getMonth() === currentMonth) as t}
                        <div class="mini-task {isBlocked(t, $tasks) ? 'blocked' : ''}" on:click={() => openEdit(t)} style={t.topic_id ? `border-left: 3px solid ${$topics.find(top => top.id === t.topic_id)?.color || 'transparent'};` : ''}>{t.title}</div>
                    {/each}
                </div>
            {/each}
        </div>
    {:else}
        <div class="cal-grid week-grid">
            {#each weekDays as wd}
                <div class="cal-cell">
                    <div class="day-header">{wd.dateObj.toLocaleString('default', {weekday: 'short'})} {wd.dayNum}</div>
                    {#each wd.tasks as t}
                        <div class="mini-task {isBlocked(t, $tasks) ? 'blocked' : ''}" on:click={() => openEdit(t)} style={t.topic_id ? `border-left: 3px solid ${$topics.find(top => top.id === t.topic_id)?.color || 'transparent'};` : ''}>{t.title}</div>
                    {/each}
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .cal-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
    .cal-view-toggles button { background: var(--input-bg); color: var(--text-color); border: 1px solid var(--border-color); padding: 5px 15px; border-radius: 4px; cursor: pointer;}
    .cal-view-toggles button.active { background: var(--btn-primary-bg); color: var(--text-color); border-color: var(--btn-primary-bg); }
    .cal-nav { display: flex; align-items: center; gap: 15px; }
    .cal-nav button { background: var(--btn-secondary-bg); color: var(--text-color); border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; }
    .cal-header-title { min-width: 180px; text-align: center; }

    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
    .cal-header-cell { text-align: center; font-weight: bold; color: var(--text-color); padding-bottom: 10px; }
    .cal-cell { background: var(--modal-bg); min-height: 80px; padding: 5px; border-radius: 4px; display: flex; flex-direction: column;}
    .cal-cell.empty { background: transparent; }
    .day-num { text-align: right; color: #666; font-size: 0.8rem; margin-bottom: 5px;}
    .day-header { text-align: center; font-weight: bold; color: var(--text-color); font-size: 0.85rem; padding-bottom: 5px; border-bottom: 1px solid var(--border-color); margin-bottom: 5px; }

    .mini-task { background: var(--btn-primary-bg); color: var(--text-color); font-size: 0.7rem; padding: 3px 5px; border-radius: 2px; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .mini-task.blocked { background: var(--warning-bg); opacity: 0.8; }
</style>