<script>
    import { onMount } from 'svelte';

    let user = null;
    let tasks = [];
    let newTaskTitle = '';

    onMount(async () => {
        await checkUser();
        if (user) await loadTasks();
    });

    async function checkUser() {
        try {
            const res = await fetch('/api/user');
            if (res.ok) {
                user = await res.json();
            }
        } catch (e) {
            console.error(e);
        }
    }

    async function loadTasks() {
        const res = await fetch('/api/tasks');
        if (res.ok) {
            tasks = await res.json();
        }
    }

    async function addTask() {
        if (!newTaskTitle.trim()) return;
        const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTaskTitle })
        });
        if (res.ok) {
            const newTask = await res.json();
            tasks = [newTask, ...tasks];
            newTaskTitle = '';
        }
    }
    
    async function logout() {
        await fetch('/auth/logout', { method: 'POST' });
        user = null;
        tasks = [];
    }
</script>

<main>
    <div class="container">
        <h1>Manifest <span>- Ghost Palette</span></h1>
        
        {#if !user}
            <div class="login-box">
                <p>Please log in to manage your tasks.</p>
                <a href="/auth/google" class="btn google-btn">Login with Google</a>
            </div>
        {:else}
            <div class="header">
                <p>Welcome, <strong>{user.username}</strong></p>
                <button class="logout-btn" on:click={logout}>Logout</button>
            </div>

            <div class="task-input">
                <input 
                    type="text" 
                    bind:value={newTaskTitle} 
                    placeholder="Add a new task..." 
                    on:keydown={(e) => e.key === 'Enter' && addTask()} 
                />
                <button class="add-btn" on:click={addTask}>+</button>
            </div>

            {#if tasks.length === 0}
                <p class="empty">No tasks yet. You're all caught up!</p>
            {/if}

            <ul class="task-list">
                {#each tasks as task}
                    <li>
                        <label>
                            <input type="checkbox" checked={task.completed} />
                            <span>{task.title}</span>
                        </label>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
</main>

<style>
    main { 
        display: flex; 
        justify-content: center; 
        padding-top: 50px; 
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
    }
    .container {
        width: 100%;
        max-width: 400px;
        background: #2a2a2a;
        padding: 30px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    }
    h1 { margin-top: 0; font-size: 1.5rem; color: #fff; }
    h1 span { font-weight: normal; color: #888; font-size: 1.2rem; }
    
    .btn, button { 
        padding: 10px 15px; 
        cursor: pointer; 
        border: none; 
        border-radius: 6px; 
        font-weight: bold;
        transition: 0.2s;
    }
    .google-btn {
        display: inline-block;
        background: #fff;
        color: #333;
        text-decoration: none;
        width: 100%;
        text-align: center;
        box-sizing: border-box;
    }
    .logout-btn { background: #444; color: #ccc; padding: 6px 12px; }
    .logout-btn:hover { background: #555; color: #fff; }
    
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; color: #bbb; border-bottom: 1px solid #444; padding-bottom: 15px;}
    
    .task-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .task-input input { 
        flex: 1; 
        padding: 10px; 
        border-radius: 6px; 
        border: 1px solid #444; 
        background: #1a1a1a; 
        color: #fff; 
    }
    .add-btn { background: #646cff; color: white; font-size: 1.2rem; width: 40px; }
    .add-btn:hover { background: #747bff; }

    .empty { color: #666; text-align: center; font-style: italic; }
    
    .task-list { list-style: none; padding: 0; margin: 0; }
    .task-list li { 
        padding: 12px; 
        background: #333; 
        margin-bottom: 8px; 
        border-radius: 6px; 
    }
    .task-list label { display: flex; align-items: center; gap: 10px; cursor: pointer; }
    .task-list input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }
</style>