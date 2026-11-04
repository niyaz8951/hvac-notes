# Vendored libraries

Copied into the repo after review; the site loads nothing from outside (`docs/SECURITY.md`, section 4).

| Folder or file | What | Version | Licence |
| --- | --- | --- | --- |
| `marked.js` | [marked](https://github.com/markedjs/marked), Markdown to HTML | 18.1.3 | MIT (`marked.LICENSE.md`) |
| `katex/` | [KaTeX](https://github.com/KaTeX/KaTeX), maths typesetting, with its fonts | 0.19.1 | MIT (`katex/LICENSE`) |
| `dompurify/` | [DOMPurify](https://github.com/cure53/DOMPurify), HTML sanitizer: every rendered page passes through it | 3.4.17 | Apache 2.0 or MPL 2.0 (`dompurify/LICENSE`, `dompurify/LICENSE-MPL`) |
| `fonts/source-serif-4-*` | [Source Serif 4](https://github.com/adobe-fonts/source-serif) by Adobe, the reading font | variable | SIL Open Font License 1.1 (`fonts/source-serif-4.LICENSE`) |

None of them uses `eval` or `new Function`, so they run under the site's Content Security Policy.
