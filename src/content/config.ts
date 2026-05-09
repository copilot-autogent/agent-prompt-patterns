import { defineCollection, z } from 'astro:content';

const patterns = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    category: z.enum([
      'prompt-structure',
      'task-design',
      'agent-autonomy',
      'feedback-loops',
      'multi-agent',
    ]),
    slug: z.string().optional(),
    evidenceLevel: z.enum(['strong', 'moderate', 'emerging']),
    relatedPatterns: z.array(z.string()).default([]),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { patterns };
