<script lang="ts">
  import { onMount } from "svelte";

  const BASE = import.meta.env.BASE_URL || "/";
  const STORAGE_KEY = "secret-vault-key";
  const EXPIRY_DAYS = 30;
  const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000;

  interface Index {
    v: number;
    kdf: { name: string; hash: string; iterations: number };
    salt: string;
    files: string[];
  }

  interface Bundle {
    v: number;
    iv: string;
    ciphertext: string;
  }

  interface Article {
    title: string;
    published: string;
    html: string;
  }

  interface DecryptedArticle extends Article {
    slug: string;
  }

  let status: "locked" | "unlocking" | "unlocked" = "locked";
  let password = "";
  let error = "";
  let articles: DecryptedArticle[] = [];
  let selected: DecryptedArticle | null = null;

  function bytesToBase64(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(
    password: string,
    saltB64: string,
    iterations: number,
  ): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: base64ToBytes(saltB64),
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["decrypt"],
    );
  }

  async function decryptBundle(bundle: Bundle, key: CryptoKey): Promise<string> {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(bundle.iv), tagLength: 128 },
      key,
      base64ToBytes(bundle.ciphertext),
    );
    return new TextDecoder().decode(plain);
  }

  async function importKeyBytes(b64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      base64ToBytes(b64),
      "AES-GCM",
      false,
      ["decrypt"],
    );
  }

  async function loadStoredKey(): Promise<CryptoKey | null> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.key !== "string" ||
        typeof parsed.expiresAt !== "number"
      ) {
        return null;
      }
      if (parsed.expiresAt < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return await importKeyBytes(parsed.key);
    } catch {
      return null;
    }
  }

  async function storeKey(key: CryptoKey): Promise<void> {
    const raw = await crypto.subtle.exportKey("raw", key);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        key: bytesToBase64(new Uint8Array(raw)),
        expiresAt: Date.now() + EXPIRY_MS,
      }),
    );
  }

  async function tryUnlock(showError: boolean) {
    status = "unlocking";
    error = "";
    try {
      const index = (await (
        await fetch(`${BASE}secrets/index.json`, { cache: "no-store" })
      ).json()) as Index;

      let key = await loadStoredKey();
      let fresh = false;
      if (!key) {
        if (!password) {
          status = "locked";
          return;
        }
        key = await deriveKey(password, index.salt, index.kdf.iterations);
        fresh = true;
      }

      const decrypted = await Promise.all(
        index.files.map(async (file) => {
          const bundle = (await (
            await fetch(`${BASE}secrets/${file}`, { cache: "no-store" })
          ).json()) as Bundle;
          const plain = await decryptBundle(bundle, key!);
          return { slug: file, ...(JSON.parse(plain) as Article) };
        }),
      );

      decrypted.sort((a, b) => (a.published < b.published ? 1 : -1));
      articles = decrypted;
      selected = null;

      if (fresh) await storeKey(key);
      status = "unlocked";
    } catch (e) {
      // Wrong password (or tampered data) -> AES-GCM decrypt throws.
      localStorage.removeItem(STORAGE_KEY);
      password = "";
      status = "locked";
      if (showError) error = "密码错误，或数据无法解密。";
    }
  }

  function onSubmit() {
    if (password) tryUnlock(true);
  }

  onMount(async () => {
    const stored = await loadStoredKey();
    if (stored) {
      await tryUnlock(false);
    } else {
      status = "locked";
    }
  });
</script>

<div data-pagefind-ignore>
  {#if status === "unlocked"}
    {#if selected}
      <div class="card-base px-6 md:px-9 pt-6 pb-4">
        <button
          on:click={() => (selected = null)}
          class="btn-plain mb-4 font-bold"
        >
          ← 返回列表
        </button>
        <div class="text-3xl font-bold mb-2 text-black/90 dark:text-white/90">
          {selected.title}
        </div>
        <div class="text-sm text-black/50 dark:text-white/50 mb-4">
          {selected.published}
        </div>
        <div class="markdown-content">
          {@html selected.html}
        </div>
      </div>
    {:else}
      <div class="card-base px-8 py-6">
        <div class="text-2xl font-bold mb-2 text-black/90 dark:text-white/90">
          Secret
        </div>
        <p class="text-sm text-black/50 dark:text-white/50 mb-4">
          {articles.length} 篇
        </p>
        {#each articles as article}
          <button
            on:click={() => (selected = article)}
            class="btn-plain !block w-full text-left rounded-lg py-3 border-b border-[var(--line-divider)] last:border-b-0"
          >
            <div class="font-bold text-black/75 dark:text-white/75">
              {article.title}
            </div>
            <div class="text-sm text-black/50 dark:text-white/50">
              {article.published}
            </div>
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="card-base px-8 py-8">
      <div class="text-2xl font-bold mb-2 text-black/90 dark:text-white/90">
        Secret
      </div>
      <p class="text-sm text-black/50 dark:text-white/50 mb-6">
        私密文章已加密，输入密码解锁。
      </p>
      <form on:submit|preventDefault={onSubmit}>
        <input
          type="password"
          bind:value={password}
          placeholder="Password"
          class="w-full rounded-lg px-4 py-2 mb-4 bg-black/5 dark:bg-white/10 outline-none text-black/80 dark:text-white/80"
        />
        <button
          type="submit"
          disabled={status === "unlocking"}
          class="btn-card rounded-xl w-full h-11 font-bold disabled:opacity-50"
        >
          {status === "unlocking" ? "解锁中…" : "解锁"}
        </button>
      </form>
      {#if error}
        <p class="text-sm text-red-500 mt-4">{error}</p>
      {/if}
    </div>
  {/if}
</div>
