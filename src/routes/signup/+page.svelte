<script context="module">
  import { store } from '$lib/marcelle/store';
  import { base } from '$app/paths';

  export async function load() {
    try {
      await store.connect();
      // Only redirect if authenticated with a real account (not anonymous)
      if (store.user && store.user.role !== 'anonymous') {
        return { status: 302, redirect: `${base}/` };
      }
      return {};
    } catch (error) {
      return {};
    }
  }
</script>

<script lang="ts">
  import { goto } from '$app/navigation';
  import { notification } from '@marcellejs/core';
  import type { User } from '$lib/declarations';

  let err: any;

  async function signup(e: { currentTarget: HTMLFormElement }) {
    err = null;

    const formData = new FormData(e.currentTarget);
    store
      .signup({
        email: (formData.get('email') || '').toString(),
        username: (formData.get('username') || '').toString(),
        password: (formData.get('password') || '').toString(),
      })
      .then((user) => {
        notification({
          title: `Welcome ${(user as User).username || (user as User).email}`,
          message: 'Your account has been created',
        });
        goto(`${base}/`);
      })
      .catch((error: any) => {
        if (error.name === 'Conflict') {
          if (error.message.includes('email')) {
            error.data = { email: error.message };
          } else if (error.message.includes('username')) {
            error.data = { username: error.message };
          }
        } else if (Array.isArray(error.data) && error.data.length > 0) {
          error.data = error.data.reduce(
            (a: any, x: any) => ({ ...a, [x.instancePath.slice(1)]: x.message }),
            {},
          );
        }
        err = error;
      });
  }
</script>

<svelte:head>
  <title>Create Account</title>
</svelte:head>

<div class="content prose mx-auto max-w-md mt-12">
  <h1 class="text-2xl font-bold mb-6">Create Account</h1>

  {#if err}
    <div role="alert" class="alert alert-error mb-4">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="stroke-current shrink-0 h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        ><path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        /></svg
      >
      <span>Error ({err.name}): {err.message}</span>
    </div>
  {/if}

  <form on:submit|preventDefault={signup}>
    <div class="form-control w-full mb-4">
      <label class="label" for="email">
        <span class="label-text">Email</span>
      </label>
      <label
        class="input input-bordered flex items-center gap-2"
        class:input-error={err?.data?.email}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          class="w-4 h-4 opacity-70"
          ><path
            d="M2.5 3A1.5 1.5 0 0 0 1 4.5v.793c.026.009.051.02.076.032L7.674 8.51c.206.1.446.1.652 0l6.598-3.185A.755.755 0 0 1 15 5.293V4.5A1.5 1.5 0 0 0 13.5 3h-11Z"
          /><path
            d="M15 6.954 8.978 9.86a2.25 2.25 0 0 1-1.956 0L1 6.954V11.5A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5V6.954Z"
          /></svg
        >
        <input type="email" name="email" class="grow" placeholder="Email" required />
      </label>
      {#if err?.data?.email}
        <div class="label">
          <span class="label-text-alt text-error">{err?.data?.email}</span>
        </div>
      {/if}
    </div>
    <div class="form-control w-full mb-4">
      <label class="label" for="username">
        <span class="label-text">Username</span>
      </label>
      <label
        class="input input-bordered flex items-center gap-2"
        class:input-error={err?.data?.username}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          class="w-4 h-4 opacity-70"
          ><path
            d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12.735 14c.618 0 1.093-.561.872-1.139a6.002 6.002 0 0 0-11.215 0c-.22.578.254 1.139.872 1.139h9.47Z"
          /></svg
        >
        <input type="text" name="username" class="grow" placeholder="Username" required />
      </label>
      {#if err?.data?.username}
        <div class="label">
          <span class="label-text-alt text-error">{err?.data?.username}</span>
        </div>
      {/if}
    </div>
    <div class="form-control w-full mb-4">
      <label class="label" for="password">
        <span class="label-text">Choose a Password (min 8 characters)</span>
      </label>
      <label
        class="input input-bordered flex items-center gap-2"
        class:input-error={err?.data?.password}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          class="w-4 h-4 opacity-70"
          ><path
            fill-rule="evenodd"
            d="M14 6a4 4 0 0 1-4.899 3.899l-1.955 1.955a.5.5 0 0 1-.353.146H5v1.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-2.293a.5.5 0 0 1 .146-.353l3.955-3.955A4 4 0 1 1 14 6Zm-4-2a.75.75 0 0 0 0 1.5.5.5 0 0 1 .5.5.75.75 0 0 0 1.5 0 2 2 0 0 0-2-2Z"
            clip-rule="evenodd"
          /></svg
        >
        <input type="password" name="password" class="grow" placeholder="Password" required minlength="8" />
      </label>
      {#if err?.data?.password}
        <div class="label">
          <span class="label-text-alt text-error">{err?.data?.password}</span>
        </div>
      {/if}
    </div>
    <button class="btn btn-primary w-full mt-4" type="submit">Create Account</button>
  </form>
  <div class="text-right mt-8">
    Already have an account?
    <a class="link link-primary" href="{base}/login">Login</a>
  </div>
</div>

<style>
  .content {
    width: 100%;
    max-width: 500px;
    margin: 4rem auto 0 auto;
    padding: 1rem;
  }
</style>
