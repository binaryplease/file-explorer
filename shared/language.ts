// Filename/extension → Shiki grammar identifier for a served-root-relative
// path. Pure and dependency-free, so both ends of the seam (`zod-single-source`)
// agree on the language without a round trip: the server stamps it onto a text
// preview, the client tokenizes with it.
//
// The table started life against `@git-diff-view/shiki`'s naming (`c++`, `c#`)
// and was retargeted here to standalone Shiki's bundled grammar IDs (`cpp`,
// `csharp`).
// The `'txt'` default is Shiki's own "no grammar" convention: the client
// renders it as plain text rather than failing.

// Extension (without the dot, lower-case) → grammar. Every value is a real
// Shiki bundled language ID; an unmapped extension falls through to `'txt'`.
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  astro: 'astro',
  bash: 'bash',
  bat: 'bat',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  clj: 'clojure',
  cljs: 'clojure',
  cmake: 'cmake',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  csv: 'csv',
  cts: 'typescript',
  cxx: 'cpp',
  dart: 'dart',
  diff: 'diff',
  dockerfile: 'dockerfile',
  elm: 'elm',
  erl: 'erlang',
  ex: 'elixir',
  exs: 'elixir',
  fish: 'fish',
  fs: 'fsharp',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  groovy: 'groovy',
  h: 'c',
  hcl: 'hcl',
  hpp: 'cpp',
  hs: 'haskell',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  jl: 'julia',
  js: 'javascript',
  json: 'json',
  json5: 'json5',
  jsonc: 'jsonc',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  markdown: 'markdown',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  nix: 'nix',
  ocaml: 'ocaml',
  patch: 'diff',
  php: 'php',
  pl: 'perl',
  pm: 'perl',
  proto: 'proto',
  ps1: 'powershell',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  sass: 'sass',
  scala: 'scala',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svelte: 'svelte',
  svg: 'xml',
  swift: 'swift',
  tcl: 'tcl',
  tex: 'latex',
  tf: 'terraform',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  typ: 'typst',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zig: 'zig',
  zsh: 'bash',
}

// Whole filenames that carry no useful extension but have a well-known grammar.
const LANGUAGE_BY_FILENAME: Record<string, string> = {
  '.bash_profile': 'bash',
  '.bashrc': 'bash',
  '.gitconfig': 'ini',
  '.profile': 'bash',
  '.zshrc': 'bash',
  'cmakelists.txt': 'cmake',
  dockerfile: 'dockerfile',
  gemfile: 'ruby',
  makefile: 'makefile',
  rakefile: 'ruby',
  vagrantfile: 'ruby',
}

// Shiki grammar for a served-root-relative path, defaulting to `'txt'`. Matches
// on the whole (lower-cased) basename first — a name like `Dockerfile` or
// `.bashrc` has no extension to key on — then on the trailing extension.
export function languageForPath(relativePath: string): string {
  const fileName = (relativePath.split('/').pop() ?? '').toLowerCase()
  const byFileName = LANGUAGE_BY_FILENAME[fileName]
  if (byFileName !== undefined) return byFileName
  const extensionIndex = fileName.lastIndexOf('.')
  // `<= 0` covers both "no dot" and a leading-dot dotfile with no further
  // extension (`.gitignore`) — neither has an extension to look up.
  if (extensionIndex <= 0) return 'txt'
  return LANGUAGE_BY_EXTENSION[fileName.slice(extensionIndex + 1)] ?? 'txt'
}
