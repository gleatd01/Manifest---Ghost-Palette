<script>
    import { topics, loadTopics } from '../stores/appStore.js';
    import CreateTopicModal from './CreateTopicModal.svelte';

    let showCreateModal = false;

    async function deleteTopic(id) {
        if (!confirm("Are you sure you want to delete this topic?")) return;
        const res = await fetch(`/api/topics/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadTopics();
        }
    }
</script>

<div class="settings-section">
    <h3>Manage Topics / Classes</h3>

    <div style="margin-bottom: 20px;">
        <button class="btn primary" on:click={() => showCreateModal = true}>+ Add Topic</button>
    </div>

    <ul class="topic-list">
        {#each $topics as topic}
            <li class="topic-item">
                <div class="topic-info">
                    <span class="color-swatch" style="background-color: {topic.color};"></span>
                    <span class="topic-name">{topic.name}</span>
                </div>
                <button class="btn danger small-btn" on:click={() => deleteTopic(topic.id)}>Delete</button>
            </li>
        {/each}
    </ul>
</div>

{#if showCreateModal}
    <CreateTopicModal on:close={() => showCreateModal = false} on:save={() => showCreateModal = false} />
{/if}

<style>
    .settings-section { background: var(--modal-bg); padding: 20px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 20px; transition: background 0.3s ease;}
    h3 { margin-top: 0; color: var(--text-color, #ddd); margin-bottom: 15px; }

    .small-btn { padding: 5px 10px; font-size: 0.8rem; }

    .topic-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .topic-item { display: flex; align-items: center; justify-content: space-between; background: var(--input-bg); padding: 10px 15px; border-radius: 6px; border: 1px solid var(--border-color); transition: background 0.3s ease;}
    .topic-info { display: flex; align-items: center; gap: 10px; }
    .color-swatch { width: 16px; height: 16px; border-radius: 50%; display: inline-block; }
</style>