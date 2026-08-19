/**
 * Checks if a task is blocked by examining its predecessors.
 * A task is blocked if any of its predecessors are incomplete.
 *
 * @param {Object} task The task to check.
 * @param {Array} tasks The global array of tasks to check against.
 * @returns {boolean} True if the task is blocked, false otherwise.
 */
export function isBlocked(task, tasks) {
    if (!task.predecessors || task.predecessors.length === 0) return false;
    let parsed = typeof task.predecessors === 'string' ? JSON.parse(task.predecessors) : task.predecessors;

    const taskMap = new Map();
    for (let i = 0; i < tasks.length; i++) {
        taskMap.set(tasks[i].id, tasks[i]);
    }

    return parsed.some(pid => {
        const p = taskMap.get(pid);
        return p && !p.completed;
    });
}

/**
 * Returns the human-readable title of a task by its ID.
 *
 * @param {number} id The task ID.
 * @param {Array} tasks The global array of tasks.
 * @returns {string} The task title, or 'Unknown Task'.
 */
export function getTaskName(id, tasks) {
    const t = tasks.find(t => t.id === id);
    return t ? t.title : 'Unknown Task';
}

/**
 * Returns the human-readable username of a user by their ID.
 *
 * @param {number} id The user ID.
 * @param {Array} allUsers The global array of users.
 * @returns {string} The username, or 'Unknown User'.
 */
export function getUserName(id, allUsers) {
    const u = allUsers.find(u => u.id === id);
    return u ? u.username : 'Unknown User';
}

/**
 * Formats a task for editing, parsing JSON strings into arrays where necessary.
 *
 * @param {Object} task The raw task from the database.
 * @returns {Object} The formatted task ready for the editor.
 */
export function formatTaskForEdit(task) {
    return {
        ...task,
        due_date: task.due_date ? task.due_date.split('T')[0] : '',
        predecessors: typeof task.predecessors === 'string' ? JSON.parse(task.predecessors) : (task.predecessors || []),
        assignees: typeof task.assignees === 'string' ? JSON.parse(task.assignees) : (task.assignees || []),
        reminder_time: task.reminder_time || '',
        reminder_frequency: task.reminder_frequency || 'daily'
    };
}
