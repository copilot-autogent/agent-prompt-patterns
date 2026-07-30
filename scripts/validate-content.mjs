import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const contentDirectory = resolve(process.argv[2] ?? join(scriptDirectory, '..', 'src', 'content', 'patterns'));
const markdownLink = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function parseFrontmatter(content) {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)?.[1] ?? '';
  const lines = frontmatter.split('\n');
  const slug = lines.find(line => /^slug:/.test(line))?.match(/^slug:\s*["']?([^"'\s]+)["']?\s*$/)?.[1];
  const relatedLine = lines.findIndex(line => /^relatedPatterns:/.test(line));
  const relatedSlugs = [];

  if (relatedLine !== -1) {
    const inlineValues = lines[relatedLine].replace(/^relatedPatterns:\s*/, '').trim();
    if (inlineValues.startsWith('[') && inlineValues.endsWith(']')) {
      relatedSlugs.push(...parseListValues(inlineValues.slice(1, -1)));
    } else if (inlineValues === '') {
      for (const line of lines.slice(relatedLine + 1)) {
        const item = line.match(/^\s+-\s+(.+?)\s*$/);
        if (!item) break;
        relatedSlugs.push(...parseListValues(item[1]));
      }
    }
  }

  return { slug, relatedSlugs };
}

function parseListValues(value) {
  return value
    .split(',')
    .map(item => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function getPatternLinks(content) {
  const markdown = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  return [...markdown.matchAll(markdownLink)]
    .map(match => match[1])
    .map(destination => destination.match(/^(?:https?:\/\/[^/]+)?(\/agent-prompt-patterns\/patterns\/[a-z0-9]+(?:-[a-z0-9]+)*\/?)$/)?.[1])
    .filter(Boolean)
    .map(path => path.match(/^\/agent-prompt-patterns\/patterns\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/)?.[1])
    .filter(Boolean);
}

async function getPatternFiles(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await getPatternFiles(join(directory, entry.name), relativePath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

const files = await getPatternFiles(contentDirectory);
const slugs = new Map();
const documents = [];
const errors = [];

for (const file of files) {
  const source = join(contentDirectory, file);
  const content = await readFile(source, 'utf8');
  const { slug, relatedSlugs } = parseFrontmatter(content);
  const sourceSlug = slug ?? file.replace(/\.md$/, '');
  if (slugs.has(sourceSlug)) {
    errors.push(`${file}: duplicate pattern slug "${sourceSlug}" also declared by ${slugs.get(sourceSlug)}`);
  } else {
    slugs.set(sourceSlug, file);
  }
  documents.push({ file, content, relatedSlugs });
}

for (const { file, content, relatedSlugs } of documents) {
  for (const target of relatedSlugs) {
    if (!slugs.has(target)) {
      errors.push(`${file}: relatedPatterns target "${target}" does not exist`);
    }
  }

  for (const target of getPatternLinks(content)) {
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
