<script>
    import { topics, loadTopics } from '../stores/appStore.js';

    let newTopicName = '';
    let newTopicColor = '#646cff';

    async function addTopic() {
        if (!newTopicName.trim()) return;
        const res = await fetch('/api/topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newTopicName, color: newTopicColor })
        });
        if (res.ok) {
            newTopicName = '';
            newTopicColor = '#646cff';
            loadTopics();
        }
    }

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

    <div class="topic-input">
        <input type="text" bind:value={newTopicName} placeholder="New topic name... (e.g. ECE 503)" />
        <input type="color" bind:value={newTopicColor} />
        <button class="btn primary" on:click={addTopic}>Add Topic</button>
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

<style>
    .settings-section { background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid #333; margin-bottom: 20px; }
    h3 { margin-top: 0; color: #ddd; }

    .topic-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .topic-input input[type="text"] { flex: 1; padding: 10px; background: #111; border: 1px solid #333; color: white; border-radius: 4px; }
    .topic-input input[type="color"] { width: 50px; height: 100%; cursor: pointer; border: none; background: none; padding: 0; }

    .btn { padding: 10px 15px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; transition: 0.2s; }
    .btn.primary { background: #646cff; color: white; }
    .btn.danger { background: #ff5555; color: white; }
    .small-btn { padding: 5px 10px; font-size: 0.8rem; }

    .topic-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .topic-item { display: flex; align-items: center; justify-content: space-between; background: #111; padding: 10px 15px; border-radius: 6px; border: 1px solid #222; }
    .topic-info { display: flex; align-items: center; gap: 10px; }
    .color-swatch { width: 16px; height: 16px; border-radius: 50%; display: inline-block; }
</style>