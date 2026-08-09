<script>
    import { user, isHeaderCollapsed, currentView, isStudyMode } from '../stores/appStore.js';

    // Catch the build-arg value injected by Vite at compile time
    const appVersion = __APP_VERSION__;

    // Handle logout logic
    function handleLogout() {
        window.location.href='/auth/logout';
    }
</script>

<div class="header {$isHeaderCollapsed ? 'collapsed' : ''}">
    <div class="header-title-area">
        <h1>
            Manifest
            {#if !$isHeaderCollapsed}
                <span>- v30 Studio</span>
            {/if}
            <span class="app-build-stamp">{appVersion}</span>
        </h1>
    </div>
    {#if $user}
        <div class="header-actions">
            <button class="btn secondary small-btn" style="padding: 4px 8px; font-size: 0.75rem;" on:click={() => $isHeaderCollapsed = !$isHeaderCollapsed} title="Toggle Header">
                {$isHeaderCollapsed ? '⛶ Expand' : '🗕 Collapse'}
            </button>
            {#if !$isHeaderCollapsed}
                <button class="logout-btn" on:click={handleLogout}>Logout</button>
            {/if}
        </div>
    {/if}
</div>

{#if $user && !$isStudyMode}
    <div class="view-tabs">
        <button class:active={$currentView === 'list'} on:click={() => $currentView = 'list'}>Task List</button>
        <button class:active={$currentView === 'calendar'} on:click={() => $currentView = 'calendar'}>Calendar</button>
        <button class:active={$currentView === 'agenda'} on:click={() => $currentView = 'agenda'}>Agenda</button>
        <button class:active={$currentView === 'gantt'} on:click={() => $currentView = 'gantt'}>Gantt</button>
        <button class:active={$currentView === 'settings'} on:click={() => $currentView = 'settings'}>Settings</button>
    </div>
{/if}

<style>
    .header { transition: all 0.3s ease; overflow: hidden; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #232323; padding-bottom: 15px; margin-bottom: 20px; }
    .header.collapsed { padding-bottom: 5px; margin-bottom: 10px; border-bottom: 1px solid #222; }
    .header.collapsed h1 { font-size: 1.1rem; color: #888; margin: 0; }
    .header-title-area h1 { margin: 0; font-size: 1.5rem; display: flex; align-items: center; }
    .header-title-area h1 span { color: #777; font-weight: normal; font-size: 1.2rem; }
    .header.collapsed h1 span { font-size: 1rem; }
    .header-actions { display: flex; align-items: center; gap: 15px; }

    .app-build-stamp {
        font-size: 0.6rem;
        font-family: monospace;
        color: #555;
        background: #1a1a1a;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 10px;
        font-weight: normal;
        letter-spacing: 0.5px;
        border: 1px solid #2a2a2a;
        user-select: none;
    }
    .header.collapsed .app-build-stamp {
        font-size: 0.55rem;
        padding: 1px 4px;
        margin-left: 6px;
    }

    .view-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid #222; padding-bottom: 12px; }
    .view-tabs button { background: none; border: none; color: #777; padding: 8px 16px; cursor: pointer; font-weight: 600; }
    .view-tabs button.active { background: #222; color: #fff; border-radius: 4px; }

    .logout-btn { background: #333; color: #ccc; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; }
    .btn { padding: 10px 15px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; transition: 0.2s; }
    .btn.secondary { background: #333; color: white; }
    .btn.secondary:hover { background: #444; }
</style>