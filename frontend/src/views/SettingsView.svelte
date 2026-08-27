<script>
    import { user } from '../stores/appStore.js';
    import { onMount } from 'svelte';
    import TopicManager from '../components/TopicManager.svelte';

    let apiKeys = [];
    let newKeyName = '';
    let generatedCleartextKey = '';
    let showKeyModal = false;

    // Fetch keys when the component mounts
    onMount(() => {
        fetchApiKeys();
    });

    async function fetchApiKeys() {
        const res = await fetch('/api/settings/keys');
        if (res.ok) apiKeys = await res.json();
    }

    async function generateKey() {
        if (!newKeyName.trim()) return;
        const res = await fetch('/api/settings/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyName: newKeyName })
        });
        if (res.ok) {
            const data = await res.json();
            generatedCleartextKey = data.key;
            showKeyModal = true;
            newKeyName = '';
            fetchApiKeys();
        }
    }

    async function revokeKey(id) {
        if (!confirm("Wipe this system token?")) return;
        const res = await fetch(`/api/settings/keys/${id}`, { method: 'DELETE' });
        if (res.ok) fetchApiKeys();
    }
</script>

<div class="settings-card">
    <h2>Account & Billing</h2>
    <p>Plan: <strong>{$user?.plan_type ? $user.plan_type.toUpperCase() : 'FREE'}</strong></p>
    {#if $user?.plan_type !== 'pro'}
        <button class="btn primary" on:click={async () => { const res = await fetch('/api/checkout', {method:'POST'}); const d = await res.json(); if(d.url) window.location.href = d.url; }}>Upgrade to Pro Server Tier</button>
    {/if}
</div>

<TopicManager />

<div class="settings-card" style="margin-top: 20px;">
    <h2>API Integrations (Power Automate)</h2>
    <div class="task-input">
        <input type="text" bind:value={newKeyName} placeholder="Key description..." style="padding:10px; background:var(--input-bg); border:1px solid var(--border-color); color:var(--text-color); border-radius:4px; flex:1;" />
        <button class="btn primary" on:click={generateKey}>Generate</button>
    </div>
    {#if apiKeys.length > 0}
        <ul class="task-list" style="margin-top:15px;">
            {#each apiKeys as k}
                <li class="task-item" style="justify-content: space-between; padding: 10px;">
                    <div>{k.key_name} <span style="color:#666; font-size:0.8rem; margin-left:10px;">{new Date(k.created_at).toLocaleDateString()}</span></div>
                    <button class="btn secondary" style="background: rgba(255, 85, 85, 0.2); color:#ff8a8a; border: 1px solid #822222; font-size:0.8rem;" on:click={() => revokeKey(k.id)}>Revoke</button>
                </li>
            {/each}
        </ul>
    {/if}
</div>

{#if showKeyModal}
    <div class="modal-overlay" style="z-index: 200;">
        <div class="modal" style="border-color: #f59e0b;">
            <h2 style="color: #f59e0b;">Secret Key Generated</h2>
            <div style="background: var(--code-bg); padding:15px; color:#10b981; font-family:monospace; word-break:break-all; border-radius:4px; margin: 15px 0;">{generatedCleartextKey}</div>
            <button class="btn primary full-width" on:click={() => {showKeyModal = false; generatedCleartextKey = '';}}>I Have Copied The Key</button>
        </div>
    </div>
{/if}

<style>
    .settings-card { background: var(--modal-bg); padding: 20px; border-radius: 8px; border: 1px solid var(--border-color); transition: background 0.3s ease;}

    .task-input { display: flex; gap: 10px; margin-bottom: 20px; }

    .task-list { list-style: none; padding: 0; margin: 0; }
    .task-item { display: flex; align-items: center; gap: 15px; background: var(--modal-bg); padding: 15px; margin-bottom: 10px; border-radius: 6px; border: 1px solid var(--border-color); transition: background 0.3s ease;}

    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100; overflow-y: auto;}
    .modal { background: var(--modal-bg); padding: 25px; border-radius: 8px; width: 450px; border: 1px solid var(--border-color); margin: auto; transition: background 0.3s ease;}
    .full-width { width: 100%; box-sizing: border-box; }
</style>