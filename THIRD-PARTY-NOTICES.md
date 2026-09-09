# Third-party notices

`binp-file-explorer` is licensed under the MIT License — see [`LICENSE`](LICENSE).
This file covers the **other people's work** it depends on, and the notices that
have to travel with it.

## Why this file exists, and when it binds you

This repository vendors no third-party source: everything below arrives through
`bun install` and lives in `node_modules/`, which is not committed. Reading or
cloning the repository therefore triggers no obligation on you at all.

Two things do:

- **`mise run build` produces `dist/client/`, and that directory embeds other
  people's files.** Most visibly the Inter font — 14 `.woff2` files are copied
  into `dist/client/assets/` — but also the compiled JavaScript of every runtime
  dependency. If you ship, host or hand someone that build output, you are
  redistributing those works and their notices must go with it.
- **The Nix flake packages the same build output** into the `bfe` executable.
  Same obligation, same reason.

The strictest of those obligations is the font's, so it is reproduced in full
first. Everything else is enumerated after it.

## Inter (SIL Open Font License 1.1) — full notice

Delivered by [`@fontsource-variable/inter`](https://www.npmjs.com/package/@fontsource-variable/inter)
(v5.3.0), imported by `src/index.css` and embedded as `.woff2` files in every
client build.

OFL-1.1 §2 requires that each copy of the Font Software distributed with other
software carry **the copyright notice and this licence**, either as a stand-alone
text file or in a machine-readable metadata field a user can view. This section
is that text file. Two further conditions apply to anyone redistributing this
project's build output: the font may not be sold on its own (§1), and a modified
font may not keep the name "Inter" (§3).

> Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)
> Inter-Italic[opsz,wght].ttf: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)
>
> This Font Software is licensed under the SIL Open Font License, Version 1.1.
> This license is copied below, and is also available with a FAQ at:
> http://scripts.sil.org/OFL

```
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Everything else, by licence

Measured 2026-09-09 over the full resolved tree from `bun.lock` — 308 packages,
runtime and build-time together. Counts and any drift are reproducible with the
command in [How to re-check this](#how-to-re-check-this) below.

| Licence | Packages | What it asks of you |
| --- | --- | --- |
| MIT | 252 | Keep the copyright notice and the permission notice with any copy you distribute. |
| ISC | 40 | Same as MIT in substance — keep the notice. |
| BSD-3-Clause | 5 | Keep the notice; additionally, do not use the contributors' names to endorse a derived product. |
| Apache-2.0 | 5 | Keep the notice and the licence, state significant changes you made, and pass along any `NOTICE` file. **None of these five ships a `NOTICE` file**, checked on disk, so nothing further is owed under §4(d). |
| MPL-2.0 | 3 | File-level copyleft: if you *modify* one of these files you must publish that file's source under MPL-2.0. Merely using them imposes nothing. |
| OFL-1.1 | 1 | The font — full notice above. |
| 0BSD | 1 | No conditions at all. |
| Unlicense | 1 | Public-domain dedication; no conditions. |

Four entries need a sentence each, because a table row does not settle them.

- **`khroma` (2.1.0)** — pulled in by `mermaid` and counted under MIT above. Its
  `package.json` has no `license` field, so an automated scan reports it as
  unknown. The package ships a `license` file reading "The MIT License (MIT) —
  Copyright (c) 2019-present Fabio Spampinato, Andrew Maney", and its README
  states MIT. This is a metadata gap in the published package, not an unlicensed
  dependency.
- **`dompurify` (3.4.12)** — dual-licensed `MPL-2.0 OR Apache-2.0`. It reaches
  the client bundle through `mermaid`. **This project elects Apache-2.0**, which
  is compatible with MIT redistribution and carries no copyleft. It is counted
  under Apache-2.0 in the table and not under MPL-2.0.
- **The three MPL-2.0 packages** are `lightningcss` and two of its
  platform-specific native binaries, reached through `vite` and `tailwindcss`.
  They transform CSS *during* the build and no part of them is emitted into
  `dist/`. Nothing reciprocal reaches the shipped artifact, and this project
  modifies none of their files.
- **`@chevrotain/types` (11.1.2)** — Apache-2.0, reached through
  `@mermaid-js/parser`. It contains TypeScript type declarations only, so it
  contributes no code to any build output.

No dependency is GPL, LGPL, AGPL, or under a source-available or
non-commercial licence. Nothing in the tree conflicts with this project's own
MIT licence.

## Assets in this repository

- `assets/hero-light.png`, `assets/hero-dark.png` and `public/favicon.svg` are
  original to this project and covered by [`LICENSE`](LICENSE).
- Icons are drawn at runtime from
  [`@tabler/icons-react`](https://www.npmjs.com/package/@tabler/icons-react)
  (MIT), not committed as files.
- The search, tree-building and directory-sizing algorithms are re-engineered in
  TypeScript against `broot` (MIT) as a reference specification; no `broot` code
  is copied. See
  [`docs/decisions/2026-07-17-re-engineer-the-broot-engine.md`](docs/decisions/2026-07-17-re-engineer-the-broot-engine.md).

## How to re-check this

The counts above are a snapshot and dependencies move. To reproduce them after
`bun install`:

```sh
bun -e 'import {readdirSync,readFileSync,existsSync} from "fs";
const seen=[];
const walk=(dir,prefix="")=>{for(const entry of readdirSync(dir)){
  if(entry===".bin"||entry===".cache")continue;
  const full=`${dir}/${entry}`;
  if(entry.startsWith("@")){walk(full,entry+"/");continue;}
  if(!existsSync(`${full}/package.json`))continue;
  const meta=JSON.parse(readFileSync(`${full}/package.json`,"utf8"));
  seen.push([prefix+entry, typeof meta.license==="string"?meta.license:"UNKNOWN",
             existsSync(`${full}/NOTICE`)]);}};
walk("node_modules");
const tally={};for(const [,lic] of seen)tally[lic]=(tally[lic]??0)+1;
console.log(tally, "total", seen.length);
console.log("NOTICE files:", seen.filter(s=>s[2]).map(s=>s[0]).join(", ")||"none");'
```

That command reads `package.json` metadata only, so it reports `khroma` as
`UNKNOWN` and `dompurify` as the dual string `MPL-2.0 OR Apache-2.0`. The table
above resolves both by hand — MIT and Apache-2.0 respectively — which is why its
MIT and Apache-2.0 rows each read one higher than the raw tally. Everything else
matches exactly.

The full licence text of any package is in `node_modules/<package>/LICENSE`.
If a new dependency arrives under a copyleft licence (GPL, LGPL, AGPL) or under
anything source-available, say so in the pull request rather than adding a row
here — it is a licensing decision, not a bookkeeping one.
