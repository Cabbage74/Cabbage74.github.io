import { defineCollection, z } from "astro:content";

const postsCollection = defineCollection({
	schema: z.object({
		title: z.string(),
		published: z.date(),
		updated: z.date().optional(),
		draft: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		lang: z.string().optional().default(""),

		/* For internal use */
		prevTitle: z.string().default(""),
		prevSlug: z.string().default(""),
		nextTitle: z.string().default(""),
		nextSlug: z.string().default(""),
	}),
});
const specCollection = defineCollection({
	schema: z.object({}),
});

// Secret articles: rendered through the same markdown pipeline as posts,
// then encrypted before being committed. Plaintext is gitignored.
const secretsCollection = defineCollection({
	schema: z.object({
		title: z.string(),
		published: z.date(),
		description: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
	}),
});

export const collections = {
	posts: postsCollection,
	spec: specCollection,
	secrets: secretsCollection,
};
