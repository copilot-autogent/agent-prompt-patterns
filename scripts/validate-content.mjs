import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const contentDirectory = resolve(process.argv[2] ?? join(scriptDirectory, '..', 'src', 'content', 'patterns'));
const patternRoute = /\/agent-prompt-patterns\/patterns\/([a-z0-9]+(?:-[a-z0-9]+)*)/g;

function parseFrontmatter(content) {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)?.[1] ?? '';
  const slug = frontmatter.match(/^slug:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1];
  const relatedPatterns = frontmatter.match(/^relatedPatterns:\s*\[([^\]]*)\]\s*$/m)?.[1] ?? '';
  const relatedSlugs = relatedPatterns
    .split(',')
    .map(value => value.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  return { slug, relatedSlugs };
}

async function getPatternFiles() {
  const entries = await readdir(contentDirectory, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort();
}

const files = await getPatternFiles();
const slugs = new Set();
const documents = [];
const errors = [];

for (const file of files) {
  const source = join(contentDirectory, file);
  const content = await readFile(source, 'utf8');
  const { slug, relatedSlugs } = parseFrontmatter(content);
  const sourceSlug = slug ?? file.replace(/\.md$/, '');
  slugs.add(sourceSlug);
  documents.push({ file, content, relatedSlugs });
}

for (const { file, content, relatedSlugs } of documents) {
  for (const target of relatedSlugs) {
    if (!slugs.has(target)) {
      errors.push(`${file}: relatedPatterns target "${target}" does not exist`);
    }
  }

  for (const match of content.matchAll(patternRoute)) {
    const target = match[1];
    if (!slugs.has(target)) {
      errors.push(`${file}: internal pattern link target "${target}" does not exist`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Pattern content integrity check failed (${errors.length} error${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Pattern content integrity check passed: ${files.length} files, ${slugs.size} slugs.`);
}
