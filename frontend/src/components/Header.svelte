<script>
    import { user, isHeaderCollapsed, currentView, isStudyMode, theme } from '../stores/appStore.js';

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
    </div>
{/if}

<style>
    .header { transition: all 0.3s ease; overflow: hidden; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #232323; padding-bottom: 15px; margin-bottom: 20px; }
    .header.collapsed { padding-bottom: 5px; margin-bottom: 10px; border-bottom: 1px solid #222; }
    .header.collapsed h1 { font-size: 1.1rem; color: #888; margin: 0; }
    .header-title-area h1 { margin: 0; font-size: 1.5rem; display: flex; align-items: center; }
    .header-actions { display: flex; align-items: center; gap: 15px; }

    .view-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid #222; padding-bottom: 12px; }
    .view-tabs button { background: none; border: none; color: #777; padding: 8px 16px; cursor: pointer; font-weight: 600; }
    .view-tabs button.active { background: #222; color: #fff; border-radius: 4px; }

    .logout-btn { background: #333; color: #ccc; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; }
    .btn { padding: 10px 15px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; transition: 0.2s; }
    .btn.secondary { background: var(--btn-secondary-bg, #333); color: var(--btn-secondary-text, white); }
    .btn.secondary:hover { background: var(--btn-secondary-hover-bg, #444); }

    .theme-toggle { margin-right: auto; margin-left: 20px;}
    .yin-yang-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; transition: transform 0.3s ease; color: var(--text-color, #fff);}
    .yin-yang-btn:hover { transform: rotate(180deg); }
</style>