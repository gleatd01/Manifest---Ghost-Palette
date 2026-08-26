import { writable, derived } from 'svelte/store';

// Global application state

/**
 * user: Holds the currently authenticated user object.
 * Null if the user is not logged in.
 */
export const user = writable(null);

/**
 * theme: Global theme state ('dark' or 'light').
 */
export const theme = writable(localStorage.getItem('theme') || 'dark');
theme.subscribe(val => {
    localStorage.setItem('theme', val);
    if (typeof document !== 'undefined') {
        document.body.className = val;
    }
});

/**
 * allUsers: A list of all available users in the system (used for task assignment).
 */
export const allUsers = writable([]);

/**
 * topics: Holds the entire list of topics for the current user.
 */
export const topics = writable([]);

/**
 * tasks: Holds the entire list of tasks for the current user.
 */
export const tasks = writable([]);

/**
 * currentView: Determines which main view is currently visible.
 * Default is 'list'. Options: 'list', 'calendar', 'agenda', 'gantt', 'settings'.
 */
export const currentView = writable('list');

/**
 * editingTask: Holds the state of the task currently being edited in the modal or study mode.
 * Null if no task is being edited. This allows the modal to be opened from any view.
 */
export const editingTask = writable(null);

/**
 * isStudyMode: A boolean indicating if the application is currently in the immersive Study Mode view.
 */
export const isStudyMode = writable(false);

/**
 * isHeaderCollapsed: Controls the visual state of the main header.
 */
export const isHeaderCollapsed = writable(false);

// Derived state to keep components clean

/**
 * activeTasks: Filters the global task list to only show incomplete tasks.
 */
export const activeTasks = derived(tasks, $tasks => $tasks.filter(t => !t.completed));

/**
 * agendaTasks: A sorted list of active tasks, ordered by due date.
 */
export const agendaTasks = derived(activeTasks, $activeTasks => {
    return [...$activeTasks].sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
    });
});

/**
 * Global helper function to reload tasks from the API.
 * This can be imported and called by any component to refresh the global state.
 */
export async function loadTasks() {
    try {
        const res = await fetch('/api/tasks');
        if (res.ok) {
            const data = await res.json();
            tasks.set(data);
        }
    } catch (e) {
        console.error("Failed to load tasks", e);
    }
}

/**
 * Global helper function to reload topics from the API.
 */
export async function loadTopics() {
    try {
        const res = await fetch('/api/topics');
        if (res.ok) {
            const data = await res.json();
            topics.set(data);
        }
    } catch (e) {
        console.error("Failed to load topics", e);
    }
}
