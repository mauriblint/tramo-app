import MarkdownIt from 'markdown-it'

// html: false → raw HTML from the LLM is escaped, so v-html is safe.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

const defaultLink = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet('target', '_blank')
  tokens[idx]!.attrSet('rel', 'noopener')
  return defaultLink(tokens, idx, options, env, self)
}

export const renderMd = (s: string) => md.render(s)
