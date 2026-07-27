/**
 * SKILL.md (Agent Skills open standard) import — SAFE SUBSET.
 *
 * We parse only the flat scalar frontmatter keys the spec defines (name,
 * description, version, license) with a hand-rolled parser — deliberately NOT
 * a YAML library: frontmatter is spec'd flat, a transitive js-yaml\@3 is not a
 * dependency we want to promote, and a hand parser cannot be YAML-bombed.
 *
 * Bundled scripts/resources are NEVER imported (audits found ~26% of
 * marketplace skills vulnerable, almost always via scripts). The markdown
 * body becomes the skill's instructions verbatim; references to bundled
 * files produce warnings so the UI can tell the user what was skipped.
 */

export interface ParsedSkillMd {
  name: string;
  description: string;
  version: string;
  license?: string;
  /** Markdown body (everything after the frontmatter), verbatim. */
  instructions: string;
  warnings: string[];
}

const MAX_INSTRUCTIONS_BYTES = 16 * 1024;

/** Patterns that indicate the skill expects bundled files we do not import. */
const BUNDLE_REF_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bscripts?\//i, label: 'bundled scripts (scripts/…)' },
  { re: /\breferences?\//i, label: 'bundled reference files (references/…)' },
  { re: /\bassets?\//i, label: 'bundled assets (assets/…)' },
  { re: /\]\(\.\.?\//, label: 'relative file links (./…)' },
];

export function parseSkillMd(text: string): ParsedSkillMd {
  // Normalize CRLF once so the delimiter scan is uniform.
  const src = text.replace(/\r\n/g, '\n');

  if (!src.startsWith('---\n')) {
    throw new Error('Not a SKILL.md file — missing opening frontmatter delimiter (---)');
  }
  const end = src.indexOf('\n---', 4);
  if (end === -1) {
    throw new Error('Malformed SKILL.md — frontmatter has no closing delimiter (---)');
  }
  const frontmatter = src.slice(4, end);
  // Body starts after the closing delimiter line.
  const bodyStart = src.indexOf('\n', end + 1);
  const instructions = (bodyStart === -1 ? '' : src.slice(bodyStart + 1)).trim();

  // Flat scalar keys only: `key: value`. Unknown keys (allowed-tools,
  // metadata, nested maps) are deliberately ignored.
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    // Strip one layer of matching quotes.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[m[1].toLowerCase()] = value;
  }

  if (!fields.name) throw new Error('SKILL.md frontmatter is missing required "name"');
  if (!instructions) throw new Error('SKILL.md has an empty body — nothing to import as instructions');
  if (Buffer.byteLength(instructions, 'utf8') > MAX_INSTRUCTIONS_BYTES) {
    throw new Error(`SKILL.md body exceeds the ${MAX_INSTRUCTIONS_BYTES / 1024}KB instruction limit`);
  }

  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const { re, label } of BUNDLE_REF_PATTERNS) {
    if (re.test(instructions) && !seen.has(label)) {
      seen.add(label);
      warnings.push(`The skill references ${label} — bundled files are NOT imported. Attach declarative HTTP/MCP tools instead.`);
    }
  }
  if (fields['allowed-tools']) {
    warnings.push('The "allowed-tools" frontmatter is ignored — BlindMarket skills carry their own declarative tool list.');
  }

  return {
    name: fields.name,
    description: fields.description ?? '',
    version: fields.version ?? '1.0.0',
    license: fields.license || undefined,
    instructions,
    warnings,
  };
}
