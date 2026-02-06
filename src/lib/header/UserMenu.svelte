<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { store, user } from '$lib/marcelle/store';
  import type { User } from '$lib/declarations';

  // Reactive user value from the store
  let currentUser: User | undefined;
  user.subscribe((u) => {
    currentUser = u;
  });

  function logout() {
    store.logout().then(() => {
      // Use full page reload to ensure clean state when logging out
      window.location.href = `${base}/login`;
    });
  }
</script>

<div class="dropdown dropdown-end">
  <div tabindex="0" role="button" class="btn btn-ghost btn-circle avatar">
    <div class="w-10 rounded-full p-2">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
        class="size-6"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
        />
      </svg>
    </div>
  </div>
  <ul
    class="mt-3 z-[1] p-2 shadow menu menu-sm dropdown-content bg-base-100 rounded-box w-64"
  >
    {#if currentUser && currentUser?.role !== 'anonymous'}
      <li class="menu-title">
        <span>Hello, <strong>{currentUser?.username || currentUser?.email}</strong></span>
      </li>
      <li>
        <button class="justify-between">
          Preferences
          <span class="badge badge-success">New!</span>
        </button>
      </li>
      <li>
        <button on:click={logout} class="btn-error">Logout</button>
      </li>
    {/if}
  </ul>
</div>
