<script>
    import { onMount } from 'svelte';
    import { user } from '../stores/appStore.js';

    let usersList = [];
    let loading = true;
    let errorMsg = '';
    let successMsg = '';

    const ADMIN_EMAIL = 'taylor.d.gleason@gmail.com';

    $: isAdmin = $user?.email && $user.email.toLowerCase() === ADMIN_EMAIL;

    onMount(() => {
        if (isAdmin) {
            fetchUsers();
        } else {
            loading = false;
        }
    });

    async function fetchUsers() {
        loading = true;
        errorMsg = '';
        try {
            const res = await fetch('/api/admin/users');
            if (res.ok) {
                usersList = await res.json();
            } else {
                const err = await res.json();
                errorMsg = err.error || 'Failed to fetch users';
            }
        } catch (e) {
            errorMsg = 'Network error loading admin user list';
        } finally {
            loading = false;
        }
    }

    async function updatePlan(userId, newPlan) {
        errorMsg = '';
        successMsg = '';
        try {
            const res = await fetch(`/api/admin/users/${userId}/plan`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan_type: newPlan })
            });
            if (res.ok) {
                const data = await res.json();
                successMsg = `Updated user ${data.user.username || data.user.id} plan to ${data.user.plan_type.toUpperCase()}`;
                fetchUsers();
            } else {
                const err = await res.json();
                errorMsg = err.error || 'Failed to update user plan';
            }
        } catch (e) {
            errorMsg = 'Network error updating user plan';
        }
    }
</script>

<div class="admin-card">
    <h2>Admin Dashboard - API Paid Tier Management</h2>
    <p class="subtitle">Access restricted to: <code>{ADMIN_EMAIL}</code></p>

    {#if !isAdmin}
        <div class="alert danger">
            Access Denied: You must be logged in as <strong>{ADMIN_EMAIL}</strong> to view this page.
        </div>
    {:else}
        {#if errorMsg}
            <div class="alert danger">{errorMsg}</div>
        {/if}
        {#if successMsg}
            <div class="alert success">{successMsg}</div>
        {/if}

        {#if loading}
            <p>Loading user accounts...</p>
        {:else}
            <div class="table-container">
                <table class="user-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Username</th>
                            <th>Email</th>
                            <th>Offline Tokens (Google Drive Server Access)</th>
                            <th>Current Plan</th>
                            <th>Admin Manual Override Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each usersList as u}
                            <tr>
                                <td>{u.id}</td>
                                <td>{u.username || 'N/A'}</td>
                                <td>{u.email || 'N/A'}</td>
                                <td>
                                    {#if u.has_offline_token}
                                        <span class="badge success">Active Stored Token</span>
                                    {:else}
                                        <span class="badge warning">No Refresh Token</span>
                                    {/if}
                                </td>
                                <td>
                                    <span class="badge {u.plan_type === 'pro' || u.plan_type === 'paid' ? 'pro' : 'free'}">
                                        {(u.plan_type || 'free').toUpperCase()}
                                    </span>
                                </td>
                                <td>
                                    {#if u.plan_type === 'pro' || u.plan_type === 'paid'}
                                        <button class="btn danger-btn" on:click={() => updatePlan(u.id, 'free')}>
                                            Remove Paid Tier Access
                                        </button>
                                    {:else}
                                        <button class="btn pro-btn" on:click={() => updatePlan(u.id, 'pro')}>
                                            Enable Paid Pro Status
                                        </button>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {/if}
    {/if}
</div>

<style>
    .admin-card {
        background: var(--modal-bg);
        padding: 25px;
        border-radius: 8px;
        border: 1px solid var(--border-color);
        transition: background 0.3s ease;
    }

    .subtitle {
        color: #888;
        font-size: 0.9rem;
        margin-bottom: 20px;
    }

    .alert {
        padding: 12px 16px;
        border-radius: 6px;
        margin-bottom: 15px;
        font-size: 0.9rem;
    }
    .alert.danger {
        background: rgba(239, 68, 68, 0.15);
        color: #f87171;
        border: 1px solid #991b1b;
    }
    .alert.success {
        background: rgba(16, 185, 129, 0.15);
        color: #34d399;
        border: 1px solid #065f46;
    }

    .table-container {
        overflow-x: auto;
        margin-top: 15px;
    }

    .user-table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
    }

    .user-table th, .user-table td {
        padding: 12px 14px;
        border-bottom: 1px solid var(--border-color);
    }

    .user-table th {
        background: rgba(255, 255, 255, 0.05);
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .badge {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: bold;
    }
    .badge.success { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge.warning { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .badge.pro { background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid #4338ca; }
    .badge.free { background: rgba(156, 163, 175, 0.2); color: #9ca3af; }

    .btn {
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 0.8rem;
        cursor: pointer;
        border: none;
        transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.85; }
    .pro-btn { background: #4f46e5; color: white; }
    .danger-btn { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #991b1b; }
</style>
