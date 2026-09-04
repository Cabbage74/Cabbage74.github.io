#!/usr/bin/env node
/**
 * Render + encrypt the private "Secret" articles.
 *
 * 1. Runs `astro build` with SECRET_PASSWORD set, so the secret articles are
 *    rendered through the SAME markdown pipeline as normal posts
 *    (expressive-code, KaTeX, admonitions, ...).
 * 2. Reads the rendered HTML from dist/secrets/, inlines local CSS/images as
 *    self-contained data, and encrypts it with AES-256-GCM (PBKDF2-SHA256).
 * 3. Writes the encrypted bundles to public/secrets/ (committed) and deletes
 *    the plaintext pages from dist/.
 *
 * Plaintext markdown lives in secret-src/ (committed encrypted via git-crypt).
 * It is staged into src/content/secrets/ only for the build, then removed.
 *
 * Usage:
 *   pnpm encrypt                     # prompts for a password (masked)
 *   SECRET_PASSWORD=xxx pnpm encrypt # non-interactive
 */
import { execSync } from "node:child_process";
import {
	createCipheriv,
	createHash,
	pbkdf2Sync,
	randomBytes,
} from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST_SECRETS = join(ROOT, "dist", "secrets");
const OUT_DIR = join(ROOT, "public", "secrets");
// Plaintext lives outside src/content (encrypted at rest by git-crypt in
// secret-src/), so normal/CI builds never glob it. It is staged into the
// content collection only for this encrypt build, then removed again.
const SECRETS_SRC = join(ROOT, "secret-src");
const CONTENT_SECRETS = join(ROOT, "src", "content", "secrets");

function stagePlaintext() {
	if (!existsSync(SECRETS_SRC)) {
		console.error(`Plaintext secrets not found at ${SECRETS_SRC}.`);
		process.exit(1);
	}
	rmSync(CONTENT_SECRETS, { recursive: true, force: true });
	cpSync(SECRETS_SRC, CONTENT_SECRETS, { recursive: true });
}

const ITERATIONS = 210_000;
const KEY_LENGTH = 32; // 256-bit AES key
const SALT_LENGTH = 16;
const IV_LENGTH = 12; // AES-GCM recommended nonce size

const MIME = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".avif": "image/avif",
};

function promptPassword(question) {
	if (process.env.SECRET_PASSWORD) {
		return Promise.resolve(process.env.SECRET_PASSWORD);
	}
	return new Promise((resolve) => {
		process.stdout.write(question);
		if (!process.stdin.isTTY) {
			let buf = "";
			process.stdin.setEncoding("utf8");
			process.stdin.on("data", (d) => {
				buf += d;
				if (buf.includes("\n")) resolve(buf.trim());
			});
			return;
		}
		const stdin = process.stdin;
		let input = "";
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");
		const onData = (chunk) => {
			for (const ch of chunk) {
				if (ch === "\u0003") {
					process.stdout.write("\n");
					process.exit(130);
				}
				if (ch === "\r" || ch === "\n") {
					stdin.setRawMode(false);
					stdin.pause();
					stdin.removeListener("data", onData);
					process.stdout.write("\n");
					resolve(input);
					return;
				}
				if (ch === "\u007f" || ch === "\b") {
					if (input.length) {
						input = input.slice(0, -1);
						process.stdout.write("\b \b");
					}
					continue;
				}
				input += ch;
				process.stdout.write("*");
			}
		};
		stdin.on("data", onData);
	});
}

function encrypt(plaintext, password, salt) {
	const key = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256");
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();
	return {
		iv: iv.toString("base64"),
		// WebCrypto expects the GCM auth tag appended to the ciphertext.
		ciphertext: Buffer.concat([encrypted, tag]).toString("base64"),
	};
}

function runBuild(password) {
	// The blog's Tailwind build is occasionally flaky (a cross-file `@apply`
	// ordering race), so retry a couple of times before giving up.
	const env = { ...process.env, SECRET_PASSWORD: password };
	for (let attempt = 1; attempt <= 3; attempt++) {
		console.log(`Building site (attempt ${attempt}/3)...`);
		try {
			execSync("pnpm astro build", { cwd: ROOT, stdio: "inherit", env });
			return;
		} catch (e) {
			if (attempt === 3) throw e;
			console.warn(`Build failed, retrying...`);
		}
	}
}

function extractBody(html) {
	const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
	return m ? m[1] : html;
}

function decodeEntities(s) {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
}

/**
 * Make the rendered article HTML fully self-contained:
 *  - inline /_astro/*.css stylesheet links as <style> blocks,
 *  - drop /_astro/*.js module scripts (their hashes differ per build and they
 *    would not execute when injected via innerHTML anyway),
 *  - inline image assets as base64 data URIs.
 */
function inlineAssets(html) {
	let out = html;

	// 1. stylesheets -> <style>
	out = out.replace(
		/<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)">/g,
		(match, url) => {
			const filePath = join(ROOT, "dist", url);
			if (!existsSync(filePath)) return match;
			return `<style>${readFileSync(filePath, "utf8")}</style>`;
		},
	);

	// 2. module scripts -> remove
	out = out.replace(/<script[^>]*src="\/_astro\/[^"]+"[^>]*><\/script>/g, "");

	// 3. images -> base64 data URIs
	out = out.replace(/src="(\/_astro\/[^"]+)"/g, (match, url) => {
		const filePath = join(ROOT, "dist", url);
		if (!existsSync(filePath)) return match;
		const mime = MIME[extname(url).toLowerCase()];
		if (!mime) return match;
		const data = readFileSync(filePath).toString("base64");
		return `src="data:${mime};base64,${data}"`;
	});

	return out;
}

async function main() {
	const password = await promptPassword("Secret password: ");
	if (!password) {
		console.error("Password is required.");
		process.exit(1);
	}

	// 1. Build — renders the secret articles because SECRET_PASSWORD is set.
	stagePlaintext();
	try {
		runBuild(password);
		await encryptRendered(password);
	} finally {
		// Never leave plaintext in the working tree after a build.
		rmSync(CONTENT_SECRETS, { recursive: true, force: true });
	}
}

async function encryptRendered(password) {
	if (!existsSync(DIST_SECRETS)) {
		console.error("No dist/secrets found. The build did not render secrets.");
		process.exit(1);
	}
	const dirs = readdirSync(DIST_SECRETS, { withFileTypes: true }).filter(
		(d) => d.isDirectory(),
	);
	if (dirs.length === 0) {
		console.error("No rendered secret pages found in dist/secrets.");
		process.exit(1);
	}

	// 2. Reuse the existing global salt if present, otherwise generate one.
	const indexPath = join(OUT_DIR, "index.json");
	let salt = randomBytes(SALT_LENGTH);
	if (existsSync(indexPath)) {
		try {
			const existing = JSON.parse(readFileSync(indexPath, "utf8"));
			if (existing.salt) salt = Buffer.from(existing.salt, "base64");
		} catch {
			// ignore a corrupt index and start fresh
		}
	}

	mkdirSync(OUT_DIR, { recursive: true });
	const outFiles = [];

	for (const d of dirs) {
		const htmlFile = join(DIST_SECRETS, d.name, "index.html");
		if (!existsSync(htmlFile)) continue;

		const fullHtml = readFileSync(htmlFile, "utf8");
		const body = extractBody(fullHtml);

		const title =
			decodeEntities(
				(body.match(/<h1 class="secret-title"[^>]*>([\s\S]*?)<\/h1>/) ||
					[])[1] ?? d.name,
			) || d.name;
		const published = decodeEntities(
			(body.match(
				/<div class="secret-published"[^>]*>([\s\S]*?)<\/div>/,
			) || [])[1] ?? "",
		);

		// Title/date are rendered by the vault UI from the fields above; strip
		// them from the encrypted HTML so they aren't duplicated and unstyled.
		const html = inlineAssets(
			body
				.replace(/<h1 class="secret-title"[^>]*>[\s\S]*?<\/h1>/, "")
				.replace(/<div class="secret-published"[^>]*>[\s\S]*?<\/div>/, ""),
		);

		const { iv, ciphertext } = encrypt(
			JSON.stringify({ title, published, html }),
			password,
			salt,
		);

		// Content-address the bundle so re-encrypting (new password/IV) produces
		// a new filename, avoiding stale CDN/browser cache mismatches.
		const bundleName =
			createHash("sha256")
				.update(d.name + ":" + ciphertext)
				.digest("hex")
				.slice(0, 16) + ".json";
		writeFileSync(
			join(OUT_DIR, bundleName),
			JSON.stringify({ v: 1, iv, ciphertext }, null, 2),
		);
		outFiles.push(bundleName);
	}

	// 3. Remove stale bundles + delete plaintext pages from dist.
	for (const f of readdirSync(OUT_DIR).filter(
		(f) => f.endsWith(".json") && f !== "index.json",
	)) {
		if (!outFiles.includes(f)) rmSync(join(OUT_DIR, f));
	}
	rmSync(DIST_SECRETS, { recursive: true, force: true });

	writeFileSync(
		indexPath,
		JSON.stringify(
			{
				v: 1,
				kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS },
				salt: salt.toString("base64"),
				files: outFiles,
			},
			null,
			2,
		),
	);

	console.log(`Encrypted ${outFiles.length} article(s) -> ${OUT_DIR}`);
}

main();
