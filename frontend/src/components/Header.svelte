<script>
    import { user, isHeaderCollapsed, currentView, isStudyMode, theme } from '../stores/appStore.js';

    // Catch the build-arg value injected by Vite at compile time
    const appVersion = __APP_VERSION__;

    const ADMIN_EMAIL = 'taylor.d.gleason@gmail.com';
    $: isAdmin = $user?.email && $user.email.toLowerCase() === ADMIN_EMAIL;

    // Handle logout logic
    function handleLogout() {
        window.location.href='/auth/logout';
    }
</script>

<div class="header {$isHeaderCollapsed ? 'collapsed' : ''}">
    <div class="header-title-area">
        <h1>
            Manifest
        </h1>
    </div>
    <div class="theme-toggle">
        <button on:click={() => $theme = $theme === 'dark' ? 'light' : 'dark'} title="Toggle Theme" class="yin-yang-btn">
            ☯
        </button>
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
        {#if isAdmin}
            <button class:active={$currentView === 'admin'} on:click={() => $currentView = 'admin'} style="color: #f59e0b;">Admin ⚡</button>
        {/if}
    </div>
{/if}

<style>
    .header { transition: all 0.3s ease; overflow: hidden; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #232323; padding-bottom: 15px; margin-bottom: 20px; }
    .header.collapsed { padding-bottom: 5px; margin-bottom: 10px; border-bottom: 1px solid var(--border-color); }
    .header.collapsed h1 { font-size: 1.1rem; color: var(--text-color); margin: 0; }
    .header-title-area h1 { margin: 0; font-size: 1.5rem; display: flex; align-items: center; }
    .header-actions { display: flex; align-items: center; gap: 15px; }

    .view-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
    .view-tabs::-webkit-scrollbar { display: none; }
    .view-tabs button { background: none; border: none; color: #777; padding: 8px 14px; cursor: pointer; font-weight: 600; white-space: nowrap; flex-shrink: 0; }
    .view-tabs button.active { background: var(--border-color); color: var(--text-color); border-radius: 4px; }

    .logout-btn { background: var(--btn-secondary-bg); color: #ccc; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; }

    .theme-toggle { margin-right: auto; margin-left: 20px;}
    .yin-yang-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; transition: transform 0.3s ease; color: var(--text-color, #fff);}
    .yin-yang-btn:hover { transform: rotate(180deg); }

    @media (max-width: 768px) {
        .header { padding-bottom: 10px; margin-bottom: 12px; }
        .header-title-area h1 { font-size: 1.2rem; }
        .theme-toggle { margin-left: 10px; }
        .header-actions { gap: 8px; }
        .logout-btn { padding: 6px 10px; font-size: 0.78rem; }
        .view-tabs { gap: 4px; margin-bottom: 12px; padding-bottom: 8px; }
        .view-tabs button { padding: 6px 10px; font-size: 0.82rem; }
    }
</style>