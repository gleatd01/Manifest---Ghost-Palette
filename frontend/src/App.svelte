<script>
    import { onMount } from 'svelte';
    import {
        user, allUsers, currentView, editingTask, isStudyMode,
        isHeaderCollapsed, loadTasks
    } from './stores/appStore.js';

    import Header from './components/Header.svelte';
    import TaskEditModal from './components/TaskEditModal.svelte';

    // Lazy load views to improve initial render time and segregate features
    const ViewMap = {
        list: () => import('./views/ListView.svelte'),
        calendar: () => import('./views/CalendarView.svelte'),
        agenda: () => import('./views/AgendaView.svelte'),
        gantt: () => import('./views/GanttView.svelte'),
        settings: () => import('./views/SettingsView.svelte'),
    };

    let activeComponent = null;

    // Reactively load the correct component when the currentView changes
    $: if ($currentView && !$isStudyMode) {
        ViewMap[$currentView]().then(module => {
            activeComponent = module.default;
        }).catch(err => console.error("Failed to load view:", err));
    }

    // Reactively load Study Mode if it is activated
    $: if ($isStudyMode) {
        import('./views/StudyMode.svelte').then(module => {
            activeComponent = module.default;
        }).catch(err => console.error("Failed to load Study Mode:", err));
    }

    onMount(async () => {
        // Register Service Worker
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js');
                console.log("Service Worker registered successfully:", registration);
                navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
            } catch (err) {
                console.error("Service worker registration failed:", err);
            }
        }

        await checkUser();
        if ($user) {
            loadTasks();
            loadUsers();
            import('./stores/appStore.js').then(module => {
                if (module.loadTopics) module.loadTopics();
            });
        }
    });

    /**
     * Checks if a user is authenticated on the backend.
     */
    async function checkUser() {
        const res = await fetch('/api/user');
        if (res.ok) {
            const userData = await res.json();
            user.set(userData);

            // Sync timezone if possible
            try {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                fetch('/api/user/timezone', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ timezone: tz })
                }).catch(e => console.log("Timezone sync backgrounded"));
            } catch(e){}
        }
    }

    /**
     * Loads the list of all available users (for sharing tasks).
     */
    async function loadUsers() {
        const res = await fetch('/api/users');
        if (res.ok) {
            allUsers.set(await res.json());
        }
    }

    // Catch the build-arg value injected by Vite at compile time
    const appVersion = __APP_VERSION__;
</script>

<main>
    <!-- Container dynamically expands if Study Mode is active -->
    <div class="container {$isStudyMode ? 'study-expanded' : ''}">

        <Header />

        {#if !$user}
            <div class="login-box">
                <p>Welcome! V30 requires Google Drive access to save your audio recordings and PDFs securely into the Manifest Ghost folder.</p>
                <a href="/auth/google" class="btn google-btn">Login with Google</a>
            </div>
        {:else}
            <!-- Dynamically injected view based on currentView or isStudyMode state -->
            {#if activeComponent}
                <svelte:component this={activeComponent} />
            {/if}
        {/if}

        <!-- The Modal sits at the top level so it can be triggered from ANY view via the editingTask store -->
        {#if $editingTask && !$isStudyMode}
            <TaskEditModal />
        {/if}

    </div>

    <div class="version-info">
        Version: {appVersion}
    </div>
</main>

<style>
    :global(body) {
        --bg-color: #0c0c0c;
        --text-color: #e2e8f0;
        --container-bg: #141414;
        --border-color: #222;
        --modal-bg: #1a1a1a;
        --input-bg: #111;
        --btn-secondary-bg: #333;
        --btn-secondary-text: white;
        background: var(--bg-color);
        color: var(--text-color);
        font-family: system-ui, sans-serif; margin: 0; padding: 0;
        transition: background 0.3s ease, color 0.3s ease;
    }
    :global(body.light) {
        --bg-color: #f0f4f8;
        --text-color: #1a202c;
        --container-bg: #ffffff;
        --border-color: #cbd5e1;
        --modal-bg: #f8fafc;
        --input-bg: #ffffff;
        --btn-secondary-bg: #e2e8f0;
        --btn-secondary-text: #1e293b;
    }

    main { padding: 20px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 900px; background: var(--container-bg); padding: 25px; border-radius: 10px; border: 1px solid var(--border-color); position: relative; transition: background 0.3s ease;}
    .study-expanded { max-width: 1500px; height: 95vh; display: flex; flex-direction: column; overflow: hidden; }

    .version-info {
        text-align: center;
        font-size: 0.7rem;
        color: var(--text-color);
        opacity: 0.5;
        margin-top: 20px;
    }

    .login-box { text-align: center; padding: 40px; background: var(--modal-bg); border: 1px solid var(--border-color); border-radius: 8px; margin-top: 20px;}
    .google-btn { display: inline-block; background: #4285f4; color: white; text-decoration: none; padding: 10px 20px; border-radius: 4px; font-weight: 500; margin-top: 15px; }
</style>