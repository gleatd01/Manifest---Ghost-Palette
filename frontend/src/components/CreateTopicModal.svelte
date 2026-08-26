<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { loadTopics, theme } from '../stores/appStore.js';

    const dispatch = createEventDispatcher();

    let newTopicName = '';
    let newTopicColor = '#646cff';

    function hslToHex(h, s, l) {
        l /= 100;
        const a = s * Math.min(l, 1 - l) / 100;
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    onMount(() => {
        const hue = Math.floor(Math.random() * 360);
        // If light theme, we want a slightly darker color, if dark theme, a lighter color
        const lightness = $theme === 'light' ? 40 : 70;
        const saturation = 70 + Math.floor(Math.random() * 20); // 70-90%
        newTopicColor = hslToHex(hue, saturation, lightness);
    });

    async function addTopic() {
        if (!newTopicName.trim()) return;
        const res = await fetch('/api/topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newTopicName, color: newTopicColor })
        });
        if (res.ok) {
            const topic = await res.json();
            loadTopics();
            dispatch('save', { topic });
            close();
        }
    }

    function close() {
        dispatch('close');
    }
</script>

<div class="modal-overlay">
    <div class="modal">
        <h2>Add New Topic</h2>
        <div class="topic-input">
            <input type="text" bind:value={newTopicName} placeholder="Topic name... (e.g. ECE 503)" />
            <input type="color" bind:value={newTopicColor} title="Auto-generated complementary color. Click to override." />
        </div>
        <div class="modal-actions">
            <button class="btn secondary" on:click={close}>Cancel</button>
            <button class="btn primary" on:click={addTopic}>Save</button>
        </div>
    </div>
</div>

<style>
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 200; overflow-y: auto;}
    .modal { background: var(--modal-bg, #1a1a1a); padding: 25px; border-radius: 8px; width: 400px; border: 1px solid var(--border-color, #333); margin: auto; transition: background 0.3s ease;}
    h2 { margin-top: 0; color: var(--text-color, #ddd); font-size: 1.5rem; margin-bottom: 20px;}
    .topic-input { display: flex; gap: 10px; margin-bottom: 20px; }
    .topic-input input[type="text"] { flex: 1; padding: 10px; background: var(--input-bg, #111); border: 1px solid var(--border-color, #333); color: var(--text-color, white); border-radius: 4px; }
    .topic-input input[type="color"] { width: 50px; height: 100%; cursor: pointer; border: none; background: none; padding: 0; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .btn { padding: 10px 15px; border-radius: 6px; border: none; font-weight: bold; cursor: pointer; transition: 0.2s; }
    .btn.primary { background: #646cff; color: white; }
    .btn.secondary { background: var(--btn-secondary-bg, #333); color: var(--btn-secondary-text, white); }
</style>